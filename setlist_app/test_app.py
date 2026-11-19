import os
import re
import sqlite3
import tempfile
import unittest

from app import create_app, normalize_database_url
from durations import format_duration, parse_duration
from models import Setlist, SetlistItem, Song, db


class 変換関数Test(unittest.TestCase):
    def test_接続文字列の変換(self):
        self.assertEqual(
            normalize_database_url("postgres://u:p@host:5432/postgres"),
            "postgresql+psycopg://u:p@host:5432/postgres",
        )
        self.assertEqual(
            normalize_database_url("postgresql://u:p@host:5432/postgres"),
            "postgresql+psycopg://u:p@host:5432/postgres",
        )
        self.assertEqual(normalize_database_url("sqlite:///x.db"), "sqlite:///x.db")

    def test_演奏時間の読み取り(self):
        self.assertEqual(parse_duration("4:35"), 275)
        self.assertEqual(parse_duration(" 4:05 "), 245)
        self.assertEqual(parse_duration("12：00"), 720)
        self.assertIsNone(parse_duration(""))
        for bad in ("4", "4:6", "4:60", "abc", "-1:00"):
            with self.assertRaises(ValueError):
                parse_duration(bad)

    def test_演奏時間の表示(self):
        self.assertEqual(format_duration(275), "4:35")
        self.assertEqual(format_duration(5), "0:05")
        self.assertEqual(format_duration(3930), "1:05:30")
        self.assertEqual(format_duration(None), "")


def create_user(app, username="alice", password="password123"):
    from werkzeug.security import generate_password_hash
    from models import User
    with app.app_context():
        db.session.add(User(username=username, password_hash=generate_password_hash(password)))
        db.session.commit()


class SetlistAppTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(self.tmpdir.name, 'test.db')}",
            "WTF_CSRF_ENABLED": False,
        })
        self.client = self.app.test_client()

    def tearDown(self):
        with self.app.app_context():
            db.engine.dispose()
        self.tmpdir.cleanup()

    # --- 補助 ---

    def register(self, username="alice", password="password123", client=None):
        """新規登録は無効なので、ユーザーを DB に直接作ってからログインする"""
        create_user(self.app, username, password)
        return (client or self.client).post("/login", data={
            "username": username,
            "password": password,
        })

    def add_song(self, title="曲A", duration="4:00", **extra):
        data = {"title": title, "key": "", "tuning": "", "duration": duration, "memo": ""}
        data.update(extra)
        return self.client.post("/songs/new", data=data)

    def song_id(self, title):
        with self.app.app_context():
            return db.session.scalar(db.select(Song.id).filter_by(title=title))

    def add_setlist(self, title="ライブ"):
        self.client.post("/setlists/new", data={"title": title, "date": "2026-12-01", "venue": "下北沢"})
        with self.app.app_context():
            return db.session.scalar(db.select(Setlist.id).filter_by(title=title))

    def item_titles(self, setlist_id):
        with self.app.app_context():
            setlist = db.session.get(Setlist, setlist_id)
            return [item.song.title for item in setlist.items]

    # --- 認証 ---

    def test_未ログインならログイン画面へ(self):
        for path in ("/setlists/", "/songs/", "/export/songs.csv"):
            res = self.client.get(path)
            self.assertEqual(res.status_code, 302, path)
            self.assertIn("/login", res.headers["Location"])

    def test_登録とログアウトとログイン(self):
        res = self.register()
        self.assertEqual(res.status_code, 302)
        self.assertEqual(self.client.get("/setlists/").status_code, 200)

        self.client.post("/logout")
        self.assertEqual(self.client.get("/setlists/").status_code, 302)

        res = self.client.post("/login", data={"username": "alice", "password": "wrong-pass"})
        self.assertIn("ユーザー名かパスワードが違います", res.get_data(as_text=True))

        res = self.client.post("/login", data={"username": "alice", "password": "password123"})
        self.assertEqual(res.status_code, 302)
        self.assertEqual(self.client.get("/setlists/").status_code, 200)

    def test_パスワードはハッシュ化して保存(self):
        self.register()
        from models import User
        with self.app.app_context():
            user = db.session.scalar(db.select(User).filter_by(username="alice"))
            self.assertNotIn("password123", user.password_hash)

    def test_登録ページはログイン画面へ移動する(self):
        res = self.client.get("/register")
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res.headers["Location"].endswith("/login"))

        res = self.client.post("/register", data={
            "username": "mallory", "password": "password123", "password_confirm": "password123",
        })
        self.assertEqual(res.status_code, 302)
        self.assertTrue(res.headers["Location"].endswith("/login"))
        from models import User
        with self.app.app_context():
            self.assertIsNone(db.session.scalar(db.select(User).filter_by(username="mallory")))

    def test_ログイン画面に登録リンクが無い(self):
        self.assertNotIn("/register", self.client.get("/login").get_data(as_text=True))

    def test_ログイン後の戻り先は自サイトだけ(self):
        self.register()
        self.client.post("/logout")
        res = self.client.post(
            "/login?next=//evil.example.com",
            data={"username": "alice", "password": "password123"},
        )
        self.assertEqual(res.headers["Location"], "/setlists/")

    # --- 曲 ---

    def test_曲の登録と編集と削除(self):
        self.register()
        self.add_song("曲A", "4:35", key="Em", tuning="Drop D", bpm="128", memo="カポ2")
        page = self.client.get("/songs/").get_data(as_text=True)
        for text in ("曲A", "4:35", "Em", "Drop D", "♩=128", "カポ2"):
            self.assertIn(text, page)

        song_id = self.song_id("曲A")
        self.client.post(f"/songs/{song_id}/edit", data={
            "title": "曲A改", "key": "G", "tuning": "", "duration": "3:00", "memo": "",
        })
        page = self.client.get("/songs/").get_data(as_text=True)
        self.assertIn("曲A改", page)
        self.assertIn("3:00", page)
        self.assertNotIn("♩=", page)  # テンポを消したら表示されない

        self.client.post(f"/songs/{song_id}/delete")
        self.assertIsNone(self.song_id("曲A改"))
        self.assertIn("まだ曲がありません", self.client.get("/songs/").get_data(as_text=True))

    def test_同じ内容を2回送信しても曲は1つ(self):
        self.register()
        self.add_song("曲A", "4:35", key="Em")
        self.add_song("曲A", "4:35", key="Em")  # 保存ボタンの二重送信
        self.add_song("曲A", "4:35", key="G")   # 内容が違えば別の曲として登録できる
        with self.app.app_context():
            keys = db.session.scalars(db.select(Song.key).filter_by(title="曲A").order_by(Song.id)).all()
        self.assertEqual(keys, ["Em", "G"])

    def test_フォームの二重送信を防ぐスクリプトを読み込む(self):
        self.register()
        self.assertIn("submit-once.js", self.client.get("/songs/new").get_data(as_text=True))

    def test_歌詞を書いて保存できる(self):
        self.register()
        self.add_song("曲A")
        song_id = self.song_id("曲A")
        page = self.client.get("/songs/").get_data(as_text=True)
        self.assertIn(f"/songs/{song_id}/lyrics", page)

        res = self.client.post(f"/songs/{song_id}/lyrics",
                               data={"lyrics": "1 番の歌詞\r\n\r\nサビ & <コーラス>\r\n"})
        self.assertEqual(res.status_code, 302)
        with self.app.app_context():
            self.assertEqual(db.session.get(Song, song_id).lyrics, "1 番の歌詞\n\nサビ & <コーラス>")

        page = self.client.get(f"/songs/{song_id}/lyrics").get_data(as_text=True)
        self.assertIn("1 番の歌詞\n\nサビ &amp; &lt;コーラス&gt;", page)  # エスケープされて表示される

    def test_ライブ表示で歌詞を開ける(self):
        self.register()
        self.add_song("曲A")
        self.add_song("曲B")
        self.client.post(f"/songs/{self.song_id('曲A')}/lyrics", data={"lyrics": "1 番\n<サビ>"})
        setlist_id = self.add_setlist("ワンマン")
        for title in ("曲A", "曲B"):
            self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id(title)})
        page = self.client.get(f"/setlists/{setlist_id}").get_data(as_text=True)
        # 歌詞のある曲 A にだけ「歌詞」ボタンが付く
        self.assertEqual(page.count('<details class="lyrics">'), 1)
        self.assertIn('<div class="lyrics-text">1 番\n&lt;サビ&gt;</div>', page)
        self.assertLess(page.index('<span class="live-title">曲A'), page.index("lyrics-text"))
        self.assertLess(page.index("lyrics-text"), page.index('<span class="live-title">曲B'))
        # 印刷には歌詞を入れない
        self.assertNotIn("サビ", self.client.get(f"/setlists/{setlist_id}/print").get_data(as_text=True))

    def test_演奏時間の形式が違うと登録できない(self):
        self.register()
        res = self.add_song("曲A", "4分35秒")
        self.assertIn("分:秒", res.get_data(as_text=True))
        self.assertIsNone(self.song_id("曲A"))

    def test_テンポの形式が違うと登録できない(self):
        self.register()
        for bpm in ("abc", "10", "500", "120.5"):
            res = self.add_song("曲A", bpm=bpm)
            self.assertIn("テンポは 20〜400", res.get_data(as_text=True))
            self.assertIsNone(self.song_id("曲A"))

    def test_テンポ列が無い古いDBにも列を追加する(self):
        path = os.path.join(self.tmpdir.name, "old.db")
        with sqlite3.connect(path) as conn:
            conn.execute(
                "CREATE TABLE songs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,"
                " title VARCHAR(200) NOT NULL, key VARCHAR(20) NOT NULL,"
                " tuning VARCHAR(50) NOT NULL, duration_seconds INTEGER, memo TEXT NOT NULL)"
            )
            conn.execute("INSERT INTO songs VALUES (1, 1, '既存の曲', '', '', 240, '')")
        app = create_app({"TESTING": True, "SECRET_KEY": "test",
                          "SQLALCHEMY_DATABASE_URI": f"sqlite:///{path}"})
        with app.app_context():
            song = db.session.get(Song, 1)
            self.assertEqual(song.title, "既存の曲")
            self.assertIsNone(song.bpm)
            self.assertEqual(song.lyrics, "")
            db.engine.dispose()

    def test_曲名は必須(self):
        self.register()
        res = self.add_song("")
        self.assertIn("曲名を入力してください", res.get_data(as_text=True))

    # --- セットリスト ---

    def test_セットリストの作成と編集と削除(self):
        self.register()
        setlist_id = self.add_setlist("ワンマン")
        page = self.client.get("/setlists/").get_data(as_text=True)
        self.assertIn("ワンマン", page)
        self.assertIn("2026/12/01", page)

        self.client.post(f"/setlists/{setlist_id}/edit", data={"title": "対バン", "date": "", "venue": "渋谷"})
        page = self.client.get(f"/setlists/{setlist_id}").get_data(as_text=True)
        self.assertIn("対バン", page)
        self.assertIn("渋谷", page)

        self.client.post(f"/setlists/{setlist_id}/delete")
        self.assertEqual(self.client.get(f"/setlists/{setlist_id}").status_code, 404)

    def test_曲の追加と並べ替えと削除と合計時間(self):
        self.register()
        self.add_song("一曲目", "4:30")
        self.add_song("二曲目", "3:45")
        self.add_song("三曲目", "")
        setlist_id = self.add_setlist()
        for title in ("一曲目", "二曲目", "三曲目"):
            self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id(title)})
        self.assertEqual(self.item_titles(setlist_id), ["一曲目", "二曲目", "三曲目"])

        page = self.client.get(f"/setlists/{setlist_id}").get_data(as_text=True)
        self.assertIn("8:15", page)  # 4:30 + 3:45
        self.assertIn("未入力の曲が 1 曲", page)

        with self.app.app_context():
            items = db.session.get(Setlist, setlist_id).items
            first_id, third_id = items[0].id, items[2].id

        self.client.post(f"/setlists/{setlist_id}/items/{third_id}/move", data={"direction": "up"})
        self.assertEqual(self.item_titles(setlist_id), ["一曲目", "三曲目", "二曲目"])
        self.client.post(f"/setlists/{setlist_id}/items/{first_id}/move", data={"direction": "down"})
        self.assertEqual(self.item_titles(setlist_id), ["三曲目", "一曲目", "二曲目"])
        # 端より先には動かない
        self.client.post(f"/setlists/{setlist_id}/items/{third_id}/move", data={"direction": "up"})
        self.assertEqual(self.item_titles(setlist_id), ["三曲目", "一曲目", "二曲目"])

        self.client.post(f"/setlists/{setlist_id}/items/{first_id}/delete")
        self.assertEqual(self.item_titles(setlist_id), ["三曲目", "二曲目"])
        with self.app.app_context():
            positions = [i.position for i in db.session.get(Setlist, setlist_id).items]
        self.assertEqual(positions, [0, 1])

    def test_曲を削除するとセットリストからも消える(self):
        self.register()
        self.add_song("曲A")
        setlist_id = self.add_setlist()
        song_id = self.song_id("曲A")
        self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": song_id})
        self.client.post(f"/songs/{song_id}/delete")
        self.assertEqual(self.item_titles(setlist_id), [])
        with self.app.app_context():
            self.assertEqual(db.session.scalar(db.select(db.func.count(SetlistItem.id))), 0)

    # --- 他人のデータ ---

    def test_他人のデータは見えないし操作できない(self):
        self.register("alice")
        self.add_song("アリスの曲")
        alice_song = self.song_id("アリスの曲")
        alice_setlist = self.add_setlist("アリスのライブ")

        bob = self.app.test_client()
        self.register("bob", client=bob)
        self.assertNotIn("アリスの曲", bob.get("/songs/").get_data(as_text=True))
        self.assertNotIn("アリスのライブ", bob.get("/setlists/").get_data(as_text=True))
        self.assertEqual(bob.get(f"/songs/{alice_song}/edit").status_code, 404)
        self.assertEqual(bob.post(f"/songs/{alice_song}/delete").status_code, 404)
        self.assertEqual(bob.get(f"/songs/{alice_song}/lyrics").status_code, 404)
        self.assertEqual(bob.post(f"/songs/{alice_song}/lyrics", data={"lyrics": "x"}).status_code, 404)
        self.assertEqual(bob.get(f"/setlists/{alice_setlist}").status_code, 404)
        self.assertEqual(bob.get(f"/setlists/{alice_setlist}/print").status_code, 404)
        self.assertEqual(bob.post(f"/setlists/{alice_setlist}/delete").status_code, 404)

        # 自分のセットリストに他人の曲は入れられない
        bob.post("/setlists/new", data={"title": "ボブのライブ", "date": "", "venue": ""})
        with self.app.app_context():
            bob_setlist = db.session.scalar(db.select(Setlist.id).filter_by(title="ボブのライブ"))
        bob.post(f"/setlists/{bob_setlist}/items/add", data={"song_id": alice_song})
        self.assertEqual(self.item_titles(bob_setlist), [])

        self.assertNotIn("アリス", bob.get("/export/songs.csv").data.decode("utf-8-sig"))
        self.assertNotIn("アリス", bob.get("/export/setlists.csv").data.decode("utf-8-sig"))

    # --- テンポの点滅 ---

    def test_テンポのある曲だけ曲名をタップできる(self):
        self.register()
        self.add_song("曲A", bpm="128")
        self.add_song("曲B")
        setlist_id = self.add_setlist("ワンマン")
        for title in ("曲A", "曲B"):
            self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id(title)})
        page = self.client.get(f"/setlists/{setlist_id}").get_data(as_text=True)
        self.assertIn('data-bpm="128"', page)
        self.assertEqual(page.count('class="live-title beat-toggle"'), 1)
        self.assertIn('<span class="live-title">曲B</span>', page)
        self.assertIn("metronome.js", page)
        self.assertEqual(self.client.get("/static/metronome.js").status_code, 200)

    # --- 印刷 ---

    def test_印刷用の画面(self):
        self.register()
        self.add_song("曲A", "4:35", key="Em", tuning="Drop D", bpm="128", memo="カポ2")
        self.add_song("曲B", "3:00")
        setlist_id = self.add_setlist("ワンマン")
        for title in ("曲A", "曲B"):
            self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id(title)})

        self.assertIn(f"/setlists/{setlist_id}/print",
                      self.client.get(f"/setlists/{setlist_id}").get_data(as_text=True))
        page = self.client.get(f"/setlists/{setlist_id}/print").get_data(as_text=True)
        self.assertIn("<title>ワンマン_20261201</title>", page)
        for text in ("下北沢", "2 曲・合計 7:35", "曲A", "曲B", "Em", "Drop D", "♩=128", "カポ2", "size-large"):
            self.assertIn(text, page)
        self.assertLess(page.index("曲A"), page.index("曲B"))

    def test_曲が多いと印刷の文字を小さくする(self):
        self.register()
        setlist_id = self.add_setlist("フェス")
        expected = {9: "size-large", 10: "size-medium", 13: "size-medium",
                    14: "size-small", 18: "size-small", 19: "size-xsmall"}
        for i in range(1, 20):
            self.add_song(f"曲{i}")
            self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id(f"曲{i}")})
            if i in expected:
                page = self.client.get(f"/setlists/{setlist_id}/print").get_data(as_text=True)
                self.assertIn(expected[i], page, f"{i} 曲")

    def test_メモのある曲は印刷の高さを多めに数える(self):
        self.register()
        setlist_id = self.add_setlist("ワンマン")
        for i in range(1, 8):
            self.add_song(f"曲{i}", memo="カポ2")
            self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id(f"曲{i}")})
        # メモなしなら 7 曲はいちばん大きい文字だが、メモ付き 7 曲は 9.1 曲分なので 1 段小さくなる
        page = self.client.get(f"/setlists/{setlist_id}/print").get_data(as_text=True)
        self.assertIn("size-medium", page)
        self.assertLess(page.index("曲1"), page.index('<span class="memo">カポ2</span>'))

    # --- CSV ---

    def test_CSV書き出し(self):
        self.register()
        self.add_song("曲A", "4:35", key="Em", bpm="120", memo="メモ, カンマ入り")
        setlist_id = self.add_setlist("ワンマン")
        self.client.post(f"/setlists/{setlist_id}/items/add", data={"song_id": self.song_id("曲A")})

        res = self.client.get("/export/songs.csv")
        self.assertEqual(res.mimetype, "text/csv")
        self.assertIn("attachment", res.headers["Content-Disposition"])
        self.assertTrue(res.data.startswith(b"\xef\xbb\xbf"))  # BOM
        text = res.data.decode("utf-8-sig")
        self.assertIn("曲名,キー,チューニング,テンポ,演奏時間,メモ", text)
        self.assertIn('曲A,Em,,120,4:35,"メモ, カンマ入り"', text)

        text = self.client.get("/export/setlists.csv").data.decode("utf-8-sig")
        self.assertIn("ワンマン,2026-12-01,下北沢,1,曲A,Em,,120,4:35", text)


class 本番設定Test(unittest.TestCase):
    """Render 上（環境変数 RENDER あり・HTTPS・CSRF 有効）と同じ条件で確認する"""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        os.environ["RENDER"] = "true"
        self.app = create_app({
            "TESTING": True,
            "SECRET_KEY": "test",
            "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(self.tmpdir.name, 'test.db')}",
        })
        self.client = self.app.test_client()

    def tearDown(self):
        del os.environ["RENDER"]
        with self.app.app_context():
            db.engine.dispose()
        self.tmpdir.cleanup()

    def test_HTTPSでトークンとRefererがあればログインできる(self):
        create_user(self.app)
        https = {"base_url": "https://localhost", "headers": {"X-Forwarded-Proto": "https"}}
        page = self.client.get("/login", **https).get_data(as_text=True)
        token = re.search(r'name="csrf_token" value="([^"]+)"', page).group(1)
        res = self.client.post("/login", data={
            "csrf_token": token, "username": "alice", "password": "password123",
        }, base_url="https://localhost",
            headers={"X-Forwarded-Proto": "https", "Referer": "https://localhost/login"})
        self.assertEqual(res.status_code, 302)
        self.assertIn("Secure", res.headers["Set-Cookie"])
        self.assertEqual(self.client.get("/setlists/", **https).status_code, 200)

    def test_他サイトからのRefererは拒否(self):
        https = {"base_url": "https://localhost", "headers": {"X-Forwarded-Proto": "https"}}
        page = self.client.get("/login", **https).get_data(as_text=True)
        token = re.search(r'name="csrf_token" value="([^"]+)"', page).group(1)
        res = self.client.post("/login", data={
            "csrf_token": token, "username": "alice", "password": "password123",
        }, base_url="https://localhost",
            headers={"X-Forwarded-Proto": "https", "Referer": "https://evil.example.com/"})
        self.assertEqual(res.status_code, 400)

    def test_セキュリティヘッダー(self):
        res = self.client.get("/login")
        self.assertEqual(res.headers["X-Frame-Options"], "DENY")
        self.assertEqual(res.headers["X-Content-Type-Options"], "nosniff")

    def test_大きすぎるリクエストは拒否(self):
        res = self.client.post("/login", data={"username": "x" * (2 * 1024 * 1024)})
        self.assertEqual(res.status_code, 413)


class CSRFTest(unittest.TestCase):
    def test_トークンの無いPOSTは拒否(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            app = create_app({
                "TESTING": True,
                "SECRET_KEY": "test",
                "SQLALCHEMY_DATABASE_URI": f"sqlite:///{os.path.join(tmpdir, 'test.db')}",
            })
            res = app.test_client().post("/login", data={
                "username": "alice", "password": "password123",
            })
            self.assertEqual(res.status_code, 400)
            with app.app_context():
                db.engine.dispose()


if __name__ == "__main__":
    unittest.main()
