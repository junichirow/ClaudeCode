from datetime import datetime
from zoneinfo import ZoneInfo

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

TOKYO = ZoneInfo("Asia/Tokyo")


def now_tokyo():
    return datetime.now(TOKYO).replace(tzinfo=None)


class LoginFailure(db.Model):
    """合言葉の入力ミスの記録。総当たりで合言葉を当てられないよう、回数を数えて止める"""

    __tablename__ = "login_failures"

    id = db.Column(db.Integer, primary_key=True)
    ip = db.Column(db.String(64), nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=now_tokyo, index=True)


class TaskList(db.Model):
    """タスクリスト（例：「たろうの朝のしたく」「買い物」）"""

    __tablename__ = "task_lists"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=now_tokyo)
    tasks = db.relationship(
        "Task",
        back_populates="task_list",
        order_by="Task.position",
        cascade="all, delete-orphan",
    )

    def next_position(self):
        return max((t.position for t in self.tasks), default=0) + 1

    @property
    def done_count(self):
        return sum(1 for t in self.tasks if t.done)


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)
    list_id = db.Column(db.Integer, db.ForeignKey("task_lists.id"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    done = db.Column(db.Boolean, nullable=False, default=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    task_list = db.relationship("TaskList", back_populates="tasks")


class Template(db.Model):
    """リストのひな形（例：「子供の朝のしたく」）。ここからリストを作るとタスクがコピーされる"""

    __tablename__ = "templates"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    items = db.relationship(
        "TemplateItem",
        back_populates="template",
        order_by="TemplateItem.position",
        cascade="all, delete-orphan",
    )

    def next_position(self):
        return max((i.position for i in self.items), default=0) + 1


class TemplateItem(db.Model):
    __tablename__ = "template_items"

    id = db.Column(db.Integer, primary_key=True)
    template_id = db.Column(db.Integer, db.ForeignKey("templates.id"), nullable=False, index=True)
    title = db.Column(db.String(200), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    template = db.relationship("Template", back_populates="items")
