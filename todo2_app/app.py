"""Vercel の入口。Vercel は app.py の `app` を Flask アプリとして動かす"""

from webapp import create_app

app = create_app()

if __name__ == "__main__":
    # 5000 番は macOS の AirPlay と衝突するので 5003 番を使う
    app.run(debug=True, port=5003)
