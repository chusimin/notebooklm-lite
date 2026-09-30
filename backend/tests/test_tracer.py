"""追踪写入：run / node span / llm span / 手动 span、token 汇总与父子关系、异常状态。"""

from typing import TypedDict

import pytest
from langchain_core.messages import HumanMessage
from langgraph.graph import END, START, StateGraph

from app.db import connect
from app.llm import factory
from app.observability.tracer import span, start_run, summarize_value, trace_config, traced_node
from tests.conftest import USAGE


class S(TypedDict, total=False):
    q: str
    a: str


@traced_node("ask", label="提问")
async def ask(state: S) -> dict:
    async with span("search", "retriever", {"query": state["q"]}) as sp:
        sp.output = {"hits": 1}
    reply = await factory.get_chat_model().ainvoke([HumanMessage(state["q"])])
    return {"a": reply.content}


def _graph():
    g = StateGraph(S)
    g.add_node("ask", ask)
    g.add_edge(START, "ask")
    g.add_edge("ask", END)
    return g.compile()


def _rows(sql, *args):
    with connect() as conn:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]


async def test_run_and_spans_written(tmp_db, fake_models):
    graph = _graph()
    async with start_run("chat", None, {"question": "你好"}) as run:
        run.mode = "full"
        await graph.ainvoke({"q": "你好"}, trace_config(run))

    [r] = _rows("SELECT * FROM runs WHERE id = ?", run.id)
    assert r["status"] == "success" and r["mode"] == "full"
    assert r["latency_ms"] is not None and r["ended_at"]
    assert r["prompt_tokens"] == USAGE["input_tokens"]
    assert r["completion_tokens"] == USAGE["output_tokens"]
    assert r["cost_usd"] > 0
    assert r["model"] == "fake-chat"

    spans = {s["type"]: s for s in _rows("SELECT * FROM spans WHERE run_id = ?", run.id)}
    assert set(spans) == {"node", "llm", "retriever"}
    node, llm, ret = spans["node"], spans["llm"], spans["retriever"]
    assert node["name"] == "ask" and node["parent_id"] is None
    assert llm["parent_id"] == node["id"] and ret["parent_id"] == node["id"]
    assert llm["model"] == "fake-chat" and llm["prompt_tokens"] == 100 and llm["completion_tokens"] == 20
    assert '"messages"' in llm["input_json"]
    # node span 汇总子孙叶子的 token
    assert node["prompt_tokens"] == 100
    assert all(s["status"] == "success" for s in spans.values())


async def test_streaming_usage_captured(tmp_db, fake_models):
    """流式调用（astream）时 usage 在最后一个 chunk，回调仍能取到。"""
    graph = _graph()
    async with start_run("chat", None, {"question": "q"}) as run:
        async for _ in graph.astream({"q": "q"}, trace_config(run), stream_mode="messages"):
            pass
    [llm] = _rows("SELECT * FROM spans WHERE run_id = ? AND type = 'llm'", run.id)
    assert llm["prompt_tokens"] == 100 and llm["completion_tokens"] == 20
    assert '"usage_estimated"' not in (llm["output_json"] or "")


async def test_run_error_status(tmp_db, fake_models):
    @traced_node("boom")
    async def boom(state: S) -> dict:
        raise ValueError("出错了")

    g = StateGraph(S)
    g.add_node("boom", boom)
    g.add_edge(START, "boom")
    g.add_edge("boom", END)
    graph = g.compile()

    with pytest.raises(ValueError):
        async with start_run("studio", None, {}) as run:
            await graph.ainvoke({"q": "x"}, trace_config(run))
    [r] = _rows("SELECT * FROM runs WHERE id = ?", run.id)
    assert r["status"] == "error" and "出错了" in r["error"]
    [s] = _rows("SELECT * FROM spans WHERE run_id = ?", run.id)
    assert s["status"] == "error" and "出错了" in s["error"]


async def test_span_without_run_is_noop(tmp_db):
    async with span("x", "retriever") as sp:
        assert sp is None
    assert _rows("SELECT * FROM spans") == []


def test_summarize_value_truncates():
    out = summarize_value({"text": "长" * 1000, "items": list(range(50)), "raw": b"123"})
    assert len(out["text"]) <= 301
    assert out["items"][-1] == "… 共 50 项"
    assert out["raw"] == "<3 字节>"
