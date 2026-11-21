"""Vercel の入口。Vercel は app.py の `app` を Flask アプリとして動かす"""

import sys
import traceback

from flask import Flask

try:
    from webapp import create_app

    app = create_app()
except Exception as exc:  # 起動に失敗したときは原因がわかるようにする
    # 詳しい内容は Vercel のログ（Runtime Logs）にだけ出す
    traceback.print_exc(file=sys.stderr)
    # 画面にはエラーの種類と、設定ミスのとき（RuntimeError、文言はこちらで書いたもの）だけ文言を出す。
    # DB のエラーなどは接続先が含まれることがあるので種類だけにする
    reason = type(exc).__name__
    if type(exc) is RuntimeError:
        reason += f": {exc}"

    app = Flask(__name__)

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def startup_error(path):
        return f"起動に失敗しました（{reason}）", 500, {"Content-Type": "text/plain; charset=utf-8"}


if __name__ == "__main__":
    # 5000 番は macOS の AirPlay と衝突するので 5003 番を使う
    app.run(debug=True, port=5003)
