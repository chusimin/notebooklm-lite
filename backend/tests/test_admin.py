"""观测后台接口结构（DESIGN 5.4）与统计口径。"""

from app.observability.stats import percentile
from tests.conftest import SAMPLE_TEXT, parse_sse, wait_source_ready

RUN_KEYS = {
    "id", "kind", "notebook_id", "notebook_title", "status", "mode", "model", "input_preview",
    "output_preview", "latency_ms", "prompt_tokens", "completion_tokens", "cost_usd", "feedback",
    "error", "started_at",
}
SPAN_KEYS = {
    "id", "run_id", "parent_id", "name", "type", "status", "model", "input", "output", "error",
    "prompt_tokens", "completion_tokens", "cost_usd", "latency_ms", "started_at", "ended_at",
}


def _seed(client):
    nb = client.post("/api/notebooks", json={"title": "后台测试"}).json()
    src = client.post(f"/api/notebooks/{nb['id']}/sources/text", json={"title": "资料", "content": SAMPLE_TEXT}).json()
    wait_source_ready(client, nb["id"], src["id"])
    with client.stream("POST", f"/api/notebooks/{nb['id']}/chat", json={"question": "猫喜欢吃什么？", "source_ids": None}) as r:
        done = parse_sse("".join(r.iter_text()))[-1][1]
    client.post(f"/api/messages/{done['id']}/feedback", json={"value": 1})
    client.post(f"/api/notebooks/{nb['id']}/studio", json={"kind": "study_guide"})
    return nb, done


def test_percentile():
    assert percentile([], 95) == 0
    assert percentile([5], 95) == 5
    assert percentile(list(range(1, 101)), 95) == 95


def test_overview_structure(client):
    _seed(client)
    ov = client.get("/api/admin/overview?days=7").json()
    assert set(ov) == {"totals", "daily", "by_node", "by_mode", "by_model"}
    t = ov["totals"]
    assert set(t) == {
        "runs", "chat_runs", "ingest_runs", "studio_runs", "error_rate", "avg_latency_ms",
        "p95_latency_ms", "prompt_tokens", "completion_tokens", "cost_usd", "feedback_up", "feedback_down",
    }
    assert (t["runs"], t["chat_runs"], t["ingest_runs"], t["studio_runs"]) == (3, 1, 1, 1)
    assert t["error_rate"] == 0 and t["feedback_up"] == 1 and t["feedback_down"] == 0
    assert t["prompt_tokens"] > 0 and t["cost_usd"] > 0

    # daily：连续 7 天，含 0 值，最后一天是今天且有数据
    assert len(ov["daily"]) == 7
    assert set(ov["daily"][0]) == {"date", "runs", "errors", "tokens", "cost_usd", "avg_latency_ms"}
    dates = [d["date"] for d in ov["daily"]]
    assert dates == sorted(dates) and ov["daily"][-1]["runs"] == 3
    assert sum(d["runs"] for d in ov["daily"][:-1]) == 0

    names = {n["name"] for n in ov["by_node"]}
    assert {"load", "split", "embed", "summarize", "choose_mode", "generate", "finalize", "collect", "write"} <= names
    assert set(ov["by_node"][0]) == {"name", "count", "avg_latency_ms", "p95_latency_ms", "error_count"}
    assert ov["by_mode"] == {"full": 1, "rag": 0}
    models = {m["model"] for m in ov["by_model"]}
    assert {"fake-chat", "fake-fast", "fake-embedding"} <= models
    assert set(ov["by_model"][0]) == {"model", "calls", "tokens", "cost_usd"}

    assert len(client.get("/api/admin/overview?days=30").json()["daily"]) == 30


def test_runs_list_and_detail(client):
    nb, done = _seed(client)
    res = client.get("/api/admin/runs").json()
    assert res["total"] == 3 and len(res["items"]) == 3
    started = [i["started_at"] for i in res["items"]]
    assert started == sorted(started, reverse=True)
    item = res["items"][0]
    assert set(item) == RUN_KEYS

    chat = client.get("/api/admin/runs?kind=chat&status=success").json()
    assert chat["total"] == 1
    run = chat["items"][0]
    assert run["id"] == done["run_id"] and run["notebook_title"] == "后台测试"
    assert run["input_preview"] == "猫喜欢吃什么？" and run["output_preview"].startswith("根据资料")
    assert run["feedback"] == 1 and run["mode"] == "full" and run["model"] == "fake-chat"

    page = client.get("/api/admin/runs?limit=1&offset=1").json()
    assert page["total"] == 3 and len(page["items"]) == 1

    detail = client.get(f"/api/admin/runs/{run['id']}").json()
    assert RUN_KEYS | {"input", "output", "spans"} == set(detail)
    assert detail["input"]["question"] == "猫喜欢吃什么？"
    spans = detail["spans"]
    assert all(set(s) == SPAN_KEYS for s in spans)
    assert [s["started_at"] for s in spans] == sorted(s["started_at"] for s in spans)
    llm = next(s for s in spans if s["type"] == "llm")
    assert llm["prompt_tokens"] > 0 and llm["model"] == "fake-chat"
    assert llm["input"]["messages"][0]["role"] == "system"
    assert "text" in llm["output"]

    assert client.get("/api/admin/runs/nope").status_code == 404
