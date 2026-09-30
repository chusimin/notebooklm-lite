"""观测后台的查询与统计（DESIGN 5.4）。

个人规模数据量小，统计在 Python 中完成（取窗口内的 runs/spans 再聚合），
比写复杂 SQL 更易读，也方便自行计算 p95。
daily 按服务器本地时区的自然日分桶，并补齐无数据的日期（0 值），前端可直接画连续折线。
"""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db import connect
from app.utils import dumps, loads, parse_iso, truncate

PREVIEW_LEN = 120
# 各 kind 的输入/输出中最能代表内容的字段，用于生成列表预览
_PREVIEW_KEYS = ("question", "answer", "summary", "title", "kind", "url", "text", "content")


def percentile(values: list[float], pct: float) -> float:
    """最近秩法（nearest-rank）百分位；空列表返回 0。"""
    if not values:
        return 0
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def _preview(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return truncate(value, PREVIEW_LEN)
    if isinstance(value, dict):
        for key in _PREVIEW_KEYS:
            if value.get(key):
                return truncate(str(value[key]), PREVIEW_LEN)
    return truncate(dumps(value), PREVIEW_LEN)


def _run(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "notebook_id": row["notebook_id"],
        "notebook_title": row["notebook_title"],
        "status": row["status"],
        "mode": row["mode"],
        "model": row["model"],
        "input_preview": _preview(loads(row["input_json"])),
        "output_preview": _preview(loads(row["output_json"])),
        "latency_ms": row["latency_ms"],
        "prompt_tokens": row["prompt_tokens"],
        "completion_tokens": row["completion_tokens"],
        "cost_usd": round(row["cost_usd"] or 0, 8),
        "feedback": row["feedback"],
        "error": row["error"],
        "started_at": row["started_at"],
    }


def _span(row) -> dict:
    return {
        "id": row["id"],
        "run_id": row["run_id"],
        "parent_id": row["parent_id"],
        "name": row["name"],
        "type": row["type"],
        "status": row["status"],
        "model": row["model"],
        "input": loads(row["input_json"]),
        "output": loads(row["output_json"]),
        "error": row["error"],
        "prompt_tokens": row["prompt_tokens"],
        "completion_tokens": row["completion_tokens"],
        "cost_usd": round(row["cost_usd"] or 0, 8),
        "latency_ms": row["latency_ms"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
    }


_RUN_SELECT = """
SELECT r.*, n.title AS notebook_title FROM runs r LEFT JOIN notebooks n ON n.id = r.notebook_id
"""


def list_runs(kind: str | None, status: str | None, limit: int, offset: int) -> dict:
    where, params = [], []
    if kind:
        where.append("r.kind = ?")
        params.append(kind)
    if status:
        where.append("r.status = ?")
        params.append(status)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    with connect() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM runs r{clause}", params).fetchone()[0]
        rows = conn.execute(
            _RUN_SELECT + clause + " ORDER BY r.started_at DESC LIMIT ? OFFSET ?", (*params, limit, offset)
        ).fetchall()
    return {"items": [_run(r) for r in rows], "total": total}


def get_run_detail(run_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(_RUN_SELECT + " WHERE r.id = ?", (run_id,)).fetchone()
        if not row:
            return None
        spans = conn.execute(
            "SELECT * FROM spans WHERE run_id = ? ORDER BY started_at, rowid", (run_id,)
        ).fetchall()
    detail = _run(row)
    detail["input"] = loads(row["input_json"])
    detail["output"] = loads(row["output_json"])
    detail["spans"] = [_span(s) for s in spans]
    return detail


def overview(days: int = 7) -> dict:
    days = max(1, min(days, 365))
    today = datetime.now().astimezone().date()
    start_date = today - timedelta(days=days - 1)
    # 本地自然日起点换算成 UTC 字符串，用于 SQL 粗过滤
    start_local = datetime.combine(start_date, datetime.min.time()).astimezone()
    start_iso = start_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    with connect() as conn:
        runs = conn.execute("SELECT * FROM runs WHERE started_at >= ?", (start_iso,)).fetchall()
        spans = conn.execute(
            "SELECT name, type, status, model, latency_ms, prompt_tokens, completion_tokens, cost_usd "
            "FROM spans WHERE started_at >= ?",
            (start_iso,),
        ).fetchall()

    total = len(runs)
    errors = sum(1 for r in runs if r["status"] == "error")
    chat_latencies = [r["latency_ms"] for r in runs if r["kind"] == "chat" and r["latency_ms"] is not None]
    totals = {
        "runs": total,
        "chat_runs": sum(1 for r in runs if r["kind"] == "chat"),
        "ingest_runs": sum(1 for r in runs if r["kind"] == "ingest"),
        "studio_runs": sum(1 for r in runs if r["kind"] == "studio"),
        "error_rate": round(errors / total, 4) if total else 0,
        "avg_latency_ms": round(sum(chat_latencies) / len(chat_latencies)) if chat_latencies else 0,
        "p95_latency_ms": percentile(chat_latencies, 95),
        "prompt_tokens": sum(r["prompt_tokens"] for r in runs),
        "completion_tokens": sum(r["completion_tokens"] for r in runs),
        "cost_usd": round(sum(r["cost_usd"] for r in runs), 8),
        "feedback_up": sum(1 for r in runs if r["feedback"] == 1),
        "feedback_down": sum(1 for r in runs if r["feedback"] == -1),
    }

    # ---- daily：连续日期，含 0 值 ----
    buckets: dict[str, dict[str, Any]] = {}
    for i in range(days):
        d = (start_date + timedelta(days=i)).isoformat()
        buckets[d] = {"date": d, "runs": 0, "errors": 0, "tokens": 0, "cost_usd": 0.0, "_lat": []}
    for r in runs:
        d = parse_iso(r["started_at"]).astimezone().date().isoformat()
        b = buckets.get(d)
        if b is None:
            continue
        b["runs"] += 1
        b["errors"] += 1 if r["status"] == "error" else 0
        b["tokens"] += r["prompt_tokens"] + r["completion_tokens"]
        b["cost_usd"] += r["cost_usd"]
        if r["latency_ms"] is not None:
            b["_lat"].append(r["latency_ms"])
    daily = []
    for b in buckets.values():
        lat = b.pop("_lat")
        b["avg_latency_ms"] = round(sum(lat) / len(lat)) if lat else 0
        b["cost_usd"] = round(b["cost_usd"], 8)
        daily.append(b)

    # ---- by_node：节点耗时分布 ----
    node_lat: dict[str, list[int]] = defaultdict(list)
    node_err: dict[str, int] = defaultdict(int)
    node_cnt: dict[str, int] = defaultdict(int)
    for s in spans:
        if s["type"] != "node":
            continue
        node_cnt[s["name"]] += 1
        if s["status"] == "error":
            node_err[s["name"]] += 1
        if s["latency_ms"] is not None:
            node_lat[s["name"]].append(s["latency_ms"])
    by_node = [
        {
            "name": name,
            "count": cnt,
            "avg_latency_ms": round(sum(node_lat[name]) / len(node_lat[name])) if node_lat[name] else 0,
            "p95_latency_ms": percentile(node_lat[name], 95),
            "error_count": node_err[name],
        }
        for name, cnt in node_cnt.items()
    ]
    by_node.sort(key=lambda x: x["avg_latency_ms"], reverse=True)

    # ---- by_mode：chat 的 full / rag 分布 ----
    by_mode = {"full": 0, "rag": 0}
    for r in runs:
        if r["kind"] == "chat" and r["mode"] in by_mode:
            by_mode[r["mode"]] += 1

    # ---- by_model：按模型统计 LLM 与向量化调用 ----
    model_stat: dict[str, dict[str, Any]] = {}
    for s in spans:
        if s["type"] not in ("llm", "embedding") or not s["model"]:
            continue
        m = model_stat.setdefault(s["model"], {"model": s["model"], "calls": 0, "tokens": 0, "cost_usd": 0.0})
        m["calls"] += 1
        m["tokens"] += s["prompt_tokens"] + s["completion_tokens"]
        m["cost_usd"] += s["cost_usd"]
    by_model = sorted(model_stat.values(), key=lambda x: x["calls"], reverse=True)
    for m in by_model:
        m["cost_usd"] = round(m["cost_usd"], 8)

    return {"totals": totals, "daily": daily, "by_node": by_node, "by_mode": by_mode, "by_model": by_model}
