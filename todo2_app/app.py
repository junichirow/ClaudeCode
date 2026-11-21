"""Vercel の入口。Vercel は app.py の `app` を Flask アプリとして動かす

Vercel のビルドはこのファイルを読んで `app = create_app()` の形を探す。
try で囲んだり別の関数を通したりすると見つけられずにビルドが失敗する（FLASK_ENTRYPOINT_NOT_FOUND）ので、この形のまま変えない。
起動に失敗したときの原因は Vercel のログ（`vercel logs`）で見る。
"""

from webapp import create_app

app = create_app()

if __name__ == "__main__":
    # 5000 番は macOS の AirPlay と衝突するので 5003 番を使う
    app.run(debug=True, port=5003)
