import hashlib
import hmac
from datetime import timedelta

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from models import LoginFailure, Task, TaskList, Template, TemplateItem, db, now_tokyo

bp = Blueprint("main", __name__)

NAME_MAX = 100
TITLE_MAX = 200
# 1 回の送信で追加できる行数（大量に送られて DB がふくらまないように）
LINES_MAX = 100

# 同じ IP から 15 分間に 10 回まちがえたら、しばらくログインを受け付けない
LOGIN_FAILURE_LIMIT = 10
LOGIN_FAILURE_WINDOW = timedelta(minutes=15)


# --- ログイン（家族共通の合言葉） ---


def _password_fingerprint():
    """いまの合言葉から作る目印。セッションに入れておき、合言葉を変えたら全員ログアウトさせる。

    合言葉そのものはセッション（署名付きだが中身は読めるクッキー）に入れない。
    """
    key = current_app.config["SECRET_KEY"].encode()
    password = current_app.config["FAMILY_PASSWORD"].encode()
    return hmac.new(key, password, hashlib.sha256).hexdigest()[:32]


def _is_logged_in():
    fingerprint = session.get("pw")
    return bool(
        session.get("logged_in")
        and fingerprint
        and hmac.compare_digest(fingerprint, _password_fingerprint())
    )


def _client_ip():
    # Vercel 上では ProxyFix が X-Forwarded-For（Vercel が付け直す）から本当の IP を入れる
    return (request.remote_addr or "unknown")[:64]


def _too_many_failures(ip):
    since = now_tokyo() - LOGIN_FAILURE_WINDOW
    count = db.session.scalar(
        db.select(db.func.count(LoginFailure.id)).where(
            LoginFailure.ip == ip, LoginFailure.created_at >= since
        )
    )
    return count >= LOGIN_FAILURE_LIMIT


def _record_failure(ip):
    # 古い記録は消しておく（表が大きくならないように）
    db.session.execute(
        db.delete(LoginFailure).where(LoginFailure.created_at < now_tokyo() - timedelta(days=1))
    )
    db.session.add(LoginFailure(ip=ip))
    db.session.commit()


@bp.before_request
def require_login():
    if request.endpoint in ("main.login",):
        return None
    if not _is_logged_in():
        session.clear()
        return redirect(url_for("main.login"))
    return None


@bp.route("/login", methods=["GET", "POST"])
def login():
    if _is_logged_in():
        return redirect(url_for("main.index"))
    if request.method == "POST":
        ip = _client_ip()
        if _too_many_failures(ip):
            flash("入力ミスが続いたため、ログインを一時的に停止しています。15 分ほど待ってから再度お試しください", "error")
            return render_template("login.html"), 429
        password = request.form.get("password", "")
        expected = current_app.config["FAMILY_PASSWORD"]
        if hmac.compare_digest(password.encode(), expected.encode()):
            db.session.execute(db.delete(LoginFailure).where(LoginFailure.ip == ip))
            db.session.commit()
            # ログイン前のセッションは捨てて作り直す（セッション固定攻撃の対策）
            session.clear()
            session.permanent = True
            session["logged_in"] = True
            session["pw"] = _password_fingerprint()
            return redirect(url_for("main.index"))
        _record_failure(ip)
        flash("合言葉が違います", "error")
    return render_template("login.html")


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("main.login"))


# --- 補助 ---


def _get_or_404(model, id_):
    obj = db.session.get(model, id_)
    if obj is None:
        abort(404)
    return obj


def _clean(value, limit):
    return (value or "").strip()[:limit]


def _lines(value):
    """改行区切りで複数まとめて追加できるようにする（空行は無視）"""
    lines = [line.strip()[:TITLE_MAX] for line in (value or "").splitlines() if line.strip()]
    return lines[:LINES_MAX]


def _wants_json():
    return request.accept_mimetypes.best == "application/json"


# --- リスト ---


@bp.route("/")
def index():
    lists = db.session.scalars(db.select(TaskList).order_by(TaskList.created_at.desc(), TaskList.id.desc())).all()
    templates = db.session.scalars(db.select(Template).order_by(Template.name)).all()
    return render_template("index.html", lists=lists, templates=templates)


def _create_list_from(name, template):
    task_list = TaskList(name=name)
    if template:
        for i, item in enumerate(template.items, start=1):
            task_list.tasks.append(Task(title=item.title, position=i))
    db.session.add(task_list)
    db.session.commit()
    return task_list


@bp.route("/lists/new", methods=["POST"])
def create_list():
    template_id = request.form.get("template_id", type=int)
    template = _get_or_404(Template, template_id) if template_id else None
    name = _clean(request.form.get("name"), NAME_MAX) or (template.name if template else "")
    if not name:
        flash("リスト名を入力してください", "error")
        return redirect(url_for("main.index"))
    task_list = _create_list_from(name, template)
    return redirect(url_for("main.show_list", list_id=task_list.id))


@bp.route("/lists/<int:list_id>")
def show_list(list_id):
    task_list = _get_or_404(TaskList, list_id)
    return render_template("list.html", task_list=task_list)


@bp.route("/lists/<int:list_id>/rename", methods=["POST"])
def rename_list(list_id):
    task_list = _get_or_404(TaskList, list_id)
    name = _clean(request.form.get("name"), NAME_MAX)
    if name:
        task_list.name = name
        db.session.commit()
    return redirect(url_for("main.show_list", list_id=list_id))


@bp.route("/lists/<int:list_id>/delete", methods=["POST"])
def delete_list(list_id):
    task_list = _get_or_404(TaskList, list_id)
    db.session.delete(task_list)
    db.session.commit()
    flash(f"「{task_list.name}」を削除しました", "success")
    return redirect(url_for("main.index"))


@bp.route("/lists/<int:list_id>/tasks", methods=["POST"])
def add_tasks(list_id):
    task_list = _get_or_404(TaskList, list_id)
    position = task_list.next_position()
    for i, title in enumerate(_lines(request.form.get("title")), start=position):
        task_list.tasks.append(Task(title=title, position=i))
    db.session.commit()
    return redirect(url_for("main.show_list", list_id=list_id))


@bp.route("/lists/<int:list_id>/reset", methods=["POST"])
def reset_list(list_id):
    """全部のタスクを未完了に戻す（毎日繰り返す「朝の支度」などに使う）"""
    task_list = _get_or_404(TaskList, list_id)
    for task in task_list.tasks:
        task.done = False
    db.session.commit()
    return redirect(url_for("main.show_list", list_id=list_id))


@bp.route("/lists/<int:list_id>/clear-done", methods=["POST"])
def clear_done(list_id):
    task_list = _get_or_404(TaskList, list_id)
    for task in [t for t in task_list.tasks if t.done]:
        db.session.delete(task)
    db.session.commit()
    return redirect(url_for("main.show_list", list_id=list_id))


@bp.route("/lists/<int:list_id>/save-template", methods=["POST"])
def save_as_template(list_id):
    task_list = _get_or_404(TaskList, list_id)
    name = _clean(request.form.get("name"), NAME_MAX) or task_list.name
    template = Template(name=name)
    for i, task in enumerate(task_list.tasks, start=1):
        template.items.append(TemplateItem(title=task.title, position=i))
    db.session.add(template)
    db.session.commit()
    flash(f"テンプレート「{name}」を作成しました", "success")
    return redirect(url_for("main.show_template", template_id=template.id))


# --- タスク ---


@bp.route("/tasks/<int:task_id>/toggle", methods=["POST"])
def toggle_task(task_id):
    task = _get_or_404(Task, task_id)
    task.done = not task.done
    db.session.commit()
    if _wants_json():
        task_list = task.task_list
        return jsonify(
            done=task.done,
            done_count=task_list.done_count,
            total=len(task_list.tasks),
        )
    return redirect(url_for("main.show_list", list_id=task.list_id))


@bp.route("/tasks/<int:task_id>/delete", methods=["POST"])
def delete_task(task_id):
    task = _get_or_404(Task, task_id)
    list_id = task.list_id
    db.session.delete(task)
    db.session.commit()
    return redirect(url_for("main.show_list", list_id=list_id))


# --- テンプレート ---


@bp.route("/templates")
def templates():
    items = db.session.scalars(db.select(Template).order_by(Template.name)).all()
    return render_template("templates.html", templates=items)


@bp.route("/templates/new", methods=["POST"])
def create_template():
    name = _clean(request.form.get("name"), NAME_MAX)
    if not name:
        flash("テンプレート名を入力してください", "error")
        return redirect(url_for("main.templates"))
    template = Template(name=name)
    db.session.add(template)
    db.session.commit()
    return redirect(url_for("main.show_template", template_id=template.id))


@bp.route("/templates/<int:template_id>")
def show_template(template_id):
    template = _get_or_404(Template, template_id)
    return render_template("template.html", template=template)


@bp.route("/templates/<int:template_id>/rename", methods=["POST"])
def rename_template(template_id):
    template = _get_or_404(Template, template_id)
    name = _clean(request.form.get("name"), NAME_MAX)
    if name:
        template.name = name
        db.session.commit()
    return redirect(url_for("main.show_template", template_id=template_id))


@bp.route("/templates/<int:template_id>/delete", methods=["POST"])
def delete_template(template_id):
    template = _get_or_404(Template, template_id)
    db.session.delete(template)
    db.session.commit()
    flash(f"テンプレート「{template.name}」を削除しました", "success")
    return redirect(url_for("main.templates"))


@bp.route("/templates/<int:template_id>/items", methods=["POST"])
def add_template_items(template_id):
    template = _get_or_404(Template, template_id)
    position = template.next_position()
    for i, title in enumerate(_lines(request.form.get("title")), start=position):
        template.items.append(TemplateItem(title=title, position=i))
    db.session.commit()
    return redirect(url_for("main.show_template", template_id=template_id))


@bp.route("/template-items/<int:item_id>/delete", methods=["POST"])
def delete_template_item(item_id):
    item = _get_or_404(TemplateItem, item_id)
    template_id = item.template_id
    db.session.delete(item)
    db.session.commit()
    return redirect(url_for("main.show_template", template_id=template_id))


@bp.route("/templates/<int:template_id>/use", methods=["POST"])
def use_template(template_id):
    template = _get_or_404(Template, template_id)
    name = _clean(request.form.get("name"), NAME_MAX) or template.name
    task_list = _create_list_from(name, template)
    return redirect(url_for("main.show_list", list_id=task_list.id))
