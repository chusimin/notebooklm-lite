"""RAG 流转演示：回放快照写入（导入 / 问答 full / 强制检索）、流转接口、演示案例一键导入、2D 投影。"""

import time

import numpy as np

from app import demo
from app.observability import flow
from app.rag.citations import cited_numbers
from tests.conftest import SAMPLE_TEXT, parse_sse, wait_source_ready


def _setup(client):
    nb = client.post("/api/notebooks", json={"title": "流转测试"}).json()
    src = client.post(
        f"/api/notebooks/{nb['id']}/sources/text", json={"title": "动物资料", "content": SAMPLE_TEXT}
    ).json()
    src = wait_source_ready(client, nb["id"], src["id"])
    assert src["status"] == "ready"
    return nb, src


def _chat(client, nb_id, question, force_rag=False):
    with client.stream(
        "POST", f"/api/notebooks/{nb_id}/chat", json={"question": question, "force_rag": force_rag}
    ) as r:
        raw = "".join(r.iter_text())
    return parse_sse(raw)[-1][1]


def test_cited_numbers_keeps_out_of_range_and_dedupes():
    assert cited_numbers("甲 [1, 2]。乙[1，1]。丙 [99]。") == [1, 2, 99]
    assert cited_numbers("没有引用") == []


def test_project_2d_shapes_and_range():
    rng = np.random.default_rng(0)
    m = rng.normal(size=(10, 8)).astype(np.float32)
    pts, q = flow.project_2d(m, rng.normal(size=8).astype(np.float32))
    assert len(pts) == 10 and len(q) == 2
    assert all(0.0 <= v <= 1.0 for p in [*pts, q] for v in p)
    assert flow.project_2d(np.zeros((0, 8)))[0] == []
    assert flow.project_2d(np.ones((1, 8)))[0] == [[0.5, 0.5]]


def test_ingest_records_snapshot(client):
    nb, src = _setup(client)
    flows = client.get("/api/admin/flows", params={"kind": "ingest"}).json()
    assert len(flows) == 1 and flows[0]["label"] == "动物资料" and flows[0]["notebook_title"] == "流转测试"

    d = client.get(f"/api/admin/flows/{flows[0]['run_id']}").json()
    assert d["kind"] == "ingest"
    data = d["data"]
    assert data["title"] == "动物资料" and data["chunk_count"] == len(data["chunks"]) >= 1
    assert data["chunk_size"] == 800 and data["dim"] == 64
    c = data["chunks"][0]
    assert c["text"] and len(c["xy"]) == 2 and isinstance(c["keywords"], list)
    assert [n["name"] for n in d["nodes"]] == ["load", "split", "embed", "summarize", "save"]


def test_chat_full_mode_snapshot(client):
    nb, _ = _setup(client)
    done = _chat(client, nb["id"], "猫喜欢吃什么？")
    d = client.get(f"/api/admin/flows/{done['run_id']}").json()
    data = d["data"]
    assert data["mode"] == "full" and data["forced"] is False
    assert data["question"] == "猫喜欢吃什么？"
    assert "chunks" not in data  # full 模式不检索
    assert len(data["contexts"]) == 1
    assert data["cited"] == [1] and data["dropped"] == [2, 99]
    assert data["answer"].startswith("根据资料")


def test_chat_force_rag_snapshot(client):
    nb, _ = _setup(client)
    done = _chat(client, nb["id"], "猫喜欢吃什么？", force_rag=True)
    assert done["mode"] == "rag"
    d = client.get(f"/api/admin/flows/{done['run_id']}").json()
    data = d["data"]
    assert data["mode"] == "rag" and data["forced"] is True
    assert data["total_chars"] < data["threshold"]
    assert len(data["query_xy"]) == 2 and data["query_tokens"]
    ids = {c["id"] for c in data["chunks"]}
    assert data["fused"] and all(f["id"] in ids for f in data["fused"])
    assert data["params"]["rrf_k"] == 60
    assert [n["name"] for n in d["nodes"]] == ["choose_mode", "rewrite_query", "retrieve", "generate", "finalize"]

    chats = client.get("/api/admin/flows", params={"kind": "chat"}).json()
    assert chats[0]["label"] == "猫喜欢吃什么？" and chats[0]["mode"] == "rag"


def test_flow_detail_errors(client):
    assert client.get("/api/admin/flows/not-exist").status_code == 404
    assert client.get("/api/admin/flows", params={"kind": "studio"}).status_code == 400


def test_demo_setup_is_idempotent(client):
    info = client.get("/api/admin/demo").json()
    assert info["notebook"] is None and len(info["questions"]) == 4

    r = client.post("/api/admin/demo/setup").json()
    nb_id = r["notebook"]["id"]
    expected = len(list(demo.DEMO_DIR.glob("*.md")))
    assert r["notebook"]["title"] == demo.DEMO_TITLE and len(r["sources"]) == expected

    deadline = time.time() + 20
    while time.time() < deadline:
        sources = client.get(f"/api/notebooks/{nb_id}/sources").json()
        if all(s["status"] != "processing" for s in sources):
            break
        time.sleep(0.05)
    assert all(s["status"] == "ready" for s in sources)

    again = client.post("/api/admin/demo/setup").json()
    assert again["notebook"]["id"] == nb_id and len(again["sources"]) == expected

    snap = client.get("/api/admin/flows", params={"kind": "ingest"}).json()
    d = client.get(f"/api/admin/flows/{snap[0]['run_id']}").json()
    assert d["data"]["chunk_size"] == demo.DEMO_CHUNKING[0]
