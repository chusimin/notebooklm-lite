"""ingest_graph：资料导入（后台任务）。

    load → split → embed → summarize → save

- 上传接口先写入 status=processing 的 Source 立即返回，再用 `schedule_ingest` 后台执行本图；
- 任一节点失败：run 记为 error，Source 写 status=failed 与中文 error，前端轮询即可看到。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, TypedDict

import numpy as np
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from app import repo
from app.llm import factory, prompts
from app.llm.output import extract_json_object, message_text
from app.observability.tracer import current_run, embedding_cost, span, start_run, trace_config, traced_node
from app.rag.loaders import LoadError, decode_text, fetch_url, load_pdf, load_text
from app.rag.splitter import split_pages

logger = logging.getLogger(__name__)

EMBED_BATCH = 64
SUMMARY_INPUT_CHARS = 6000
FALLBACK_QUESTIONS = ["这份资料的核心观点是什么？", "资料中提到了哪些关键概念？", "这份资料的主要结论是什么？"]


class IngestState(TypedDict, total=False):
    source_id: str
    notebook_id: str
    type: str  # pdf | text | markdown | url
    title: str
    uri: str | None
    file_bytes: bytes | None  # 文件上传的原始内容
    text: str | None  # 粘贴文本
    pages: list[dict]
    char_count: int
    chunks: list[dict]
    vectors: Any  # np.ndarray
    summary: str
    suggested_questions: list[str]


class IngestError(RuntimeError):
    """导入失败，message 为中文说明。"""


# ---------------------------------------------------------------------------
# 节点
# ---------------------------------------------------------------------------


@traced_node("load", label="读取资料")
async def load_node(state: IngestState) -> dict:
    stype = state["type"]
    title = state.get("title") or ""
    if stype == "pdf":
        pages = load_pdf(state.get("file_bytes") or b"")
    elif stype == "url":
        title, pages = await fetch_url(state["uri"] or "")
        repo.update_source(state["source_id"], title=title)  # 尽早展示网页标题
    elif state.get("file_bytes") is not None:
        pages = load_text(decode_text(state["file_bytes"]))
    else:
        pages = load_text(state.get("text") or "")
    char_count = sum(len(p["text"]) for p in pages)
    # 大字段（原始文件）读取后即清空，避免在后续状态中流转
    return {"pages": pages, "title": title, "char_count": char_count, "file_bytes": None, "text": None}


@traced_node("split", label="切分片段")
async def split_node(state: IngestState) -> dict:
    chunks = split_pages(state["pages"])
    if not chunks:
        raise IngestError("资料切分后没有有效内容")
    return {"chunks": chunks}


@traced_node("embed", label="向量化")
async def embed_node(state: IngestState) -> dict:
    embedder = factory.get_embedder()
    texts = [c["text"] for c in state["chunks"]]
    parts: list[np.ndarray] = []
    for start in range(0, len(texts), EMBED_BATCH):
        batch = texts[start : start + EMBED_BATCH]
        async with span(
            f"embed_batch_{start // EMBED_BATCH + 1}", "embedding", {"count": len(batch)}, model=embedder.model
        ) as sp:
            result = await embedder.embed(batch)
            if sp is not None:
                sp.prompt_tokens = result.tokens
                sp.cost_usd = embedding_cost(result.tokens)
                sp.output = {"count": len(batch), "tokens": result.tokens, "dim": int(result.vectors.shape[1])}
        parts.append(result.vectors)
    return {"vectors": np.vstack(parts)}


def _fallback_summary(text: str) -> str:
    return text[:150].replace("\n", " ") + ("…" if len(text) > 150 else "")


@traced_node("summarize", label="生成概要")
async def summarize_node(state: IngestState) -> dict:
    full_text = "\n\n".join(p["text"] for p in state["pages"])
    llm = factory.get_chat_model(fast=True)
    messages = [
        SystemMessage(prompts.SUMMARIZE_SYSTEM),
        HumanMessage(prompts.SUMMARIZE_USER.format(title=state.get("title", ""), text=full_text[:SUMMARY_INPUT_CHARS])),
    ]
    try:
        reply = message_text(await llm.ainvoke(messages))
    except Exception as exc:  # 概要不是核心能力，失败时兜底而非让整份资料导入失败
        logger.warning("生成概要失败，使用兜底：%s", exc)
        reply = ""
    data = extract_json_object(reply) or {}
    summary = str(data.get("summary") or "").strip() or _fallback_summary(full_text)
    questions = [str(q).strip() for q in (data.get("suggested_questions") or []) if str(q).strip()]
    questions = (questions + [q for q in FALLBACK_QUESTIONS if q not in questions])[:3]
    return {"summary": summary, "suggested_questions": questions}


@traced_node("save", label="保存资料")
async def save_node(state: IngestState) -> dict:
    source_id = state["source_id"]
    if repo.get_source(source_id) is None:
        # 处理期间资料被用户删除：静默结束
        return {}
    repo.insert_chunks(source_id, state["notebook_id"], state["chunks"], state["vectors"])
    repo.update_source(
        source_id,
        status="ready",
        error=None,
        title=state.get("title") or repo.get_source(source_id)["title"],
        char_count=state["char_count"],
        chunk_count=len(state["chunks"]),
        summary=state["summary"],
        suggested_questions=state["suggested_questions"],
    )
    run = current_run()
    if run is not None:
        run.output = {
            "title": state.get("title"),
            "summary": state["summary"],
            "char_count": state["char_count"],
            "chunk_count": len(state["chunks"]),
        }
    return {}


def build_ingest_graph():
    g = StateGraph(IngestState)
    g.add_node("load", load_node)
    g.add_node("split", split_node)
    g.add_node("embed", embed_node)
    g.add_node("summarize", summarize_node)
    g.add_node("save", save_node)
    g.add_edge(START, "load")
    g.add_edge("load", "split")
    g.add_edge("split", "embed")
    g.add_edge("embed", "summarize")
    g.add_edge("summarize", "save")
    g.add_edge("save", END)
    return g.compile()


ingest_graph = build_ingest_graph()


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------


def _user_error(exc: BaseException) -> str:
    if isinstance(exc, (LoadError, IngestError)):
        return str(exc)
    if isinstance(exc, factory.EmbeddingError):
        return f"向量化失败，请稍后重试（{str(exc)[:150]}）"
    return f"资料处理失败：{exc.__class__.__name__}: {str(exc)[:200]}"


async def run_ingest(source: dict, file_bytes: bytes | None = None, text: str | None = None) -> None:
    """执行导入流程。异常不向外抛，统一写入 Source 的 failed 状态。"""
    state: IngestState = {
        "source_id": source["id"],
        "notebook_id": source["notebook_id"],
        "type": source["type"],
        "title": source["title"],
        "uri": source["uri"],
        "file_bytes": file_bytes,
        "text": text,
    }
    try:
        async with start_run(
            "ingest", source["notebook_id"], {"title": source["title"], "type": source["type"], "uri": source["uri"]}
        ) as run:
            await ingest_graph.ainvoke(state, trace_config(run))
    except Exception as exc:
        logger.exception("资料导入失败 source=%s", source["id"])
        if repo.get_source(source["id"]) is not None:
            repo.update_source(source["id"], status="failed", error=_user_error(exc))


# 持有后台任务引用，防止 asyncio 任务被垃圾回收
_background_tasks: set[asyncio.Task] = set()


def schedule_ingest(source: dict, file_bytes: bytes | None = None, text: str | None = None) -> asyncio.Task:
    task = asyncio.create_task(run_ingest(source, file_bytes=file_bytes, text=text))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task
