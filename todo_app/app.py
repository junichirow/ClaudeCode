import hmac
import os
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, Response, abort, g, redirect, render_template, request, url_for

# データベースファイルはこのファイルと同じフォルダに置く
DEFAULT_DATABASE = Path(__file__).parent / "todo.db"

# 一覧に残す最大件数。超えた分は（今追加したもの以外から）ランダムに消える
MAX_TODOS = 3


def create_app(
    database=DEFAULT_DATABASE,
    username=os.environ.get("APP_USERNAME", "admin"),
    password=os.environ.get("APP_PASSWORD"),
):
    app = Flask(__name__)
    app.config["DATABASE"] = str(database)

    @app.before_request
    def require_login():
        # APP_PASSWORD 未設定のときは認証しない（誰でも使える）
        if not password:
            return None
        auth = request.authorization
        if (
            auth is None
            or auth.type != "basic"
            or not hmac.compare_digest(auth.username or "", username)
            or not hmac.compare_digest(auth.password or "", password)
        ):
            return Response(
                "ログインが必要です",
                401,
                {"WWW-Authenticate": 'Basic realm="TODO", charset="UTF-8"'},
            )
        return None

    @app.before_request
    def check_origin():
        # 他サイトから勝手にフォームを送信される（CSRF）のを防ぐ
        if request.method != "POST":
            return None
        origin = request.headers.get("Origin") or request.headers.get("Referer")
        if origin and urlsplit(origin).netloc != request.host:
            abort(403)
        return None

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(app.config["DATABASE"])
            g.db.row_factory = sqlite3.Row
        return g.db

    @app.teardown_appcontext
    def close_db(exception):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    # 起動時にテーブルを作成する
    with app.app_context():
        get_db().execute(
            """
            CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        get_db().commit()

    @app.get("/")
    def index():
        todos = get_db().execute(
            "SELECT id, title, done FROM todos ORDER BY done, id"
        ).fetchall()
        return render_template("index.html", todos=todos)

    @app.post("/add")
    def add():
        title = request.form.get("title", "").strip()
        if title:
            db = get_db()
            cur = db.execute("INSERT INTO todos (title) VALUES (?)", (title,))
            # MAX_TODOS 件を超えたら、今追加したもの以外からランダムに選んで消す
            db.execute(
                "DELETE FROM todos WHERE id IN"
                " (SELECT id FROM todos WHERE id != ? ORDER BY RANDOM()"
                "  LIMIT max(0, (SELECT count(*) FROM todos) - ?))",
                (cur.lastrowid, MAX_TODOS),
            )
            db.commit()
        return redirect(url_for("index"))

    @app.post("/toggle/<int:todo_id>")
    def toggle(todo_id):
        db = get_db()
        cur = db.execute(
            "UPDATE todos SET done = 1 - done WHERE id = ?", (todo_id,)
        )
        if cur.rowcount == 0:
            abort(404)
        db.commit()
        return redirect(url_for("index"))

    @app.post("/delete/<int:todo_id>")
    def delete(todo_id):
        db = get_db()
        cur = db.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
        if cur.rowcount == 0:
            abort(404)
        db.commit()
        return redirect(url_for("index"))

    return app


if __name__ == "__main__":
    # macOS では 5000 番を AirPlay レシーバーが使っているため 5001 番で起動する
    create_app().run(debug=True, port=5001)
