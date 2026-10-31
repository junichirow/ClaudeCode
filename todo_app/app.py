import sqlite3
from pathlib import Path

from flask import Flask, abort, g, redirect, render_template, request, url_for

# データベースファイルはこのファイルと同じフォルダに置く
DEFAULT_DATABASE = Path(__file__).parent / "todo.db"


def create_app(database=DEFAULT_DATABASE):
    app = Flask(__name__)
    app.config["DATABASE"] = str(database)

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
            db.execute("INSERT INTO todos (title) VALUES (?)", (title,))
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
