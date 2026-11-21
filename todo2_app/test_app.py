import os
import tempfile
import unittest

from models import Task, TaskList, Template, db
from webapp import create_app, normalize_database_url


class 変換関数Test(unittest.TestCase):
    def test_接続文字列の変換(self):
        self.assertEqual(
            normalize_database_url("postgres://u:p@host:6543/postgres"),
            "postgresql+psycopg://u:p@host:6543/postgres",
        )
        self.assertEqual(
            normalize_database_url("postgresql://u:p@host:6543/postgres"),
            "postgresql+psycopg://u:p@host:6543/postgres",
        )
        self.assertEqual(normalize_database_url("sqlite:///x.db"), "sqlite:///x.db")


class FamilyTaskAppTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test",
            "FAMILY_PASSWORD": "aikotoba",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(self.tmpdir.name, 'test.db')}",
            "WTF_CSRF_ENABLED": False,
        })
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.engine.dispose()
        self.tmpdir.cleanup()

    # --- 補助 ---

    def login(self, client=None):
        return (client or self.client).post("/login", data={"password": "aikotoba"})

    def create_list(self, name="買い物", template_id=""):
        return self.client.post("/lists/new", data={"name": name, "template_id": template_id})

    def one(self, model, **filters):
        return db.session.scalars(db.select(model).filter_by(**filters)).one()

    # --- ログイン ---

    def test_ログインしないと見られない(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 302)
        self.assertIn("/login", res.headers["Location"])
        self.assertEqual(self.client.post("/lists/new", data={"name": "x"}).status_code, 302)

    def test_合言葉が違うとログインできない(self):
        res = self.client.post("/login", data={"password": "ちがう"})
        self.assertIn("合言葉が違います", res.get_data(as_text=True))
        self.assertEqual(self.client.get("/").status_code, 302)

    def test_ログインとログアウト(self):
        self.login()
        self.assertEqual(self.client.get("/").status_code, 200)
        self.client.post("/logout")
        self.assertEqual(self.client.get("/").status_code, 302)

    def test_まちがいが続くとしばらくログインできない(self):
        for _ in range(10):
            self.client.post("/login", data={"password": "ちがう"})
        # 正しい合言葉でも止まる
        res = self.client.post("/login", data={"password": "aikotoba"})
        self.assertEqual(res.status_code, 429)
        self.assertEqual(self.client.get("/").status_code, 302)

    def test_ログインに成功するとまちがいの回数は消える(self):
        for _ in range(9):
            self.client.post("/login", data={"password": "ちがう"})
        self.login()
        self.client.post("/logout")
        for _ in range(9):
            self.client.post("/login", data={"password": "ちがう"})
        self.assertEqual(self.login().status_code, 302)

    def test_合言葉を変えると全員ログアウトされる(self):
        self.login()
        self.assertEqual(self.client.get("/").status_code, 200)
        self.app.config["FAMILY_PASSWORD"] = "new-aikotoba"
        res = self.client.get("/")
        self.assertEqual(res.status_code, 302)
        self.assertIn("/login", res.headers["Location"])

    def test_セッションに合言葉そのものは入らない(self):
        import base64, zlib
        self.login()
        cookie = self.client.get_cookie("session").value
        payload = cookie.lstrip(".").split(".")[0]
        data = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
        if cookie.startswith("."):
            data = zlib.decompress(data)
        self.assertNotIn(b"aikotoba", data)

    def test_セキュリティヘッダー(self):
        self.login()
        res = self.client.get("/")
        csp = res.headers["Content-Security-Policy"]
        self.assertIn("script-src 'self'", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        self.assertEqual(res.headers["X-Frame-Options"], "DENY")
        self.assertEqual(res.headers["Cache-Control"], "no-store")
        self.assertIn("noindex", res.headers["X-Robots-Tag"])

    def test_一度に追加できる行数には上限がある(self):
        self.login()
        self.create_list()
        list_id = self.list_id("買い物")
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "\n".join(f"t{i}" for i in range(150))})
        with self.app.app_context():
            self.assertEqual(len(db.session.get(TaskList, list_id).tasks), 100)

    def test_CSRFトークンが無い送信は断る(self):
        app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test",
            "FAMILY_PASSWORD": "aikotoba",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(self.tmpdir.name, 'csrf.db')}",
        })
        client = app.test_client()
        self.assertEqual(client.post("/login", data={"password": "aikotoba"}).status_code, 400)
        with app.app_context():
            db.engine.dispose()

    def test_アプリ用のファイルはログインなしで取れる(self):
        for path in ("/manifest.webmanifest", "/sw.js", "/style.css", "/app.js", "/icons/icon-192.png"):
            res = self.client.get(path)
            self.assertEqual(res.status_code, 200, path)
            res.close()

    # --- リストとタスク ---

    def test_リストを作ってタスクをまとめて追加(self):
        self.login()
        res = self.create_list("買い物")
        with self.app.app_context():
            task_list = self.one(TaskList, name="買い物")
            self.assertTrue(res.headers["Location"].endswith(f"/lists/{task_list.id}"))
            list_id = task_list.id
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "牛乳\n\n  パン  \n卵"})
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "バター"})
        with self.app.app_context():
            titles = [t.title for t in db.session.get(TaskList, list_id).tasks]
        self.assertEqual(titles, ["牛乳", "パン", "卵", "バター"])
        html = self.client.get(f"/lists/{list_id}").get_data(as_text=True)
        self.assertIn("牛乳", html)
        self.assertIn("0 / 4", html)

    def test_名前が空のリストは作れない(self):
        self.login()
        self.create_list("  ")
        with self.app.app_context():
            self.assertEqual(db.session.scalar(db.select(db.func.count(TaskList.id))), 0)

    def test_完了の切り替えで二重線のクラスが付く(self):
        self.login()
        self.create_list()
        with self.app.app_context():
            list_id = self.one(TaskList, name="買い物").id
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "牛乳\nパン"})
        with self.app.app_context():
            task_id = self.one(Task, title="牛乳").id

        res = self.client.post(f"/tasks/{task_id}/toggle", headers={"Accept": "application/json"})
        self.assertEqual(res.get_json(), {"done": True, "done_count": 1, "total": 2})
        html = self.client.get(f"/lists/{list_id}").get_data(as_text=True)
        self.assertIn('class="task done"', html)
        self.assertIn("1 / 2", html)

        # JS なし（普通のフォーム送信）ではリストに戻る
        res = self.client.post(f"/tasks/{task_id}/toggle")
        self.assertEqual(res.status_code, 302)
        with self.app.app_context():
            self.assertFalse(db.session.get(Task, task_id).done)

    def test_全部もどすと終わったものを消す(self):
        self.login()
        self.create_list()
        with self.app.app_context():
            list_id = self.one(TaskList, name="買い物").id
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "a\nb\nc"})
        with self.app.app_context():
            ids = [t.id for t in db.session.get(TaskList, list_id).tasks]
        self.client.post(f"/tasks/{ids[0]}/toggle")
        self.client.post(f"/tasks/{ids[1]}/toggle")

        self.client.post(f"/lists/{list_id}/reset")
        with self.app.app_context():
            self.assertEqual([t.done for t in db.session.get(TaskList, list_id).tasks], [False] * 3)

        self.client.post(f"/tasks/{ids[0]}/toggle")
        self.client.post(f"/lists/{list_id}/clear-done")
        with self.app.app_context():
            self.assertEqual([t.title for t in db.session.get(TaskList, list_id).tasks], ["b", "c"])

    def test_タスクとリストの削除(self):
        self.login()
        self.create_list()
        with self.app.app_context():
            list_id = self.one(TaskList, name="買い物").id
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "a\nb"})
        with self.app.app_context():
            task_id = self.one(Task, title="a").id
        self.client.post(f"/tasks/{task_id}/delete")
        self.client.post(f"/lists/{list_id}/delete")
        with self.app.app_context():
            self.assertIsNone(db.session.get(TaskList, list_id))
            self.assertEqual(db.session.scalar(db.select(db.func.count(Task.id))), 0)

    def test_存在しないIDは404(self):
        self.login()
        self.assertEqual(self.client.get("/lists/999").status_code, 404)
        self.assertEqual(self.client.post("/tasks/999/toggle").status_code, 404)
        self.assertEqual(self.client.get("/templates/999").status_code, 404)
        self.assertEqual(self.client.post("/lists/new", data={"name": "", "template_id": "999"}).status_code, 404)

    # --- テンプレート ---

    def make_template(self, name="朝のしたく", items="はみがき\n着がえ\nハンカチ"):
        self.client.post("/templates/new", data={"name": name})
        with self.app.app_context():
            template_id = self.one(Template, name=name).id
        self.client.post(f"/templates/{template_id}/items", data={"title": items})
        return template_id

    def test_テンプレートからリストを作る(self):
        self.login()
        template_id = self.make_template()

        # 新しいリストの画面から（名前が空ならテンプレートの名前になる）
        self.create_list("", template_id=str(template_id))
        # テンプレートの画面から
        self.client.post(f"/templates/{template_id}/use", data={"name": "じろうの朝のしたく"})

        with self.app.app_context():
            for name in ("朝のしたく", "じろうの朝のしたく"):
                task_list = self.one(TaskList, name=name)
                self.assertEqual([t.title for t in task_list.tasks], ["はみがき", "着がえ", "ハンカチ"])

            # リストのタスクを完了してもテンプレートには影響しない
            task = self.one(TaskList, name="朝のしたく").tasks[0]
            task_id = task.id
        self.client.post(f"/tasks/{task_id}/toggle")
        self.client.post(f"/lists/{self.list_id('朝のしたく')}/tasks", data={"title": "追加"})
        with self.app.app_context():
            self.assertEqual(len(db.session.get(Template, template_id).items), 3)

    def list_id(self, name):
        with self.app.app_context():
            return self.one(TaskList, name=name).id

    def test_リストをテンプレートとして保存(self):
        self.login()
        self.create_list("たろうの持ち物")
        list_id = self.list_id("たろうの持ち物")
        self.client.post(f"/lists/{list_id}/tasks", data={"title": "水筒\n帽子"})
        self.client.post(f"/lists/{list_id}/save-template", data={"name": "遠足"})
        with self.app.app_context():
            template = self.one(Template, name="遠足")
            self.assertEqual([i.title for i in template.items], ["水筒", "帽子"])

    def test_テンプレートの中身の削除と名前の変更と削除(self):
        self.login()
        template_id = self.make_template()
        with self.app.app_context():
            item_id = db.session.get(Template, template_id).items[1].id
        self.client.post(f"/template-items/{item_id}/delete")
        self.client.post(f"/templates/{template_id}/rename", data={"name": "あさ"})
        with self.app.app_context():
            template = db.session.get(Template, template_id)
            self.assertEqual(template.name, "あさ")
            self.assertEqual([i.title for i in template.items], ["はみがき", "ハンカチ"])

        # テンプレートを消しても、そこから作ったリストは残る
        self.client.post(f"/templates/{template_id}/use", data={"name": ""})
        self.client.post(f"/templates/{template_id}/delete")
        with self.app.app_context():
            self.assertIsNone(db.session.get(Template, template_id))
            self.assertEqual(len(self.one(TaskList, name="あさ").tasks), 2)

    def test_家族の別の端末からも同じリストが見える(self):
        self.login()
        self.create_list("家族の買い物")
        other = self.app.test_client()
        self.login(other)
        self.assertIn("家族の買い物", other.get("/").get_data(as_text=True))


class 設定Test(unittest.TestCase):
    def test_合言葉が無いと起動しない(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError):
                create_app({
                    "SECRET_KEY": "x",
                    "FAMILY_PASSWORD": None,
                    "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(d, 't.db')}",
                })

    def test_本番では短い合言葉では起動しない(self):
        os.environ["VERCEL"] = "1"
        try:
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(RuntimeError):
                    create_app({
                        "SECRET_KEY": "x" * 64,
                        "FAMILY_PASSWORD": "short",
                        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(d, 't.db')}",
                    })
        finally:
            del os.environ["VERCEL"]

    def test_本番のDB接続は暗号化を必須にする(self):
        from webapp import engine_options
        opts = engine_options("postgresql://u:p@h:6543/postgres")
        self.assertEqual(opts["connect_args"]["sslmode"], "require")
        self.assertIsNone(opts["connect_args"]["prepare_threshold"])
        opts = engine_options("postgresql://u:p@h:6543/postgres?sslmode=verify-full")
        self.assertNotIn("sslmode", opts["connect_args"])
        self.assertEqual(engine_options(None), {})
        self.assertEqual(engine_options("sqlite:///x.db"), {})
        opts = engine_options("postgresql+psycopg://u:p@h:6543/postgres")
        self.assertEqual(opts["connect_args"]["sslmode"], "require")


if __name__ == "__main__":
    unittest.main()
