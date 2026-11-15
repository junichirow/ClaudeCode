from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash

from models import User, db

bp = Blueprint("auth", __name__)


def _safe_next(target):
    """ログイン後の戻り先。自サイト内のパスだけ許す（オープンリダイレクト対策）"""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return url_for("setlists.index")


@bp.route("/register", methods=["GET", "POST"])
def register():
    """新規ユーザー登録は受け付けていない。ログイン画面へ移動させる"""
    return redirect(url_for("auth.login"))


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("setlists.index"))

    username = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = db.session.scalar(db.select(User).filter_by(username=username))
        if user and check_password_hash(user.password_hash, password):
            login_user(user, remember=True)
            return redirect(_safe_next(request.args.get("next")))
        flash("ユーザー名かパスワードが違います", "error")

    return render_template("auth/login.html", username=username)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("ログアウトしました", "success")
    return redirect(url_for("auth.login"))
