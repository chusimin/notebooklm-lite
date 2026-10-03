"""chat_graph：带引用问答（核心流程）。

    choose_mode ─┬─(full)──────────────────────────→ generate → finalize
                 └─(rag)→ rewrite_query → retrieve ─↗

- full 模式：所选资料总字数 ≤ FULL_CONTEXT_MAX_CHARS，按原顺序放入全部片段，回答最完整；
- rag 模式：资料过大时，先结合历史改写追问，再混合检索 top8 片段；
- generate 的 LLM token 由路由层通过 `stream_mode="messages"` 按节点名过滤后推送给前端；
- finalize 规范化引用编号并写入 messages 表。
"""

from __future__ import annotations

from typing import TypedDict

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from app import repo
from app.config import settings
from app.llm import factory, prompts
from app.llm.output import message_text
from app.observability import flow
from app.observability.tracer import current_run, traced_node
from app.rag.citations import build_citations, cited_numbers, strip_citations
from app.rag.retriever import hybrid_search

# 中文进度标签（SSE step 事件的 label）
STEP_LABELS = {
    "choose_mode": "判断回答模式",
    "rewrite_query": "改写问题",
    "retrieve": "正在检索资料",
    "generate": "正在生成回答",
    "finalize": "整理引用",
}


class ChatState(TypedDict, total=False):
    notebook_id: str
    question: str
    sources: list[dict]  # 本次问答范围内的 ready 资料
    history: list[dict]  # 最近 6 条消息 [{role, content}]
    force_rag: bool  # 演示用：资料再少也走检索
    mode: str  # full | rag
    total_chars: int
    query: str  # 检索用问题（rag 模式可能被改写）
    contexts: list[dict]  # 编号上下文，contexts[i] 对应 [i+1]
    answer: str
    message: dict  # 最终助手消息


def format_context(contexts: list[dict]) -> str:
    blocks = []
    for i, c in enumerate(contexts, start=1):
        loc = f"《{c['source_title']}》" + (f" 第 {c['page']} 页" if c.get("page") else "")
        blocks.append(f"[{i}] 来源：{loc}\n{c['text']}")
    return "\n\n".join(blocks) if blocks else "（没有检索到相关资料）"


def _history_messages(history: list[dict]) -> list[BaseMessage]:
    msgs: list[BaseMessage] = []
    for h in history:
        if h["role"] == "user":
            msgs.append(HumanMessage(h["content"]))
        else:
            msgs.append(AIMessage(strip_citations(h["content"])))
    return msgs


def _public_chunk(c: dict) -> dict:
    """去掉向量等内部字段，只保留生成与引用需要的信息。"""
    return {k: c.get(k) for k in ("id", "source_id", "source_title", "idx", "page", "text", "score") if k in c}


# ---------------------------------------------------------------------------
# 节点
# ---------------------------------------------------------------------------


@traced_node("choose_mode", label=STEP_LABELS["choose_mode"])
async def choose_mode(state: ChatState) -> dict:
    total = sum(s["char_count"] for s in state["sources"])
    forced = bool(state.get("force_rag"))
    mode = "rag" if forced or total > settings.full_context_max_chars else "full"
    run = current_run()
    if run is not None:
        run.mode = mode
    flow.record(
        {
            "question": state["question"],
            "mode": mode,
            "forced": forced,
            "total_chars": total,
            "threshold": settings.full_context_max_chars,
            "sources": [{"id": s["id"], "title": s["title"], "char_count": s["char_count"]} for s in state["sources"]],
            "history_count": len(state.get("history") or []),
        }
    )
    result: dict = {"mode": mode, "total_chars": total, "query": state["question"]}
    if mode == "full":
        result["contexts"] = [_public_chunk(c) for c in repo.load_chunks([s["id"] for s in state["sources"]])]
    return result


def route_after_mode(state: ChatState) -> str:
    return "generate" if state["mode"] == "full" else "rewrite_query"


@traced_node("rewrite_query", label=STEP_LABELS["rewrite_query"])
async def rewrite_query(state: ChatState) -> dict:
    history = state.get("history") or []
    if not history:
        return {"query": state["question"]}
    history_text = "\n".join(
        f"{'用户' if h['role'] == 'user' else '助手'}：{strip_citations(h['content'])[:500]}" for h in history
    )
    llm = factory.get_chat_model(fast=True)
    reply = await llm.ainvoke(
        [
            SystemMessage(prompts.REWRITE_SYSTEM),
            HumanMessage(prompts.REWRITE_USER.format(history=history_text, question=state["question"])),
        ]
    )
    query = message_text(reply).strip().strip("\"“”") or state["question"]
    flow.record({"rewritten": query})
    return {"query": query}


@traced_node("retrieve", label=STEP_LABELS["retrieve"])
async def retrieve(state: ChatState) -> dict:
    chunks = repo.load_chunks([s["id"] for s in state["sources"]], with_embedding=True)
    hits = await hybrid_search(state.get("query") or state["question"], chunks)
    return {"contexts": [_public_chunk(h) for h in hits]}


@traced_node("generate", label=STEP_LABELS["generate"])
async def generate(state: ChatState) -> dict:
    contexts = state.get("contexts") or []
    messages: list[BaseMessage] = [SystemMessage(prompts.ANSWER_SYSTEM.format(context=format_context(contexts)))]
    messages += _history_messages(state.get("history") or [])
    messages.append(HumanMessage(state["question"]))
    llm = factory.get_chat_model()
    run = current_run()
    if run is not None:
        run.model = getattr(llm, "model_name", None) or getattr(llm, "model", None) or settings.llm_model
    # ainvoke 在存在流式回调（LangGraph messages 模式）时会自动走流式，token 可被逐个推送
    reply = await llm.ainvoke(messages)
    return {"answer": message_text(reply)}


@traced_node("finalize", label=STEP_LABELS["finalize"])
async def finalize(state: ChatState) -> dict:
    contexts = state.get("contexts") or []
    raw_answer = state.get("answer") or ""
    content, citations = build_citations(raw_answer, contexts)
    if not content.strip():
        content = "抱歉，这次没有生成有效回答，请重试。"
    raw_nums = cited_numbers(raw_answer)
    flow.record(
        {
            "contexts": [
                {"n": i, "id": c.get("id"), "source_title": c.get("source_title"), "idx": c.get("idx"), "text": (c.get("text") or "")[:400]}
                for i, c in enumerate(contexts, start=1)
            ],
            "answer": content,
            "raw_answer": raw_answer,  # 演示里把越界编号原地划掉
            "cited": [c["index"] for c in citations],
            "dropped": [n for n in raw_nums if not 1 <= n <= len(contexts)],
        }
    )
    run = current_run()
    message = repo.create_message(
        state["notebook_id"],
        "assistant",
        content,
        citations=citations,
        run_id=run.id if run else None,
        mode=state.get("mode"),
    )
    if run is not None:
        run.output = {
            "answer": content,
            "message_id": message["id"],
            "citations": [{"index": c["index"], "chunk_id": c["chunk_id"]} for c in citations],
            "context_count": len(contexts),
        }
    return {"message": message}


def build_chat_graph():
    g = StateGraph(ChatState)
    g.add_node("choose_mode", choose_mode)
    g.add_node("rewrite_query", rewrite_query)
    g.add_node("retrieve", retrieve)
    g.add_node("generate", generate)
    g.add_node("finalize", finalize)
    g.add_edge(START, "choose_mode")
    g.add_conditional_edges("choose_mode", route_after_mode, ["rewrite_query", "generate"])
    g.add_edge("rewrite_query", "retrieve")
    g.add_edge("retrieve", "generate")
    g.add_edge("generate", "finalize")
    g.add_edge("finalize", END)
    return g.compile()


chat_graph = build_chat_graph()
