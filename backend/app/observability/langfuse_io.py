"""可选的 Langfuse 追踪（对接本机自托管 Langfuse v2）。

填了 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY 后，每次 ingest / chat / studio
会通过 LangChain CallbackHandler 把 LangGraph 节点和 LLM 调用报到 Langfuse。
未配置时全部函数为空操作，不影响自建 SQLite 追踪。
"""

from __future__ import annotations

import logging
import os
import sys
import types
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from app.config import settings

logger = logging.getLogger("notebooklm")

_handler: Any = None


def is_enabled() -> bool:
    return bool(settings.langfuse_public_key.strip() and settings.langfuse_secret_key.strip())


def export_env() -> None:
    if not is_enabled():
        return
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
    base = settings.langfuse_base_url.strip() or "http://localhost:3100"
    os.environ.setdefault("LANGFUSE_HOST", base)
    os.environ.setdefault("LANGFUSE_BASE_URL", base)


def _install_langchain_shims() -> None:
    """Langfuse 2.x 仍 `from langchain.callbacks.base import ...`，LangChain 1.x 已挪到 langchain_core。"""
    if "langchain.callbacks.base" in sys.modules:
        return
    from langchain_core.agents import AgentAction, AgentFinish
    from langchain_core.callbacks.base import AsyncCallbackHandler, BaseCallbackHandler
    from langchain_core.documents import Document

    def put(name: str, **attrs: Any) -> None:
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod

    put("langchain.callbacks")
    put("langchain.callbacks.base", BaseCallbackHandler=BaseCallbackHandler, AsyncCallbackHandler=AsyncCallbackHandler)
    put("langchain.schema")
    put("langchain.schema.agent", AgentAction=AgentAction, AgentFinish=AgentFinish)
    put("langchain.schema.document", Document=Document)


def make_handler() -> BaseCallbackHandler | None:
    global _handler
    if not is_enabled():
        return None
    if _handler is not None:
        return _handler
    export_env()
    _install_langchain_shims()
    from langfuse.callback import CallbackHandler

    _handler = CallbackHandler(
        public_key=settings.langfuse_public_key,
        secret_key=settings.langfuse_secret_key,
        host=settings.langfuse_base_url,
        session_id=None,
    )
    return _handler


@contextmanager
def trace_scope(*, kind: str, run_id: str, notebook_id: str | None) -> Iterator[None]:
    """v2 用 metadata/tags 打在 graph config 上；这里只把 session 写到 handler。"""
    handler = make_handler()
    if handler is not None:
        try:
            handler.session_id = notebook_id or "local"
        except Exception:
            pass
    yield


def flush() -> None:
    if not is_enabled():
        return
    try:
        handler = make_handler()
        if handler is not None and getattr(handler, "langfuse", None) is not None:
            handler.langfuse.flush()
    except Exception:
        logger.exception("Langfuse flush 失败")


def startup_check() -> None:
    if not is_enabled():
        logger.info("Langfuse 未配置，仅使用本机观测后台")
        return
    export_env()
    logger.info("Langfuse 追踪已开启 → %s", settings.langfuse_base_url)
    try:
        _install_langchain_shims()
        from langfuse import Langfuse

        client = Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_base_url,
        )
        ok = client.auth_check()
        if ok:
            logger.info("Langfuse 认证成功")
        else:
            logger.warning("Langfuse 认证失败：请核对公钥/私钥，以及 LANGFUSE_BASE_URL")
        client.flush()
    except Exception as exc:
        logger.warning("Langfuse 连接失败：%s", exc)
