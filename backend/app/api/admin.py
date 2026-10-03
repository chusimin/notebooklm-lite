"""观测后台接口（DESIGN 5.4）：总览、调用列表、单次调用详情；RAG 流转演示（docs/RAG_FLOW_DEMO.md）。"""

from fastapi import APIRouter, HTTPException, Query

from app import demo
from app.observability import flow, stats

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/overview")
def overview(days: int = Query(7, ge=1, le=365)):
    return stats.overview(days)


@router.get("/runs")
def list_runs(
    kind: str | None = None,
    status: str | None = None,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    # 前端可能传空字符串表示“全部”
    return stats.list_runs(kind or None, status or None, limit, offset)


@router.get("/runs/{run_id}")
def run_detail(run_id: str):
    detail = stats.get_run_detail(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="调用记录不存在")
    return detail


# ---------------------------------------------------------------------------
# RAG 流转演示
# ---------------------------------------------------------------------------


@router.get("/flows")
def list_flows(kind: str | None = None, limit: int = Query(50, ge=1, le=200)):
    if kind and kind not in ("ingest", "chat"):
        raise HTTPException(status_code=400, detail="kind 只能是 ingest 或 chat")
    return flow.list_flows(kind or None, limit)


@router.get("/flows/{run_id}")
def flow_detail(run_id: str):
    detail = stats.get_run_detail(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="调用记录不存在")
    snap = flow.get(run_id)
    if snap is None:
        raise HTTPException(status_code=404, detail="这次调用发生在演示功能上线前，没有回放数据。请重新导入或提问一次")
    nodes = [
        {"name": s["name"], "latency_ms": s["latency_ms"], "status": s["status"]}
        for s in detail["spans"]
        if s["type"] == "node"
    ]
    leaf = {
        s["name"]: {"latency_ms": s["latency_ms"], "tokens": s["prompt_tokens"] + s["completion_tokens"], "model": s["model"]}
        for s in detail["spans"]
        if s["type"] in ("llm", "embedding", "retriever")
    }
    run = {k: v for k, v in detail.items() if k not in ("spans", "input", "output")}
    return {"run": run, "kind": snap["kind"], "data": snap["data"], "nodes": nodes, "leaf_spans": leaf}


@router.get("/demo")
def demo_info():
    return demo.info()


@router.post("/demo/setup")
async def demo_setup():
    # async：导入任务需要运行中的事件循环
    return demo.setup()
