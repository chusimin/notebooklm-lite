"""请求体模型（响应体直接返回 repo 序列化后的 dict，字段口径以 DESIGN 5.1 为准）。

字段校验尽量宽松，具体的业务校验在路由中完成并返回中文错误信息。
"""

from __future__ import annotations

from pydantic import BaseModel


class NotebookIn(BaseModel):
    title: str = ""


class UrlSourceIn(BaseModel):
    url: str


class TextSourceIn(BaseModel):
    title: str = ""
    content: str


class ChatIn(BaseModel):
    question: str
    source_ids: list[str] | None = None
    # 演示用：资料少于全文模式门槛时也强制走检索
    force_rag: bool = False


class FeedbackIn(BaseModel):
    value: int


class NoteIn(BaseModel):
    kind: str = "manual"
    title: str = ""
    content: str


class StudioIn(BaseModel):
    kind: str
    source_ids: list[str] | None = None
