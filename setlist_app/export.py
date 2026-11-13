import csv
import io
from datetime import datetime
from zoneinfo import ZoneInfo

from flask import Blueprint, Response, render_template
from flask_login import current_user, login_required

from durations import format_duration
from models import Setlist, Song, db

bp = Blueprint("export", __name__, url_prefix="/export")


@bp.before_request
@login_required
def require_login():
    pass


def _csv_response(rows, basename):
    buffer = io.StringIO()
    csv.writer(buffer).writerows(rows)
    today = datetime.now(ZoneInfo("Asia/Tokyo")).strftime("%Y%m%d")
    # BOM 付き UTF-8 にすると、Excel で開いても文字化けしない
    return Response(
        buffer.getvalue().encode("utf-8-sig"),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={basename}_{today}.csv"
        },
    )


@bp.route("/")
def index():
    return render_template("export/index.html")


@bp.route("/songs.csv")
def songs_csv():
    songs = db.session.scalars(
        db.select(Song).filter_by(user_id=current_user.id).order_by(Song.title)
    ).all()
    rows = [["曲名", "キー", "チューニング", "演奏時間", "メモ"]]
    for song in songs:
        rows.append([
            song.title, song.key, song.tuning,
            format_duration(song.duration_seconds), song.memo,
        ])
    return _csv_response(rows, "songs")


@bp.route("/setlists.csv")
def setlists_csv():
    setlists = db.session.scalars(
        db.select(Setlist)
        .filter_by(user_id=current_user.id)
        .order_by(Setlist.date.desc().nulls_last(), Setlist.id.desc())
    ).all()
    rows = [["セットリスト", "日付", "会場", "曲順", "曲名", "キー", "チューニング", "演奏時間"]]
    for setlist in setlists:
        head = [
            setlist.title,
            setlist.date.isoformat() if setlist.date else "",
            setlist.venue,
        ]
        if not setlist.items:
            rows.append(head + ["", "", "", "", ""])
        for number, item in enumerate(setlist.items, start=1):
            song = item.song
            rows.append(head + [
                number, song.title, song.key, song.tuning,
                format_duration(song.duration_seconds),
            ])
    return _csv_response(rows, "setlists")
