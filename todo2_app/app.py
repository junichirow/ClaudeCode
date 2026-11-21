"""Vercel の入口。Vercel は app.py の一番外側にある `app = ...` を Flask アプリとして動かす

（`app = ...` を try の中などに書くと、Vercel のビルドが見つけられずに失敗する）
"""

import sys
import traceback

from flask import Flask


def _startup_error_app(exc):
    """起動に失敗したときに、原因だけを返すアプリ。

    詳しい内容は Vercel のログにだけ出す。画面にはエラーの種類と、設定ミスのとき
    （RuntimeError。文言はこちらで書いたもの）だけ文言を出す。DB のエラーなどは
    接続先が含まれることがあるので種類だけにする。
    """
    traceback.print_exc(file=sys.stderr)
    reason = type(exc).__name__
    if type(exc) is RuntimeError:
        reason += f": {exc}"

    fallback = Flask(__name__)

    @fallback.route("/", defaults={"path": ""})
    @fallback.route("/<path:path>")
    def startup_error(path):
        return f"起動に失敗しました（{reason}）", 500, {"Content-Type": "text/plain; charset=utf-8"}

    return fallback


def _build_app():
    try:
        from webapp import create_app

        return create_app()
    except Exception as exc:
        return _startup_error_app(exc)


app = _build_app()

if __name__ == "__main__":
    # 5000 番は macOS の AirPlay と衝突するので 5003 番を使う
    app.run(debug=True, port=5003)
