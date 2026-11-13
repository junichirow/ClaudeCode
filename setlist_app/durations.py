"""演奏時間（分:秒）と秒数の相互変換"""

import re

_PATTERN = re.compile(r"^(\d{1,3}):([0-5]\d)$")


def parse_duration(text):
    """「4:35」→ 275。空なら None。形式が違えば ValueError"""
    text = (text or "").strip().replace("：", ":")
    if not text:
        return None
    match = _PATTERN.match(text)
    if not match:
        raise ValueError("演奏時間は「4:35」のように 分:秒 で入力してください")
    minutes, seconds = int(match.group(1)), int(match.group(2))
    return minutes * 60 + seconds


def format_duration(seconds):
    """275 → 「4:35」、3930 → 「1:05:30」。None なら空文字"""
    if seconds is None:
        return ""
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"
