# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Python の小さな学習・実験用リポジトリ。アプリごとにサブフォルダを分ける方針。

- `now_app/now.py` — 現在の日本時間を `YYYY年MM月DD日 HH時MM分SS秒` 形式で表示する。標準ライブラリのみ
- `todo_app/` — Flask + SQLite の TODO リスト Web アプリ
- `setlist_app/` — バンド向けセットリスト管理 Web アプリ（Flask-Login でユーザーごとにデータを分離。ローカルは SQLite、本番は Render + Supabase PostgreSQL）
- `todo2_app/` — 家族で共有するタスクリスト（Flask + Supabase、Vercel で公開。PWA でホーム画面に追加できる）。詳細は `todo2_app/README.md`
- `game_app/` — HTML/CSS/JS（Canvas）だけのシューティングゲーム。ビルド不要
- `game2_app/` — 同じく Canvas だけの横スクロールアクション（クマがパンチ・ジャンプ・レーザーで戦う全 4 ステージ。1 面は森でシロクマ、2 面は竹林でパンダ、3 面は水中（重力が弱くジャンプがゆるやか）でサメ、4 面は 1 面を難しくした夕暮れの森でパワーアップしたシロクマがボス）。PC はキーボード、スマホは画面下のボタンで操作
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

pip install -r todo2_app/requirements.txt
cp todo2_app/.env.example todo2_app/.env  # SECRET_KEY と FAMILY_PASSWORD を入れる
cd todo2_app && python app.py             # http://127.0.0.1:5003 で起動
cd todo2_app && python -m unittest -v     # テスト
```

## setlist_app の構成

- `app.py` の `create_app(test_config=None)` がアプリファクトリ。`.env` を python-dotenv で読み、`SECRET_KEY` が無ければ起動時に例外
- `DATABASE_URL` が無ければ `setlist_app/setlist.db`（SQLite、`.gitignore` 済み）。あれば `normalize_database_url()` で `postgres://` / `postgresql://` を `postgresql+psycopg://`（psycopg 3）に変換
- 本番の Supabase は **Session pooler（ポート 5432）** の接続文字列を使う。直接接続は IPv6 専用で Render から届かず、Transaction pooler（6543）は psycopg のプリペアドステートメントと相性が悪い
- テーブルは `db.create_all()` で作成（マイグレーションの仕組みは無い）。後から足した列は `app.py` の `ADDED_COLUMNS` に書くと、起動時に `add_missing_columns()` が無ければ `ALTER TABLE ... ADD COLUMN` する（本番 DB にも自動で反映）。列の削除・型変更は手で直す必要がある
- PostgreSQL のときは起動時に `enable_row_level_security()` が全テーブルの RLS を有効にする（ポリシーは作らない）。Supabase は public スキーマを REST API で公開するので、RLS が無効だと anon key で誰でも読み書きできてしまうため。アプリは postgres ユーザーで直接つなぐので RLS の影響を受けない。新しいテーブルも `db.metadata` にあれば自動で対象になる
- 機能ごとに Blueprint：`auth.py` / `songs.py` / `setlists.py` / `export.py`。モデルは `models.py`、演奏時間の変換は `durations.py`（DB には秒で保存）
- 歌詞は `Song.lyrics`（Text）。曲の一覧の「歌詞」ボタンから `/songs/<id>/lyrics` の画面で書く（曲の編集フォームとは別。改行は `\n` にそろえて保存）。ライブ表示では歌詞のある曲に `<details class="lyrics">` の「歌詞」ボタンが付き、その場で開閉する（JS なし）。CSV と印刷には含めない
- 新規ユーザー登録は無効。`/register` は GET・POST とも `/login` へリダイレクトするだけで、ユーザーは作られない（ログイン画面の登録リンクも削除済み）。ユーザーを足すときは DB に直接 `User` を作る（パスワードは `generate_password_hash` でハッシュ化。テストの `create_user()` と同じ）
- ユーザーごとの分離：取得はすべて `user_id=current_user.id` で絞り、他人の ID は 404
- CSRF は Flask-WTF の `CSRFProtect`。フォームには `{{ csrf_token() }}` の hidden を入れる（テストでは `WTF_CSRF_ENABLED=False`）
- ライブ表示（`setlists/show.html`）でテンポのある曲は曲名が `button.beat-toggle[data-bpm]` になり、`static/metronome.js` が赤い点（`.beat-dot`、光っている間は `.beat-on`）を 16 回光らせ、同時に Web Audio API で「ピッ」（1000Hz のサイン波）を鳴らす。音は 16 回分を AudioContext の時計でまとめて予約し、光り始めも同じだけ（`LEAD_SEC`）遅らせてそろえる。光は開始からの経過時間で拍を計算するのでずれない。テンポのある曲が入っているセットリストだけ、上部に音のオン／オフボタン（`button.sound-toggle`）が出る。状態は localStorage（`metronome-sound`）に保存し、点滅中に切り替えると残りの拍の音を予約し直す／取り消す。`.flash` はフラッシュメッセージ用のクラスなので使わない
- ライブ表示を開いている間は `static/keep-awake.js` が Screen Wake Lock で画面をスリープさせない（テンポの有無に関係なく、ページを開いている間ずっと）。別アプリに切り替えると OS が解除するので、戻ったときとタップのたびにかけ直す。非対応ブラウザでは何もしない
- 印刷・PDF は `/setlists/<id>/print`（`setlists/print.html` + `static/print.css`、base.html を継承しない単独ページ）。PDF はブラウザの印刷の「PDF に保存」に任せ、サーバー側で PDF は作らない。1 曲を「1 行目に曲名、2 行目にキー・チューニング・テンポ・演奏時間、3 行目にメモ」で並べ、曲数とメモの行数から文字サイズを 4 段階に切り替える（`setlists.py` の `print_size()`。しきい値と比率は A4 1 枚に収まる曲数を Chrome で実測して決めた）
- ホーム画面に追加してアプリのように使える（PWA）。`static/manifest.webmanifest` と `static/sw.js` を、Service Worker のスコープのため `app.py` のルートでサイトのルート（`/manifest.webmanifest`・`/sw.js`）から出す。登録は `base.html` で読む `static/pwa.js`。アイコンは `static/icons/`（`icon.svg` が元。PNG は Chrome のヘッドレスで描き出した）
  - `sw.js` は `/static/` をキャッシュ優先＋裏で更新、画面（HTML）はネット優先で、4 秒で返らない・つながらないときは前に開いたときの保存分を出す（ライブ会場で電波が弱くてもセットリストを見られるように）。ログインしていない画面では `pwa.js` が画面の保存分（`setlist-pages`）を消す（`body[data-logged-in]` で判別）
  - `/static/` のファイルを足したり変えたりしたら、`sw.js` の `STATIC_CACHE` の番号を上げる
- 二重送信対策：`base.html` で読む `static/submit-once.js` が、1回送信したフォームを再送信できなくしてボタンを無効にする（全ページ共通）。さらに `/songs/new` は全項目が同じ曲がすでにあれば作らない（`songs.py` の `_find_same_song()`）
- 曲順は `SetlistItem.position`。並べ替えは ↑↓ ボタン（POST）で隣と入れ替え、削除時は `Setlist.renumber()` で振り直す
- Render 上（環境変数 `RENDER` あり）では `ProxyFix` で HTTPS を判別し、クッキーを Secure にする。`after_request` で `X-Frame-Options` などのセキュリティヘッダーを付け、`MAX_CONTENT_LENGTH` は 1MB
- Render の Web サービスは `render.yaml` ではなくダッシュボードで手動作成（Root Directory `setlist_app`、Python は `.python-version` で 3.13）

## todo2_app の構成

- Vercel の Flask ランタイムで動かす。入口は `app.py`（モジュールの `app` を Vercel が読む）で、ファクトリ `create_app()` は `webapp.py`。テストは `webapp` から import するので `app.py` は読まない
- ログインは家族共通の合言葉（環境変数 `FAMILY_PASSWORD`）。セッションに `logged_in` を入れ、1 年有効。ユーザーの区別は無く全データを家族で共有
  - セッションには合言葉から作った目印（`pw`、`SECRET_KEY` で HMAC）も入れ、毎リクエスト照合する。合言葉を変えると全員ログアウトされる
  - 入力ミスは `LoginFailure` 表に記録し、同じ IP で 15 分に 10 回で 429（サーバーレスでメモリに持てないので DB）
  - Vercel 上では `SECRET_KEY` 32 文字未満・`FAMILY_PASSWORD` 8 文字未満だと起動時に例外
  - CSP は `script-src 'self'` などで厳しくしているので、テンプレートにインラインの `<script>` や `style=` を書かない
- 本番 DB は Supabase の **Transaction pooler（6543）**。サーバーレスなので `NullPool`、pooler 用に psycopg の `prepare_threshold=None` でプリペアドステートメントを切る（`webapp.py` の `engine_options()`。接続文字列が PostgreSQL のときだけ付け、テストで SQLite に差しかえたときは付けない）。setlist_app と同じく起動時に `create_all()` と RLS の有効化をする
- 静的ファイルは `public/`（Vercel は CDN から配信）。Flask も `static_folder="public", static_url_path=""` で同じ URL（`/style.css` など）で出す。`manifest.webmanifest` と `sw.js` はスコープのためサイトのルートに置く
- 完了の切り替えは `public/app.js` が fetch（`Accept: application/json` と `X-CSRFToken`）で送り、その場で `.task.done` を付け外しする。二重線は CSS の背景グラデーションで描く
- 公開アドレス：https://claude-code-psi-two.vercel.app/ （Vercel のプロジェクト名は `claude-code`）
- Vercel のビルドは `app.py` の `app = create_app()` という形を静的に探す。try で囲む・別の関数を通すとビルドが `FLASK_ENTRYPOINT_NOT_FOUND` で失敗するので、`app.py` はこの形のまま変えない
- ログは Vercel CLI（`brew install --cask vercel`）で `vercel logs --scope junichirow --project claude-code`（Hobby プランは直近 30 分ほどしか残らない）。ビルドログは `vercel inspect <デプロイの URL> --logs`
- `vercel.json` で関数のリージョンをソウル（`icn1`）にしている（本番の Supabase がソウル `ap-northeast-2` のため。DB と同じ場所に置く）。Vercel のプロジェクトはダッシュボードで作成（Root Directory `todo2_app`）

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
