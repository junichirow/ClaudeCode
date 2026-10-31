import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import create_app


class TodoAppTest(unittest.TestCase):
    def setUp(self):
        # テストごとに一時的なデータベースを使う
        self.tmpdir = tempfile.TemporaryDirectory()
        app = create_app(Path(self.tmpdir.name) / "test.db")
        self.client = app.test_client()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_空の一覧(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn("タスクはまだありません", res.get_data(as_text=True))

    def test_追加すると一覧に表示される(self):
        self.client.post("/add", data={"title": "牛乳を買う"})
        self.assertIn("牛乳を買う", self.client.get("/").get_data(as_text=True))

    def test_空のタイトルは追加しない(self):
        self.client.post("/add", data={"title": "   "})
        self.assertIn("タスクはまだありません", self.client.get("/").get_data(as_text=True))

    def test_完了と戻す(self):
        self.client.post("/add", data={"title": "掃除"})
        self.client.post("/toggle/1")
        self.assertIn('class="done"', self.client.get("/").get_data(as_text=True))
        self.client.post("/toggle/1")
        self.assertNotIn('class="done"', self.client.get("/").get_data(as_text=True))

    def test_削除(self):
        self.client.post("/add", data={"title": "洗濯"})
        self.client.post("/delete/1")
        self.assertNotIn("洗濯", self.client.get("/").get_data(as_text=True))

    def test_存在しないIDは404(self):
        self.assertEqual(self.client.post("/toggle/999").status_code, 404)
        self.assertEqual(self.client.post("/delete/999").status_code, 404)

    def test_他サイトからの送信は403(self):
        res = self.client.post(
            "/add", data={"title": "攻撃"}, headers={"Origin": "https://evil.example"}
        )
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("攻撃", self.client.get("/").get_data(as_text=True))

    def test_同じサイトからの送信は許可(self):
        res = self.client.post(
            "/add", data={"title": "買い物"}, headers={"Origin": "http://localhost"}
        )
        self.assertEqual(res.status_code, 302)


class LoginTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        app = create_app(
            Path(self.tmpdir.name) / "test.db", username="user", password="secret"
        )
        self.client = app.test_client()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_ログインなしは401(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 401)
        self.assertIn("Basic", res.headers["WWW-Authenticate"])

    def test_パスワード違いは401(self):
        res = self.client.get("/", auth=("user", "wrong"))
        self.assertEqual(res.status_code, 401)

    def test_正しいパスワードで表示できる(self):
        res = self.client.get("/", auth=("user", "secret"))
        self.assertEqual(res.status_code, 200)

    def test_Render上でパスワード未設定なら起動しない(self):
        with mock.patch.dict(os.environ, {"RENDER": "true"}):
            with self.assertRaises(RuntimeError):
                create_app(Path(self.tmpdir.name) / "test.db", password=None)


if __name__ == "__main__":
    unittest.main()
