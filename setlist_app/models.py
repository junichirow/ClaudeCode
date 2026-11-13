from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class User(UserMixin, db.Model):
    # "user" は PostgreSQL の予約語なので users にする
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)


class Song(db.Model):
    __tablename__ = "songs"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    key = db.Column(db.String(20), nullable=False, default="")
    tuning = db.Column(db.String(50), nullable=False, default="")
    # 演奏時間は秒で持つ。未入力なら None
    duration_seconds = db.Column(db.Integer)
    memo = db.Column(db.Text, nullable=False, default="")

    # 曲を消したら、セットリストに入っている分も消す
    setlist_items = db.relationship(
        "SetlistItem", back_populates="song", cascade="all, delete-orphan"
    )


class Setlist(db.Model):
    __tablename__ = "setlists"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    date = db.Column(db.Date)
    venue = db.Column(db.String(200), nullable=False, default="")

    items = db.relationship(
        "SetlistItem",
        back_populates="setlist",
        cascade="all, delete-orphan",
        order_by="SetlistItem.position",
    )

    @property
    def total_seconds(self):
        return sum(item.song.duration_seconds or 0 for item in self.items)

    @property
    def missing_duration_count(self):
        """演奏時間が未入力の曲の数（合計に含まれていない曲の数）"""
        return sum(1 for item in self.items if item.song.duration_seconds is None)

    def renumber(self):
        """曲順を 0, 1, 2, ... に振り直す"""
        for position, item in enumerate(sorted(self.items, key=lambda i: i.position)):
            item.position = position


class SetlistItem(db.Model):
    __tablename__ = "setlist_items"

    id = db.Column(db.Integer, primary_key=True)
    setlist_id = db.Column(
        db.Integer, db.ForeignKey("setlists.id"), nullable=False, index=True
    )
    song_id = db.Column(db.Integer, db.ForeignKey("songs.id"), nullable=False, index=True)
    position = db.Column(db.Integer, nullable=False)

    setlist = db.relationship("Setlist", back_populates="items")
    song = db.relationship("Song", back_populates="setlist_items")
