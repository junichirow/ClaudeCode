# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Python の小さな学習・実験用リポジトリ。アプリごとにサブフォルダを分ける方針。

- `now_app/now.py` — 現在の日本時間を `YYYY年MM月DD日 HH時MM分SS秒` 形式で表示する。標準ライブラリのみ
- `todo_app/` — Flask + SQLite の TODO リスト Web アプリ
- `setlist_app/` — バンド向けセットリスト管理 Web アプリ（Flask-Login でユーザーごとにデータを分離。ローカルは SQLite、本番は Render + Supabase PostgreSQL）
- `game_app/` — HTML/CSS/JS（Canvas）だけのシューティングゲーム。ビルド不要
- `game2_app/` — 同じく Canvas だけの横スクロールアクション（クマがパンチ・ジャンプ・レーザーで戦う全 2 ステージ。1 面は森でシロクマ、2 面は竹林でパンダがボス）。PC はキーボード、スマホは画面下のボタンで操作
- 2つのゲームは `.github/workflows/pages.yml` で `main` へのプッシュ時に GitHub Pages へ公開（`game_app` がサイトのトップ、`game2_app` が `/game2/`）
  - 公開アドレス：https://junichirow.github.io/ClaudeCode/ （シューティング）、https://junichirow.github.io/ClaudeCode/game2/ （クマクマ大冒険）

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

pip install -r setlist_app/requirements.txt
cp setlist_app/.env.example setlist_app/.env  # SECRET_KEY を入れる
cd setlist_app && python app.py           # http://127.0.0.1:5002 で起動
cd setlist_app && python -m unittest -v   # テスト
```

## setlist_app の構成

- `app.py` の `create_app(test_config=None)` がアプリファクトリ。`.env` を python-dotenv で読み、`SECRET_KEY` が無ければ起動時に例外
- `DATABASE_URL` が無ければ `setlist_app/setlist.db`（SQLite、`.gitignore` 済み）。あれば `normalize_database_url()` で `postgres://` / `postgresql://` を `postgresql+psycopg://`（psycopg 3）に変換
- 本番の Supabase は **Session pooler（ポート 5432）** の接続文字列を使う。直接接続は IPv6 専用で Render から届かず、Transaction pooler（6543）は psycopg のプリペアドステートメントと相性が悪い
- テーブルは `db.create_all()` で作成（マイグレーションの仕組みは無い。列を変えるときは本番 DB を手で直す必要がある）
- 機能ごとに Blueprint：`auth.py` / `songs.py` / `setlists.py` / `export.py`。モデルは `models.py`、演奏時間の変換は `durations.py`（DB には秒で保存）
- ユーザーごとの分離：取得はすべて `user_id=current_user.id` で絞り、他人の ID は 404
- CSRF は Flask-WTF の `CSRFProtect`。フォームには `{{ csrf_token() }}` の hidden を入れる（テストでは `WTF_CSRF_ENABLED=False`）
- 曲順は `SetlistItem.position`。並べ替えは ↑↓ ボタン（POST）で隣と入れ替え、削除時は `Setlist.renumber()` で振り直す
- Render 上（環境変数 `RENDER` あり）では `ProxyFix` で HTTPS を判別し、クッキーを Secure にする。`after_request` で `X-Frame-Options` などのセキュリティヘッダーを付け、`MAX_CONTENT_LENGTH` は 1MB
- Render の Web サービスは `render.yaml` ではなくダッシュボードで手動作成（Root Directory `setlist_app`、Python は `.python-version` で 3.13）

## todo_app の構成

- `app.py` の `create_app(database)` がアプリファクトリ。DB パスを引数で受け取るので、テストは一時ディレクトリの DB を渡して本番の `todo_app/todo.db` に触れない
- DB 接続はリクエストごとに `flask.g` に保持し、`teardown_appcontext` で閉じる。テーブルは `create_app` 内で `CREATE TABLE IF NOT EXISTS` により作成（マイグレーションの仕組みは無い）
- 更新系（追加・完了切替・削除）はすべて POST で、処理後 `/` にリダイレクトする。存在しない ID は 404
- `todo.db` は `.gitignore` 済み
- テストメソッド名は日本語
- `before_request` で2つのチェックをする：
  - Basic 認証（`APP_USERNAME` / `APP_PASSWORD`）。`APP_PASSWORD` 未設定なら認証なし（本番 Render も現在は認証なしで公開）
  - CSRF 対策として、POST の `Origin`/`Referer` が自ホストと一致するか確認

## デプロイ（Render）

- ルートの `render.yaml`（Blueprint）で定義。`rootDir: todo_app`、本番は `gunicorn "app:create_app()"` で起動（`app.run(debug=True)` は使われない）
- 無料プランのためファイルシステムは揮発性で、再デプロイ・再起動で `todo.db` の内容は消える（了承済み）
- `main` へのプッシュで自動デプロイされる

## 規約

- コメント・コミットメッセージ・出力文字列は日本語を使っている
- タイムゾーンは `ZoneInfo("Asia/Tokyo")` で明示する（システムのローカル時刻に依存しない）
