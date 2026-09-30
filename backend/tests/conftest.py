"""测试公共夹具：临时数据库 + 假聊天模型 + 假向量化，不依赖网络。

通过 monkeypatch 替换 `app.llm.factory.get_chat_model / get_embedder`，
业务代码均以 `factory.get_xxx()` 调用，因此替换对所有图节点生效。
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

from app.config import settings
from app.db import init_db
from app.llm import factory, prompts

USAGE = {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120}


def default_responder(messages: list[BaseMessage]) -> str:
    """按系统提示词判断任务类型，返回固定的假输出。"""
    system = str(messages[0].content) if messages else ""
    if system == prompts.SUMMARIZE_SYSTEM:
        return '```json\n{"summary": "这是一份关于测试的资料概要。", "suggested_questions": ["问题一？", "问题二？", "问题三？"]}\n```'
    if system == prompts.REWRITE_SYSTEM:
        return "改写后的独立问题：猫喜欢吃什么"
    if system.startswith(prompts.ANSWER_SYSTEM.split("{context}")[0][:30]):
        return "根据资料，猫喜欢吃鱼 [1, 2]。狗喜欢骨头[1，1]。无效引用 [99]。"
    if system == prompts.STUDIO_MAP_SYSTEM:
        return "- 要点 A\n- 要点 B"
    return "# 测试生成标题\n\n## 概述\n这是生成的内容。"


class FakeChatModel(BaseChatModel):
    """可流式输出、带 usage_metadata 的假聊天模型。"""

    model_name: str = "fake-chat"
    responder: Any = None

    @property
    def _llm_type(self) -> str:
        return "fake-chat"

    def _reply(self, messages: list[BaseMessage]) -> str:
        return (self.responder or default_responder)(messages)

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        msg = AIMessage(content=self._reply(messages), usage_metadata=USAGE)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    async def _astream(self, messages, stop=None, run_manager=None, **kwargs) -> AsyncIterator[ChatGenerationChunk]:
        text = self._reply(messages)
        for i in range(0, len(text), 4):
            piece = text[i : i + 4]
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=piece))
            if run_manager:
                await run_manager.on_llm_new_token(piece, chunk=chunk)
            yield chunk
        # 与 OpenAI stream_usage 一致：最后一个空 chunk 携带 usage
        yield ChatGenerationChunk(message=AIMessageChunk(content="", usage_metadata=USAGE))


class FakeEmbedder:
    """字符哈希词袋向量：相同字符越多越相似，足以让检索测试有确定结果。"""

    model = "fake-embedding"
    dim = 64

    async def embed(self, texts: list[str]) -> factory.EmbedResult:
        vecs = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            for ch in t:
                vecs[i, ord(ch) % self.dim] += 1.0
        return factory.EmbedResult(factory.normalize(vecs), sum(len(t) for t in texts), self.model)


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "db_path", tmp_path / "test.db")
    init_db()
    return settings.db_path


@pytest.fixture
def fake_models(monkeypatch):
    """返回一个可修改 responder 的容器，测试可自定义模型输出。"""
    state: dict[str, Callable | None] = {"responder": None}

    def get_chat_model(fast: bool = False):
        return FakeChatModel(model_name="fake-fast" if fast else "fake-chat", responder=state["responder"])

    monkeypatch.setattr(factory, "get_chat_model", get_chat_model)
    monkeypatch.setattr(factory, "get_embedder", lambda: FakeEmbedder())
    return state


@pytest.fixture
def client(tmp_db, fake_models):
    from app.main import app

    with TestClient(app) as c:
        yield c


def wait_source_ready(client: TestClient, notebook_id: str, source_id: str, timeout: float = 10) -> dict:
    """轮询资料状态直到非 processing（后台任务在 TestClient 的事件循环线程中执行）。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        items = client.get(f"/api/notebooks/{notebook_id}/sources").json()
        src = next(s for s in items if s["id"] == source_id)
        if src["status"] != "processing":
            return src
        time.sleep(0.05)
    raise AssertionError("资料处理超时")


def parse_sse(raw: str) -> list[tuple[str, Any]]:
    import json

    events = []
    for block in raw.strip().split("\n\n"):
        if not block.strip():
            continue
        name, data = None, None
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[len("event: ") :]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: ") :])
        events.append((name, data))
    return events


SAMPLE_TEXT = (
    "猫是一种常见的家养宠物。猫喜欢吃鱼，也喜欢晒太阳。\n\n"
    "狗是人类的好朋友。狗喜欢啃骨头，需要每天遛弯。\n\n"
    "兔子喜欢吃胡萝卜和青草，性格温顺。"
)
