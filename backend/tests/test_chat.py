"""问答 SSE：事件顺序、token 流、引用规范化、full/rag 模式、历史改写、反馈回写、无资料提示、异常事件。"""

from app.config import settings
from app.db import connect
from tests.conftest import SAMPLE_TEXT, parse_sse, wait_source_ready


def _setup(client):
    nb = client.post("/api/notebooks", json={"title": "问答测试"}).json()
    src = client.post(
        f"/api/notebooks/{nb['id']}/sources/text", json={"title": "动物资料", "content": SAMPLE_TEXT}
    ).json()
    src = wait_source_ready(client, nb["id"], src["id"])
    assert src["status"] == "ready"
    return nb, src


def _chat(client, nb_id, question, source_ids=None):
    with client.stream(
        "POST", f"/api/notebooks/{nb_id}/chat", json={"question": question, "source_ids": source_ids}
    ) as r:
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        raw = "".join(r.iter_text())
    return parse_sse(raw)


def test_chat_full_mode_event_order(client):
    nb, _ = _setup(client)
    events = _chat(client, nb["id"], "猫喜欢吃什么？")
    names = [e[0] for e in events]

    assert names[0] == "user_message" and names[-1] == "done"
    assert "token" in names and "error" not in names
    assert events[0][1]["role"] == "user" and events[0][1]["content"] == "猫喜欢吃什么？"

    steps = [(d["node"], d["status"]) for n, d in events if n == "step"]
    # full 模式跳过改写与检索
    assert steps == [
        ("choose_mode", "start"),
        ("choose_mode", "end"),
        ("generate", "start"),
        ("generate", "end"),
        ("finalize", "start"),
        ("finalize", "end"),
    ]
    assert all(d["label"] for n, d in events if n == "step")
    # token 只出现在 generate start 与 end 之间
    idx_gen_start = names.index("step", names.index("step") + 2)
    first_token = names.index("token")
    assert first_token > idx_gen_start

    tokens = "".join(d["text"] for n, d in events if n == "token")
    assert tokens == "根据资料，猫喜欢吃鱼 [1, 2]。狗喜欢骨头[1，1]。无效引用 [99]。"

    done = events[-1][1]
    assert done["role"] == "assistant" and done["mode"] == "full" and done["run_id"]
    # 样例资料只切出 1 个片段：[1, 2] 中的 2 越界被丢弃、[1，1] 去重、[99] 删除
    assert done["content"] == "根据资料，猫喜欢吃鱼 [1]。狗喜欢骨头[1]。无效引用。"
    assert [c["index"] for c in done["citations"]] == [1]
    assert set(done["citations"][0]) == {"index", "chunk_id", "source_id", "source_title", "page", "snippet"}

    msgs = client.get(f"/api/notebooks/{nb['id']}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["citations"] == done["citations"]


def test_chat_rag_mode_with_rewrite(client, monkeypatch):
    nb, _ = _setup(client)
    monkeypatch.setattr(settings, "full_context_max_chars", 10)
    _chat(client, nb["id"], "猫喜欢吃什么？")  # 第一轮：无历史
    events = _chat(client, nb["id"], "那狗呢？")  # 第二轮：有历史，触发改写
    nodes = [d["node"] for n, d in events if n == "step" and d["status"] == "start"]
    assert nodes == ["choose_mode", "rewrite_query", "retrieve", "generate", "finalize"]
    done = events[-1][1]
    assert done["mode"] == "rag"

    # 改写节点的 LLM token 不应推送给前端
    tokens = "".join(d["text"] for n, d in events if n == "token")
    assert "改写后" not in tokens

    detail = client.get(f"/api/admin/runs/{done['run_id']}").json()
    types = {s["type"] for s in detail["spans"]}
    assert types == {"node", "llm", "retriever", "embedding"}
    retr = next(s for s in detail["spans"] if s["type"] == "retriever")
    assert retr["input"]["query"].startswith("改写后")
    assert retr["output"]["fused"] and {"chunk_id", "source_title", "score", "text"} <= set(retr["output"]["fused"][0])
    by_id = {s["id"]: s for s in detail["spans"]}
    assert by_id[retr["parent_id"]]["name"] == "retrieve"
    llm_parents = {by_id[s["parent_id"]]["name"] for s in detail["spans"] if s["type"] == "llm"}
    assert llm_parents == {"rewrite_query", "generate"}


def test_chat_without_ready_sources(client):
    nb = client.post("/api/notebooks", json={"title": "空"}).json()
    events = _chat(client, nb["id"], "你好")
    assert [e[0] for e in events] == ["user_message", "done"]
    assert "没有可用的资料" in events[1][1]["content"]
    # 勾选了不存在的资料同样提示
    nb2, _ = _setup(client)
    events = _chat(client, nb2["id"], "你好", source_ids=["not-exist"])
    assert [e[0] for e in events] == ["user_message", "done"]


def test_chat_error_event(client, fake_models):
    nb, _ = _setup(client)

    def broken(messages):
        raise RuntimeError("模型挂了")

    fake_models["responder"] = broken
    events = _chat(client, nb["id"], "问题")
    assert events[0][0] == "user_message" and events[-1][0] == "error"
    assert "回答生成失败" in events[-1][1]["message"]
    runs = client.get("/api/admin/runs?kind=chat").json()["items"]
    assert runs[0]["status"] == "error"

    # 失败后重试同一问题：复用用户消息，不堆重复提问
    msgs = client.get(f"/api/notebooks/{nb['id']}/messages").json()
    assert [m["role"] for m in msgs] == ["user"]
    fake_models["responder"] = None
    events2 = _chat(client, nb["id"], "问题")
    assert events2[-1][0] == "done"
    msgs = client.get(f"/api/notebooks/{nb['id']}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["id"] == events[0][1]["id"]


def test_chat_does_not_reuse_user_after_assistant_exists(client):
    """停止后若图已 finalize，库里已有助手消息；再问同一句应新开一轮，而不是复用。"""
    nb, _ = _setup(client)
    first = _chat(client, nb["id"], "猫喜欢吃什么？")
    assert first[-1][0] == "done"
    second = _chat(client, nb["id"], "猫喜欢吃什么？")
    assert second[-1][0] == "done"
    msgs = client.get(f"/api/notebooks/{nb['id']}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "assistant", "user", "assistant"]
    assert msgs[0]["id"] != msgs[2]["id"]


def test_feedback_writes_run(client):
    nb, _ = _setup(client)
    done = _chat(client, nb["id"], "猫喜欢吃什么？")[-1][1]
    r = client.post(f"/api/messages/{done['id']}/feedback", json={"value": -1}).json()
    assert r["feedback"] == -1
    with connect() as conn:
        assert conn.execute("SELECT feedback FROM runs WHERE id = ?", (done["run_id"],)).fetchone()[0] == -1
    assert client.post(f"/api/messages/{done['id']}/feedback", json={"value": 5}).status_code == 400
    assert client.post("/api/messages/nope/feedback", json={"value": 1}).status_code == 404


def test_clear_messages_and_empty_question(client):
    nb, _ = _setup(client)
    _chat(client, nb["id"], "猫喜欢吃什么？")
    assert client.delete(f"/api/notebooks/{nb['id']}/messages").json() == {"ok": True}
    assert client.get(f"/api/notebooks/{nb['id']}/messages").json() == []
    r = client.post(f"/api/notebooks/{nb['id']}/chat", json={"question": "  ", "source_ids": None})
    assert r.status_code == 400 and r.json()["detail"] == "问题不能为空"
