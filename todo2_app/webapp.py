"""アプリファクトリ。Vercel の入口は app.py（ここで作った app を公開する）"""

import os
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import text
from sqlalchemy.pool import NullPool
from werkzeug.middleware.proxy_fix import ProxyFix

from models import db

BASE_DIR = Path(__file__).resolve().parent

csrf = CSRFProtect()


def normalize_database_url(url):
    """Supabase の接続文字列を SQLAlchemy + psycopg 3 用に変換する。

    postgres://... と postgresql://... のどちらでも postgresql+psycopg://... にそろえる。
    """
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def engine_options(database_url):
    """PostgreSQL（Supabase）につなぐときの接続設定。SQLite のときは何も足さない"""
    if not database_url or not database_url.startswith(("postgres://", "postgresql")):
        return {}
    # Vercel はリクエストごとに関数が立ち上がる（サーバーレス）ので接続を使い回さない。
    # Supabase の Transaction pooler（6543）はプリペアドステートメントに対応しないので切る。
    # Supabase との通信は必ず暗号化（TLS）する。接続文字列に sslmode があればそちらを使う
    connect_args = {"prepare_threshold": None}
    if "sslmode=" not in database_url:
        connect_args["sslmode"] = "require"
    return {"poolclass": NullPool, "connect_args": connect_args}


def enable_row_level_security():
    """PostgreSQL（本番の Supabase）では、アプリのテーブルすべてで RLS を有効にする。

    Supabase は public スキーマのテーブルを REST API で公開するため、RLS が無効だと
    anon key だけで誰でも読み書きできてしまう。ポリシーは作らないので API からは何もできない。
    アプリは postgres ユーザーで直接つなぐので RLS の対象外で、動作には影響しない。
    """
    if db.engine.dialect.name != "postgresql":
        return
    with db.engine.begin() as conn:
        for table in db.metadata.sorted_tables:
            enabled = conn.execute(
                text(
                    "SELECT c.relrowsecurity FROM pg_class c"
                    " JOIN pg_namespace n ON n.oid = c.relnamespace"
                    " WHERE n.nspname = 'public' AND c.relname = :name"
                ),
                {"name": table.name},
            ).scalar()
            if enabled is False:
                conn.execute(text(f'ALTER TABLE public."{table.name}" ENABLE ROW LEVEL SECURITY'))


def create_app(test_config=None):
    # .env があれば環境変数として読み込む（すでにある環境変数は上書きしない）
    load_dotenv(BASE_DIR / ".env")

    # public/ は Vercel では CDN からそのまま配信される。ローカルでも同じ URL（/style.css など）で
    # 見えるよう、Flask の静的ファイルもサイトのルートに置く
    app = Flask(__name__, static_folder="public", static_url_path="")

    on_vercel = bool(os.environ.get("VERCEL"))
    if on_vercel:
        # 前段のプロキシで HTTPS を終端するので X-Forwarded-Proto を信用する
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    database_url = os.environ.get("DATABASE_URL")
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        FAMILY_PASSWORD=os.environ.get("FAMILY_PASSWORD"),
        SQLALCHEMY_DATABASE_URI=(
            normalize_database_url(database_url)
            if database_url
            else f"sqlite:///{BASE_DIR / 'todo2.db'}"
        ),
        # ホーム画面から開くたびにログインしなくて済むよう、ログインは 1 年もたせる
        PERMANENT_SESSION_LIFETIME=timedelta(days=365),
        SESSION_COOKIE_SECURE=on_vercel,
        SESSION_COOKIE_SAMESITE="Lax",
        # CSRF トークンはセッションと同じだけ有効にする（開きっぱなしの画面でも送信できるように）
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)
    # 接続設定は、テストで差しかえた後の実際に使う DB に合わせて決める
    app.config.setdefault(
        "SQLALCHEMY_ENGINE_OPTIONS", engine_options(app.config["SQLALCHEMY_DATABASE_URI"])
    )

    for key in ("SECRET_KEY", "FAMILY_PASSWORD"):
        if not app.config[key]:
            raise RuntimeError(f"{key} が設定されていません。.env か環境変数で設定してください")
    if on_vercel:
        # 公開する本番では、推測されにくい長さを必須にする
        if len(app.config["SECRET_KEY"]) < 32:
            raise RuntimeError("SECRET_KEY は 32 文字以上にしてください")
        if len(app.config["FAMILY_PASSWORD"]) < 8:
            raise RuntimeError("FAMILY_PASSWORD は 8 文字以上にしてください")

    db.init_app(app)
    csrf.init_app(app)

    from views import bp

    app.register_blueprint(bp)

    @app.after_request
    def set_security_headers(response):
        # 自分のサイトの CSS・JS・画像だけを使う。インラインのスクリプトは動かさない（XSS 対策）。
        # 他サイトの iframe に埋め込ませない（クリックジャッキング対策）
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;"
            " connect-src 'self'; manifest-src 'self'; worker-src 'self';"
            " base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
        )
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        # 家族の予定が検索エンジンに載らないように
        response.headers.setdefault("X-Robots-Tag", "noindex, nofollow")
        if on_vercel:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
            )
        # ログイン後の画面はブラウザや途中のサーバーに保存させない（静的ファイルは Flask が別に付ける）
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    with app.app_context():
        db.create_all()
        enable_row_level_security()

    return app
