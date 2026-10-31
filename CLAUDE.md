# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Python の小さな学習・実験用リポジトリ。アプリごとにサブフォルダを分ける方針。

- `now_app/now.py` — 現在の日本時間を `YYYY年MM月DD日 HH時MM分SS秒` 形式で表示する。標準ライブラリのみ
- `todo_app/` — Flask + SQLite の TODO リスト Web アプリ

## 環境

- Python 3.15（ルートの `.venv/` を全アプリで共有）
- 依存はアプリごとの `requirements.txt` に書く（`todo_app/requirements.txt`）
- リンター設定はまだ無い

## コマンド

```bash
source .venv/bin/activate                 # 仮想環境を有効化
python now_app/now.py                     # 時刻表示

pip install -r todo_app/requirements.txt  # TODOアプリの依存をインストール
cd todo_app && python app.py              # http://127.0.0.1:5001 で起動（debug モード。5000 は macOS の AirPlay と衝突するため避ける）
cd todo_app && python -m unittest -v      # テスト（標準の unittest）
cd todo_app && python -m unittest test_app.TodoAppTest.test_削除  # 単一テスト
```

## todo_app の構成

- `app.py` の `create_app(database)` がアプリファクトリ。DB パスを引数で受け取るので、テストは一時ディレクトリの DB を渡して本番の `todo_app/todo.db` に触れない
- DB 接続はリクエストごとに `flask.g` に保持し、`teardown_appcontext` で閉じる。テーブルは `create_app` 内で `CREATE TABLE IF NOT EXISTS` により作成（マイグレーションの仕組みは無い）
- 更新系（追加・完了切替・削除）はすべて POST で、処理後 `/` にリダイレクトする。存在しない ID は 404
- `todo.db` は `.gitignore` 済み
- テストメソッド名は日本語
- `before_request` で2つのチェックをする：
  - Basic 認証（`APP_USERNAME` / `APP_PASSWORD`）。`APP_PASSWORD` 未設定なら認証なし（ローカル開発用）
  - CSRF 対策として、POST の `Origin`/`Referer` が自ホストと一致するか確認
- 環境変数 `RENDER` があるのに `APP_PASSWORD` が無いと `create_app` が例外を出して起動を拒否する

## デプロイ（Render）

- ルートの `render.yaml`（Blueprint）で定義。`rootDir: todo_app`、本番は `gunicorn "app:create_app()"` で起動（`app.run(debug=True)` は使われない）
- 無料プランのためファイルシステムは揮発性で、再デプロイ・再起動で `todo.db` の内容は消える（了承済み）
- `main` へのプッシュで自動デプロイされる

## 規約

- コメント・コミットメッセージ・出力文字列は日本語を使っている
- タイムゾーンは `ZoneInfo("Asia/Tokyo")` で明示する（システムのローカル時刻に依存しない）
