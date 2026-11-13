from datetime import date

from flask import Blueprint, abort, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from models import Setlist, SetlistItem, Song, db

bp = Blueprint("setlists", __name__, url_prefix="/setlists")


@bp.before_request
@login_required
def require_login():
    pass


def get_own_setlist(setlist_id):
    """ログイン中のユーザーのセットリストだけ取得する。それ以外は 404"""
    return db.first_or_404(
        db.select(Setlist).filter_by(id=setlist_id, user_id=current_user.id)
    )


def get_item(setlist, item_id):
    for item in setlist.items:
        if item.id == item_id:
            return item
    abort(404)


def _read_form():
    values = {
        "title": request.form.get("title", "").strip(),
        "date": request.form.get("date", "").strip(),
        "venue": request.form.get("venue", "").strip(),
    }
    if not values["title"]:
        return values, "タイトルを入力してください"
    if values["date"]:
        try:
            values["date_value"] = date.fromisoformat(values["date"])
        except ValueError:
            return values, "日付の形式が正しくありません"
    else:
        values["date_value"] = None
    return values, None


def _apply(setlist, values):
    setlist.title = values["title"][:200]
    setlist.date = values["date_value"]
    setlist.venue = values["venue"][:200]


@bp.route("/")
def index():
    setlists = db.session.scalars(
        db.select(Setlist)
        .filter_by(user_id=current_user.id)
        .order_by(Setlist.date.desc().nulls_last(), Setlist.id.desc())
    ).all()
    return render_template("setlists/index.html", setlists=setlists)


@bp.route("/new", methods=["GET", "POST"])
def new():
    values = {}
    if request.method == "POST":
        values, error = _read_form()
        if error:
            flash(error, "error")
        else:
            setlist = Setlist(user_id=current_user.id)
            _apply(setlist, values)
            db.session.add(setlist)
            db.session.commit()
            flash("セットリストを作成しました。曲を追加しましょう", "success")
            return redirect(url_for("setlists.items", setlist_id=setlist.id))
    return render_template("setlists/form.html", values=values, setlist=None)


@bp.route("/<int:setlist_id>")
def show(setlist_id):
    """ライブ中に見る画面（大きな文字で曲順を表示）"""
    setlist = get_own_setlist(setlist_id)
    return render_template("setlists/show.html", setlist=setlist)


@bp.route("/<int:setlist_id>/edit", methods=["GET", "POST"])
def edit(setlist_id):
    setlist = get_own_setlist(setlist_id)
    if request.method == "POST":
        values, error = _read_form()
        if error:
            flash(error, "error")
        else:
            _apply(setlist, values)
            db.session.commit()
            flash("セットリストを更新しました", "success")
            return redirect(url_for("setlists.show", setlist_id=setlist.id))
    else:
        values = {
            "title": setlist.title,
            "date": setlist.date.isoformat() if setlist.date else "",
            "venue": setlist.venue,
        }
    return render_template("setlists/form.html", values=values, setlist=setlist)


@bp.route("/<int:setlist_id>/delete", methods=["POST"])
def delete(setlist_id):
    setlist = get_own_setlist(setlist_id)
    db.session.delete(setlist)
    db.session.commit()
    flash(f"「{setlist.title}」を削除しました", "success")
    return redirect(url_for("setlists.index"))


@bp.route("/<int:setlist_id>/items")
def items(setlist_id):
    """曲の追加・削除・並べ替えをする画面"""
    setlist = get_own_setlist(setlist_id)
    songs = db.session.scalars(
        db.select(Song).filter_by(user_id=current_user.id).order_by(Song.title)
    ).all()
    return render_template("setlists/items.html", setlist=setlist, songs=songs)


@bp.route("/<int:setlist_id>/items/add", methods=["POST"])
def add_item(setlist_id):
    setlist = get_own_setlist(setlist_id)
    song_id = request.form.get("song_id", type=int)
    song = db.session.scalar(
        db.select(Song).filter_by(id=song_id, user_id=current_user.id)
    )
    if song is None:
        flash("曲を選んでください", "error")
    else:
        position = max((item.position for item in setlist.items), default=-1) + 1
        setlist.items.append(SetlistItem(song=song, position=position))
        db.session.commit()
        flash(f"「{song.title}」を追加しました", "success")
    return redirect(url_for("setlists.items", setlist_id=setlist.id))


@bp.route("/<int:setlist_id>/items/<int:item_id>/delete", methods=["POST"])
def delete_item(setlist_id, item_id):
    setlist = get_own_setlist(setlist_id)
    item = get_item(setlist, item_id)
    setlist.items.remove(item)
    setlist.renumber()
    db.session.commit()
    return redirect(url_for("setlists.items", setlist_id=setlist.id))


@bp.route("/<int:setlist_id>/items/<int:item_id>/move", methods=["POST"])
def move_item(setlist_id, item_id):
    setlist = get_own_setlist(setlist_id)
    item = get_item(setlist, item_id)
    setlist.renumber()
    ordered = sorted(setlist.items, key=lambda i: i.position)
    index = ordered.index(item)
    target = index - 1 if request.form.get("direction") == "up" else index + 1
    if 0 <= target < len(ordered):
        other = ordered[target]
        item.position, other.position = other.position, item.position
        db.session.commit()
    return redirect(url_for("setlists.items", setlist_id=setlist.id, _anchor=f"item-{item.id}"))
