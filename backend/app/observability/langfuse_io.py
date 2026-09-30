"""可选的 Langfuse 追踪。

填了 LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY 后，每次 ingest / chat / studio
会通过 LangChain CallbackHandler 把 LangGraph 节点和 LLM 调用报到 Langfuse。
未配置时全部函数为空操作，不影响自建 SQLite 追踪。
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from app.config import settings

logger = logging.getLogger("notebooklm")


def is_enabled() -> bool:
    return bool(settings.langfuse_public_key.strip() and settings.langfuse_secret_key.strip())


def export_env() -> None:
    """Langfuse SDK 读进程环境变量；pydantic-settings 只读 .env，需要导出。"""
    if not is_enabled():
        return
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.langfuse_public_key)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.langfuse_secret_key)
    base = settings.langfuse_base_url.strip() or "https://cloud.langfuse.com"
    os.environ.setdefault("LANGFUSE_BASE_URL", base)
    os.environ.setdefault("LANGFUSE_HOST", base)  # 旧 SDK 名
    os.environ.setdefault("LANGFUSE_TRACING_ENVIRONMENT", settings.langfuse_environment)


def make_handler() -> BaseCallbackHandler | None:
    if not is_enabled():
        return None
    from langfuse.langchain import CallbackHandler

    return CallbackHandler()


@contextmanager
def trace_scope(*, kind: str, run_id: str, notebook_id: str | None) -> Iterator[None]:
    """给当前 trace 打上名称、session（笔记本 id）、标签，方便在 Langfuse 里筛选。"""
    if not is_enabled():
        yield
        return
    from langfuse import propagate_attributes

    meta: dict[str, Any] = {"local_run_id": run_id, "kind": kind}
    if notebook_id:
        meta["notebook_id"] = notebook_id
    with propagate_attributes(
        trace_name=kind,
        session_id=notebook_id or "local",
        tags=["notebooklm-lite", kind],
        metadata=meta,
        environment=settings.langfuse_environment or "development",
    ):
        yield


def flush() -> None:
    if not is_enabled():
        return
    try:
        from langfuse import get_client

        get_client().flush()
    except Exception:
        logger.exception("Langfuse flush 失败")


def startup_check() -> None:
    if not is_enabled():
        logger.info("Langfuse 未配置，仅使用本机观测后台")
        return
    export_env()
    logger.info("Langfuse 追踪已开启 → %s", settings.langfuse_base_url)
    try:
        from langfuse import get_client

        ok = get_client().auth_check()
        if ok:
            logger.info("Langfuse 认证成功")
        else:
            logger.warning("Langfuse 认证失败：请核对公钥/私钥，以及 LANGFUSE_BASE_URL 是否对应当前区域")
    except Exception as exc:
        logger.warning("Langfuse 连接失败：%s", exc)
