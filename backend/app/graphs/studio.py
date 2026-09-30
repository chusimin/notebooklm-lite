"""studio_graph：工作室内容生成（简报 / 学习指南 / FAQ）。

    collect ─┬─(资料小)──────────────────────────────→ write → save
             └─(资料大)→ Send × N：map_summarize（按资料并行）─↗

资料总量 ≤ FULL_CONTEXT_MAX_CHARS 时直接全文生成；否则每份资料并行提炼要点（map），
再汇总写作（reduce），避免超出模型上下文。输出 Markdown 存为 Note。
"""

from __future__ import annotations

import operator
from datetime import datetime
from typing import Annotated, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app import repo
from app.config import settings
from app.llm import factory, prompts
from app.llm.output import message_text
from app.observability.tracer import current_run, traced_node

# 单份资料 map 时的最大输入字数（防止单份超大资料超出上下文）
MAP_MAX_CHARS = 50000


class StudioState(TypedDict, total=False):
    notebook_id: str
    kind: str  # briefing | study_guide | faq
    sources: list[dict]
    docs: list[dict]  # [{source_id, title, text}]
    total_chars: int
    partials: Annotated[list[dict], operator.add]  # map 结果（并行节点追加合并）
    content: str
    note: dict


class MapState(TypedDict):
    title: str
    text: str


@traced_node("collect", label="收集资料")
async def collect(state: StudioState) -> dict:
    chunks = repo.load_chunks([s["id"] for s in state["sources"]])
    by_source: dict[str, dict] = {}
    for c in chunks:
        doc = by_source.setdefault(c["source_id"], {"source_id": c["source_id"], "title": c["source_title"], "parts": []})
        doc["parts"].append(c["text"])
    docs = [{"source_id": d["source_id"], "title": d["title"], "text": "\n".join(d["parts"])} for d in by_source.values()]
    total = sum(len(d["text"]) for d in docs)
    run = current_run()
    if run is not None:
        run.mode = "full" if total <= settings.full_context_max_chars else "rag"
    return {"docs": docs, "total_chars": total}


def route_after_collect(state: StudioState):
    """资料小直接写作；资料大则按资料并行 map。"""
    if state["total_chars"] <= settings.full_context_max_chars:
        return "write"
    return [Send("map_summarize", {"title": d["title"], "text": d["text"][:MAP_MAX_CHARS]}) for d in state["docs"]]


@traced_node("map_summarize", label="提炼资料要点")
async def map_summarize(state: MapState) -> dict:
    llm = factory.get_chat_model(fast=True)
    reply = await llm.ainvoke(
        [
            SystemMessage(prompts.STUDIO_MAP_SYSTEM),
            HumanMessage(prompts.STUDIO_MAP_USER.format(title=state["title"], text=state["text"])),
        ]
    )
    return {"partials": [{"title": state["title"], "points": message_text(reply)}]}


@traced_node("write", label="撰写内容")
async def write(state: StudioState) -> dict:
    partials = state.get("partials") or []
    if partials:
        material = "\n\n".join(f"## 《{p['title']}》要点\n{p['points']}" for p in partials)
        desc = f"共 {len(partials)} 份资料的要点提炼"
    else:
        material = "\n\n".join(f"## 《{d['title']}》\n{d['text']}" for d in state["docs"])
        desc = f"共 {len(state['docs'])} 份资料全文"
    llm = factory.get_chat_model()
    reply = await llm.ainvoke(
        [
            SystemMessage(prompts.STUDIO_WRITE_SYSTEM[state["kind"]]),
            HumanMessage(prompts.STUDIO_WRITE_USER.format(material_desc=desc, material=material)),
        ]
    )
    return {"content": message_text(reply).strip()}


@traced_node("save", label="保存笔记")
async def save(state: StudioState) -> dict:
    label = prompts.STUDIO_KIND_LABELS[state["kind"]]
    date = datetime.now().astimezone().strftime("%Y-%m-%d")
    docs = state.get("docs") or []
    # 单份资料时标题带上资料名，更具体；多份资料用日期区分
    title = f"{label} · 《{docs[0]['title'][:30]}》" if len(docs) == 1 else f"{label} · {date}"
    content = state.get("content") or "（未生成内容，请重试）"
    note = repo.create_note(state["notebook_id"], state["kind"], title, content)
    run = current_run()
    if run is not None:
        run.output = {"title": title, "note_id": note["id"], "content": content[:500]}
    return {"note": note}


def build_studio_graph():
    g = StateGraph(StudioState)
    g.add_node("collect", collect)
    g.add_node("map_summarize", map_summarize)
    g.add_node("write", write)
    g.add_node("save", save)
    g.add_edge(START, "collect")
    g.add_conditional_edges("collect", route_after_collect, ["map_summarize", "write"])
    g.add_edge("map_summarize", "write")
    g.add_edge("write", "save")
    g.add_edge("save", END)
    return g.compile()


studio_graph = build_studio_graph()
