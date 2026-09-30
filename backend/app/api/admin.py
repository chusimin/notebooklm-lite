"""观测后台接口（DESIGN 5.4）：总览、调用列表、单次调用详情。"""

from fastapi import APIRouter, HTTPException, Query

from app.observability import stats

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
