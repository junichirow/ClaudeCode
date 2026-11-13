from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user
from werkzeug.security import check_password_hash, generate_password_hash

from models import User, db

bp = Blueprint("auth", __name__)

MIN_PASSWORD_LENGTH = 8


def _safe_next(target):
    """ログイン後の戻り先。自サイト内のパスだけ許す（オープンリダイレクト対策）"""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return url_for("setlists.index")


@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("setlists.index"))

    username = ""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        password_confirm = request.form.get("password_confirm", "")

        error = None
        if not username:
            error = "ユーザー名を入力してください"
        elif len(username) > 50:
            error = "ユーザー名は 50 文字以内にしてください"
        elif len(password) < MIN_PASSWORD_LENGTH:
            error = f"パスワードは {MIN_PASSWORD_LENGTH} 文字以上にしてください"
        elif password != password_confirm:
            error = "確認用のパスワードが一致しません"
        elif db.session.scalar(db.select(User).filter_by(username=username)):
            error = "そのユーザー名はすでに使われています"

        if error:
            flash(error, "error")
        else:
            user = User(username=username, password_hash=generate_password_hash(password))
            db.session.add(user)
            db.session.commit()
            login_user(user, remember=True)
            flash("登録しました", "success")
            return redirect(url_for("setlists.index"))

    return render_template("auth/register.html", username=username)


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
