import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, redirect, url_for
from flask_login import LoginManager, current_user
from flask_wtf.csrf import CSRFProtect
from werkzeug.middleware.proxy_fix import ProxyFix

from durations import format_duration
from models import User, db

BASE_DIR = Path(__file__).resolve().parent

csrf = CSRFProtect()
login_manager = LoginManager()
login_manager.login_view = "auth.login"
login_manager.login_message = "ログインしてください。"


def normalize_database_url(url):
    """Supabase などの接続文字列を SQLAlchemy + psycopg 3 用に変換する。

    postgres://... と postgresql://... のどちらでも
    postgresql+psycopg://... にそろえる（SQLAlchemy は postgres:// を受け付けない）。
    """
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def create_app(test_config=None):
    # .env があれば環境変数として読み込む（すでにある環境変数は上書きしない）
    load_dotenv(BASE_DIR / ".env")

    app = Flask(__name__)

    on_render = bool(os.environ.get("RENDER"))
    if on_render:
        # Render は前段のプロキシで HTTPS を終端するので、X-Forwarded-Proto を信用して
        # https で来たリクエストだと判別できるようにする（CSRF の Referer チェックも有効になる）
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    database_url = os.environ.get("DATABASE_URL")
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        SQLALCHEMY_DATABASE_URI=(
            normalize_database_url(database_url)
            if database_url
            else f"sqlite:///{BASE_DIR / 'setlist.db'}"
        ),
        # 切れた接続を使わないよう、使う前に確認し、5 分で張り直す
        SQLALCHEMY_ENGINE_OPTIONS={"pool_pre_ping": True, "pool_recycle": 300},
        # Render 上（HTTPS）ではクッキーを HTTPS のときだけ送る
        SESSION_COOKIE_SECURE=on_render,
        REMEMBER_COOKIE_SECURE=on_render,
        REMEMBER_COOKIE_HTTPONLY=True,
        REMEMBER_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SAMESITE="Lax",
        # 大きすぎるリクエストは 413 で断る（フォームしか無いので 1MB で十分）
        MAX_CONTENT_LENGTH=1024 * 1024,
    )
    if test_config:
        app.config.update(test_config)

    if not app.config["SECRET_KEY"]:
        raise RuntimeError(
            "SECRET_KEY が設定されていません。.env か環境変数で設定してください"
        )

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)

    from auth import bp as auth_bp
    from export import bp as export_bp
    from setlists import bp as setlists_bp
    from songs import bp as songs_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(songs_bp)
    app.register_blueprint(setlists_bp)
    app.register_blueprint(export_bp)

    app.jinja_env.filters["duration"] = format_duration

    @app.after_request
    def set_security_headers(response):
        # 他サイトの iframe に埋め込ませない（クリックジャッキング対策）
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Content-Security-Policy", "frame-ancestors 'none'")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("setlists.index"))
        return redirect(url_for("auth.login"))

    with app.app_context():
        db.create_all()

    return app


if __name__ == "__main__":
    # 5000 番は macOS の AirPlay と衝突するので 5002 番を使う
    create_app().run(debug=True, port=5002)
