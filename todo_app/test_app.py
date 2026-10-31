import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
