# かぞくのタスク

家族で使うシンプルなタスクリスト。Flask + Supabase（PostgreSQL）で作り、Vercel で公開する。

- タスクをタップすると二重線で消える（もう一度タップで戻る）
- 「子供の朝のしたく」などのテンプレートを作って、そこからリストを作れる。リストをテンプレートとして保存もできる
- 「全部もどす」で毎日くり返すリストを未完了に戻せる
- 家族共通の合言葉でログイン。全員が同じリストを見る（1 年間ログインしたまま）
- スマホのホーム画面に追加するとアプリのように使える（PWA）

## ローカルで動かす

```bash
source .venv/bin/activate                  # リポジトリのルートで
pip install -r todo2_app/requirements.txt
cp todo2_app/.env.example todo2_app/.env   # SECRET_KEY と FAMILY_PASSWORD を入れる
cd todo2_app && python app.py              # http://127.0.0.1:5003
cd todo2_app && python -m unittest -v      # テスト
```

`DATABASE_URL` が空ならローカルの SQLite（`todo2.db`）を使う。

## 公開の手順（Supabase + Vercel）

### 1. Supabase でデータベースを用意する

1. https://supabase.com で新しいプロジェクトを作る（Region は **Northeast Asia (Tokyo)**）。データベースのパスワードは控えておく
2. 画面上の **Connect** → **Connection String** で **Transaction pooler**（ポート **6543**）の URI をコピーする
   - `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
   - `[YOUR-PASSWORD]` を控えたパスワードに置きかえる
   - Vercel は IPv6 の直接接続（Direct connection）に届かないので pooler を使う。Vercel は 1 リクエストごとに関数が動くので、短い接続向けの Transaction pooler が合う

テーブルはアプリが最初に動いたときに自動で作る。Supabase の REST API から読み書きされないよう、全テーブルの RLS も自動で有効にする。

### 2. Vercel にデプロイする

1. https://vercel.com に GitHub アカウントでサインアップする（Hobby プランは無料）
2. **Add New… → Project** で GitHub のこのリポジトリを **Import**
3. 設定画面で
   - **Root Directory**：`todo2_app`（Edit から選ぶ）
   - **Framework Preset**：Flask（自動で選ばれる。違えば Flask を選ぶ）
   - **Environment Variables** に 3 つ入れる
     - `SECRET_KEY`：`python -c "import secrets; print(secrets.token_hex(32))"` で作った文字列
     - `FAMILY_PASSWORD`：家族で使う合言葉（**8 文字以上**。短いと起動しない。誕生日などの推測しやすいものは避ける）
     - `DATABASE_URL`：手順 1 の接続文字列
4. **Deploy** を押す。終わると `https://〇〇.vercel.app` のアドレスが出る

以後は `main` へのプッシュで自動的にデプロイし直される。環境変数を変えたときは、Vercel の Deployments から **Redeploy** すると反映される。

`vercel.json` で関数を東京リージョン（`hnd1`）で動かし、Supabase（東京）との行き来を速くしている。

### 3. スマホのホーム画面に追加する

- **iPhone（Safari）**：共有ボタン → 「ホーム画面に追加」
- **Android（Chrome）**：メニュー（︙）→ 「ホーム画面に追加」または「アプリをインストール」

家族それぞれのスマホでアドレスを開き、合言葉でログインしてから追加する。

## セキュリティ

- 合言葉は同じ IP から 15 分に 10 回まちがえると、しばらく受け付けない（総当たり対策）
- **スマホをなくしたときなど**は、Vercel の環境変数 `FAMILY_PASSWORD` を変えて Redeploy すると、全員のログインが切れる（家族は新しい合言葉で入り直す）
- セッションのクッキーには合言葉そのものは入れない。HTTPS のときだけ送る設定
- フォームはすべて CSRF トークンで守り、CSP でこのサイト以外のスクリプトを動かさない
- Supabase との通信は TLS を必須にし、全テーブルの RLS を有効にして REST API（anon key）からは読み書きできないようにしている
- ログイン後の画面はブラウザに保存させず（`Cache-Control: no-store`）、検索エンジンにも載せない

## 構成

- `app.py` — Vercel の入口（`app` を公開する）。ローカルでは `python app.py` で起動
- `webapp.py` — アプリファクトリ `create_app()`。DB 接続、RLS の有効化、セキュリティヘッダー
- `views.py` — 画面とフォームの処理（ログイン・リスト・タスク・テンプレート）
- `models.py` — `TaskList` / `Task` / `Template` / `TemplateItem`
- `templates/` — Jinja テンプレート
- `public/` — CSS・JS・アイコン・`manifest.webmanifest`・`sw.js`。Vercel では CDN から直接配信され、ローカルでは Flask が同じ URL で出す
