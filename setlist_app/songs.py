from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from durations import format_duration, parse_duration
from models import Song, db

bp = Blueprint("songs", __name__, url_prefix="/songs")


@bp.before_request
@login_required
def require_login():
    pass


def get_own_song(song_id):
    """ログイン中のユーザーの曲だけ取得する。他人の曲や存在しない曲は 404"""
    return db.first_or_404(
        db.select(Song).filter_by(id=song_id, user_id=current_user.id)
    )


def _read_form():
    """フォームの値を読み、(値の辞書, エラーメッセージ) を返す"""
    values = {
        "title": request.form.get("title", "").strip(),
        "key": request.form.get("key", "").strip(),
        "tuning": request.form.get("tuning", "").strip(),
        "duration": request.form.get("duration", "").strip(),
        "memo": request.form.get("memo", "").strip(),
    }
    if not values["title"]:
        return values, "曲名を入力してください"
    try:
        values["duration_seconds"] = parse_duration(values["duration"])
    except ValueError as e:
        return values, str(e)
    return values, None


def _apply(song, values):
    song.title = values["title"][:200]
    song.key = values["key"][:20]
    song.tuning = values["tuning"][:50]
    song.duration_seconds = values["duration_seconds"]
    song.memo = values["memo"]


@bp.route("/")
def index():
    songs = db.session.scalars(
        db.select(Song).filter_by(user_id=current_user.id).order_by(Song.title)
    ).all()
    return render_template("songs/index.html", songs=songs)


@bp.route("/new", methods=["GET", "POST"])
def new():
    values = {}
    if request.method == "POST":
        values, error = _read_form()
        if error:
            flash(error, "error")
        else:
            song = Song(user_id=current_user.id)
            _apply(song, values)
            db.session.add(song)
            db.session.commit()
            flash(f"「{song.title}」を登録しました", "success")
            return redirect(url_for("songs.index"))
    return render_template("songs/form.html", values=values, song=None)


@bp.route("/<int:song_id>/edit", methods=["GET", "POST"])
def edit(song_id):
    song = get_own_song(song_id)
    if request.method == "POST":
        values, error = _read_form()
        if error:
            flash(error, "error")
        else:
            _apply(song, values)
            db.session.commit()
            flash(f"「{song.title}」を更新しました", "success")
            return redirect(url_for("songs.index"))
    else:
        values = {
            "title": song.title,
            "key": song.key,
            "tuning": song.tuning,
            "duration": format_duration(song.duration_seconds),
            "memo": song.memo,
        }
    return render_template("songs/form.html", values=values, song=song)


@bp.route("/<int:song_id>/delete", methods=["POST"])
def delete(song_id):
    song = get_own_song(song_id)
    db.session.delete(song)
    db.session.commit()
    flash(f"「{song.title}」を削除しました", "success")
    return redirect(url_for("songs.index"))
