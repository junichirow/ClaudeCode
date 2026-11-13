# セットリスト管理アプリ

バンドの曲とセットリストを管理する Web アプリです。ライブ中にスマホで見やすいよう、暗い背景と大きな文字にしています。

- 曲の登録・編集・削除（曲名・キー・チューニング・演奏時間・メモ）
- セットリストの作成・編集・削除（タイトル・日付・会場）。曲の追加・削除・並べ替え（↑↓ボタン）
- 合計演奏時間を自動で計算
- ユーザー登録・ログイン。自分のデータだけが見えます
- 曲とセットリストを CSV で書き出し（Excel でも開けます）

構成：Flask / Flask-Login / Flask-SQLAlchemy / Flask-WTF（CSRF 対策）。DB はローカルなら SQLite、本番は Supabase（PostgreSQL）。Web サーバーは Render + gunicorn です。

---

## 1. ローカルでの起動方法

ターミナルでリポジトリのフォルダ（`ClaudeCode`）に移動してから、次の順に実行します。

1. 仮想環境を有効にする
   ```bash
   source .venv/bin/activate
   ```
2. ライブラリを入れる
   ```bash
   pip install -r setlist_app/requirements.txt
   ```
3. 見本をコピーして `.env` を作る
   ```bash
   cp setlist_app/.env.example setlist_app/.env
   ```
4. 秘密の文字列（SECRET_KEY）を作る。表示された英数字をコピーします
   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```
5. `setlist_app/.env` をエディタで開き、`SECRET_KEY=` の後ろに貼り付けて保存します。`DATABASE_URL=` は空のままで大丈夫です（ローカルの SQLite ファイル `setlist.db` が自動で作られます）
6. 起動する
   ```bash
   cd setlist_app
   python app.py
   ```
7. ブラウザで http://127.0.0.1:5002 を開き、「ユーザー登録」から使い始めます。止めるときはターミナルで `Ctrl + C` を押します
8. （任意）テストを実行する：`python -m unittest -v`

> スマホから試したいとき：Mac と同じ Wi-Fi につなぎ、`python app.py` の代わりに `flask --app app run --host 0.0.0.0 --port 5002` で起動します。スマホで `http://（Mac の IP アドレス）:5002` を開きます。

## 2. Supabase でプロジェクトを作り、接続文字列を取得する方法

1. https://supabase.com を開き、「Start your project」から GitHub アカウントなどでサインアップします
2. 「New project」を押し、次のように入力します
   - **Name**：`setlist` など好きな名前
   - **Database Password**：「Generate a password」で作り、**どこかに必ず控えます**（あとで使います）。記号が入っていると接続文字列で困ることがあるので、英数字だけのパスワードにしておくと安全です
   - **Region**：Render と同じ地域にすると速くなります。この手順では **Southeast Asia (Singapore)** を選びます
3. 「Create new project」を押し、準備が終わるまで 1〜2 分待ちます
4. 画面上部の **「Connect」** ボタンを押します
5. 「Connection String」タブで、**Method を「Session pooler」** にします
6. 表示された次のような文字列をコピーします
   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
7. `[YOUR-PASSWORD]` の部分（角かっこも含む）を、手順 2 で控えたパスワードに置き換えます。これが **DATABASE_URL** です。他人に見せないでください

### 接続方式の違い（なぜ Session pooler なのか）

| 方式 | ホスト名とポート | Render から使えるか |
|---|---|---|
| Direct connection（直接接続） | `db.xxxx.supabase.co:5432` | ✕ IPv6 専用。Render は IPv6 で外に出られないため接続できない（有料の IPv4 アドオンを使えば可） |
| Transaction pooler | `....pooler.supabase.com:6543` | △ つながるが、短時間のサーバーレス向け。psycopg が自動で使うプリペアドステートメントに対応しておらず、エラーになることがある |
| **Session pooler** | `....pooler.supabase.com:5432` | ◎ IPv4 で使え、Render のように常に動き続けるサーバーに向いている |

### `postgres://` と `postgresql://` の違い

どちらも PostgreSQL を表す書き方ですが、このアプリが使う SQLAlchemy は `postgres://` を受け付けません。このアプリでは、どちらで書かれていても起動時に自動で `postgresql+psycopg://`（psycopg 3 ドライバを使う形）に書き換えます。コピーした文字列をそのまま使って大丈夫です。

## 3. GitHub へのプッシュ方法

このアプリはリポジトリ `ClaudeCode` の中のフォルダなので、リポジトリごとプッシュします。

1. リポジトリのフォルダに移動します：`cd ~/projects/ClaudeCode`
2. 変更を確認し、**`.env` が一覧に出ていないこと**を確かめます（出ていたら秘密が漏れるので止めてください）
   ```bash
   git status
   ```
3. 追加してコミットします
   ```bash
   git add setlist_app .gitignore CLAUDE.md
   git commit -m "セットリスト管理アプリを追加する"
   ```
4. GitHub に送ります
   ```bash
   git push origin main
   ```
5. GitHub のリポジトリのページを開き、`setlist_app` フォルダがあり、`.env` が無いことを確認します

## 4. Render で Web サービスを作り、デプロイする方法

1. https://render.com にログインします（GitHub アカウントでログインすると楽です）
2. 右上の **「+ New」→「Web Service」** を選びます
3. 「Git Provider」で GitHub のリポジトリ **`ClaudeCode`** を選んで「Connect」を押します（初めてなら、Render に GitHub へのアクセスを許可する画面が出ます）
4. 設定を次のように入力します

   | 項目 | 入力する値 |
   |---|---|
   | Name | `setlist-app`（URL の一部になります） |
   | Language（Runtime） | `Python 3` |
   | Branch | `main` |
   | Region | `Singapore`（Supabase と同じ地域） |
   | **Root Directory** | `setlist_app` |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `gunicorn --bind 0.0.0.0:$PORT "app:create_app()"` |
   | Instance Type | `Free` |

5. 下の **「Environment Variables」** で 2 つ追加します
   - `DATABASE_URL`：Supabase の手順 7 で作った接続文字列
   - `SECRET_KEY`：右側の「Generate」を押すと自動で作られます（ローカルの値とは別で構いません）
6. **「Deploy Web Service」** を押します。ログが流れ、`Your service is live 🎉` と出たら完了です（数分かかります）
7. 画面左上に表示される `https://setlist-app-xxxx.onrender.com` がアプリのアドレスです

以後は `main` にプッシュするたびに自動で再デプロイされます。Python のバージョンは `setlist_app/.python-version`（3.13）で指定しています。

## 5. デプロイ後の動作確認方法

1. Render のアドレスを開き、ログイン画面が出ることを確認します（無料プランは 15 分使わないと眠るので、最初の表示に 1 分ほどかかることがあります）
2. 「ユーザー登録」で新しいユーザーを作ります
3. 「曲」から 2〜3 曲を登録します（演奏時間は `4:35` の形式）
4. 「セトリ」→「＋ 新規作成」でセットリストを作り、曲を追加して ↑↓ で並べ替え、合計時間が合っているか確かめます
5. **データが Supabase に入っているか確認**：Supabase の左メニュー「Table Editor」を開き、`users`・`songs`・`setlists`・`setlist_items` のテーブルにデータがあれば成功です。パスワードの列（`password_hash`）がハッシュ化された文字列になっていることも確認できます
6. **再起動してもデータが消えないか確認**：Render の「Manual Deploy」→「Deploy latest commit」で再デプロイし、もう一度ログインしてデータが残っていれば OK です
7. **ユーザーごとに分かれているか確認**：ログアウトして別のユーザーを登録し、1 人目の曲やセットリストが見えないことを確かめます
8. 「CSV」から 2 つのファイルをダウンロードし、Excel などで開けることを確認します
9. スマホでも同じアドレスを開き、ライブ表示（セットリストをタップした画面）が読みやすいか確認します

### うまくいかないとき

- Render のログに `SECRET_KEY が設定されていません` → 環境変数 `SECRET_KEY` を確認
- `password authentication failed` → `DATABASE_URL` のパスワード部分を確認（`[ ]` を消し忘れていないか）
- `Network is unreachable` や接続タイムアウト → Direct connection の文字列を使っていないか確認（Session pooler のものに変える）
- Supabase の無料プランは 1 週間アクセスが無いとプロジェクトが一時停止します。ライブ前にはアプリを一度開いておき、止まっていたら Supabase の画面で「Restore」してください
