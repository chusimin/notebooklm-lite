"""通用小工具：id 生成、UTC 时间字符串、文本截断、JSON 序列化。"""

import json
import uuid
from datetime import datetime, timezone
from typing import Any


def new_id() -> str:
    """uuid4 hex 字符串（DESIGN 第 4 节约定）。"""
    return uuid.uuid4().hex


def utc_now_iso() -> str:
    """UTC ISO 8601，带毫秒与 Z 后缀，如 2026-09-30T08:00:00.123Z。
    固定格式保证字符串可直接按字典序比较/排序。"""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def parse_iso(value: str) -> datetime:
    """解析 utc_now_iso 生成的时间字符串为带时区的 datetime。"""
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def truncate(text: str | None, limit: int) -> str:
    if not text:
        return ""
    return text if len(text) <= limit else text[:limit] + "…"


def dumps(obj: Any) -> str:
    """统一的 JSON 序列化：保留中文，无法序列化的对象转字符串，避免追踪写库失败。"""
    return json.dumps(obj, ensure_ascii=False, default=str)


def loads(text: str | None, default: Any = None) -> Any:
    if text is None or text == "":
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default
