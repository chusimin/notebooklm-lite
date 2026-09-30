"""模型输出解析工具。"""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.I | re.M)


def extract_json_object(text: str) -> dict[str, Any] | None:
    """从模型输出中提取 JSON 对象：兼容代码块包裹、前后多余文字；失败返回 None。"""
    if not text:
        return None
    cleaned = _FENCE_RE.sub("", text.strip())
    for candidate in (cleaned, cleaned[cleaned.find("{") : cleaned.rfind("}") + 1]):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(obj, dict):
            return obj
    return None


def message_text(msg: Any) -> str:
    content = getattr(msg, "content", msg)
    if isinstance(content, list):
        return "".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in content)
    return str(content or "")
