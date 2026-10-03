"""RAG 流转演示的回放快照（docs/RAG_FLOW_DEMO.md）。

和 span 分开存：快照里有片段全文、二维坐标、两路完整排名，体积大，
放进 span 会淹没调用详情页的 JSON；演示页只读这张表，回放结果与当时一致。

写入方式：图节点在执行中调用 `record(patch)`，按当前 run 合并进同一份快照。
没有当前 run（如单元测试直接调用检索）时静默跳过。
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

import numpy as np

from app.db import connect
from app.observability.tracer import current_run
from app.utils import dumps, loads, utc_now_iso

# 地图上最多画的候选片段数；命中片段总会保留
MAX_POINTS = 400

# 关键词标签用：jieba 分词后过滤掉的高频虚词
_STOPWORDS = set(
    "的 了 是 在 和 与 及 或 也 就 都 而 但 并 被 把 让 给 对 从 向 为 以 于 之 其 这 那 你 我 他 她 它 们 "
    "一个 一些 可以 如果 因为 所以 什么 怎么 吗 呢 吧 啊 还 能 会 要 有 没有 不 很 更 最 等 中 上 下 个 次 "
    "我们 你们 他们 这个 那个 进行 通过 需要 已经 就是 以及 或者 并且 还是".split()
)
_WORD_OK = re.compile(r"[\u4e00-\u9fffA-Za-z0-9]")


def record(patch: dict[str, Any], run_id: str | None = None, kind: str | None = None) -> None:
    """把 patch 浅合并进当前 run 的快照。"""
    run = current_run()
    rid = run_id or (run.id if run else None)
    if rid is None:
        return
    kind = kind or (run.kind if run else "chat")
    with connect() as conn:
        row = conn.execute("SELECT data_json FROM flow_snapshots WHERE run_id = ?", (rid,)).fetchone()
        data = loads(row["data_json"], {}) if row else {}
        data.update(patch)
        conn.execute(
            """INSERT INTO flow_snapshots(run_id, kind, data_json, created_at) VALUES (?,?,?,?)
               ON CONFLICT(run_id) DO UPDATE SET data_json = excluded.data_json""",
            (rid, kind, dumps(data), utc_now_iso()),
        )


def get(run_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT kind, data_json FROM flow_snapshots WHERE run_id = ?", (run_id,)).fetchone()
    if not row:
        return None
    return {"kind": row["kind"], "data": loads(row["data_json"], {})}


def project_2d(matrix: np.ndarray, extra: np.ndarray | None = None) -> tuple[list[list[float]], list[float] | None]:
    """PCA 投影到二维并归一化到 [0.05, 0.95]。

    extra（问题向量）用同一组主成分投影，保证和片段画在同一张地图上。
    片段少于 2 个时无法求主成分，退化为居中排布。
    """
    n = matrix.shape[0]
    if n == 0:
        return [], ([0.5, 0.5] if extra is not None else None)
    if n == 1:
        return [[0.5, 0.5]], ([0.3, 0.3] if extra is not None else None)
    mean = matrix.mean(axis=0)
    centered = matrix - mean
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    comps = vt[:2]
    pts = centered @ comps.T
    q = (extra - mean) @ comps.T if extra is not None else None
    allp = np.vstack([pts, q[None, :]]) if q is not None else pts
    lo, hi = allp.min(axis=0), allp.max(axis=0)
    span = np.where(hi - lo < 1e-9, 1.0, hi - lo)

    def norm(p: np.ndarray) -> list[float]:
        v = 0.05 + 0.9 * (p - lo) / span
        return [round(float(v[0]), 4), round(float(v[1]), 4)]

    return [norm(p) for p in pts], (norm(q) if q is not None else None)


def keywords(text: str, k: int = 5) -> list[str]:
    """按词频取片段的前 k 个关键词（两字以上或中英文数字混排），作为演示里的"词签"。"""
    from app.rag.retriever import tokenize

    words = [w for w in tokenize(text) if w not in _STOPWORDS and _WORD_OK.search(w) and (len(w) >= 2 or w.isdigit())]
    return [w for w, _ in Counter(words).most_common(k)]


def list_flows(kind: str | None, limit: int = 50) -> list[dict]:
    """有快照的调用，最新在前。"""
    where = "WHERE f.kind = ?" if kind else ""
    params: tuple = (kind, limit) if kind else (limit,)
    with connect() as conn:
        rows = conn.execute(
            f"""SELECT r.id, r.kind, r.status, r.mode, r.notebook_id, r.started_at, r.latency_ms,
                       r.input_json, n.title AS notebook_title
                FROM flow_snapshots f JOIN runs r ON r.id = f.run_id
                LEFT JOIN notebooks n ON n.id = r.notebook_id
                {where} ORDER BY r.started_at DESC LIMIT ?""",
            params,
        ).fetchall()
    items = []
    for r in rows:
        inp = loads(r["input_json"], {}) or {}
        items.append(
            {
                "run_id": r["id"],
                "kind": r["kind"],
                "status": r["status"],
                "mode": r["mode"],
                "notebook_id": r["notebook_id"],
                "notebook_title": r["notebook_title"],
                "started_at": r["started_at"],
                "latency_ms": r["latency_ms"],
                "label": inp.get("question") or inp.get("title") or "",
            }
        )
    return items
