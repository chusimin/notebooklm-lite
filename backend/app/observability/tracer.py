"""自建追踪（runs / spans 写入 SQLite）。

层级模型：
    run（一次 chat / ingest / studio 调用）
      └─ node span（LangGraph 节点，由 @traced_node 记录）
            ├─ llm span（LangChain 回调 TraceCallbackHandler 记录）
            ├─ retriever span（检索时手动记录）
            └─ embedding span（向量化时手动记录）

上下文传递：
- `_current_run` / `_current_span` 两个 contextvars 保存当前 run 与父 span。
- LangGraph 在独立 asyncio task 中执行节点，task 会复制创建时的上下文，通常能读到 run；
  为保险起见，run_id 同时放入 graph config 的 `configurable.trace_run_id`，
  装饰器在上下文丢失时据此从 `_active_runs` 注册表恢复 run。
- 节点内设置的 `_current_span` 只影响该节点所在 task，因此并行节点（Send）互不干扰。

汇总口径：run 的 token / 成本只累加 llm 与 embedding 类型的 span（叶子），避免与
node span 上的子项汇总重复计算；node span 记录其子孙叶子 span 的合计，便于瀑布图查看。
"""

from __future__ import annotations

import inspect
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from langchain_core.runnables import RunnableConfig

from app.config import settings
from app.db import connect
from app.utils import dumps, new_id, truncate, utc_now_iso


# ---------------------------------------------------------------------------
# 成本计算
# ---------------------------------------------------------------------------


def llm_cost(prompt_tokens: int, completion_tokens: int) -> float:
    return (
        prompt_tokens * settings.price_input_per_m + completion_tokens * settings.price_output_per_m
    ) / 1_000_000


def embedding_cost(tokens: int) -> float:
    return tokens * settings.price_embedding_per_m / 1_000_000


def estimate_tokens(text: str) -> int:
    """无 usage 返回时的粗略估算：中文约 1 字 ≈ 1 token，英文约 4 字符 ≈ 1 token。"""
    if not text:
        return 0
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    return cjk + max(0, len(text) - cjk) // 4 + 1


# ---------------------------------------------------------------------------
# 数据摘要：span 的 input/output 只存精简摘要，避免把整篇资料写进追踪表
# ---------------------------------------------------------------------------


def summarize_value(value: Any, max_str: int = 300, max_items: int = 10, depth: int = 0) -> Any:
    if depth > 4:
        return "…"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return truncate(value, max_str)
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} 字节>"
    if isinstance(value, dict):
        return {str(k): summarize_value(v, max_str, max_items, depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        items = [summarize_value(v, max_str, max_items, depth + 1) for v in list(value)[:max_items]]
        if len(value) > max_items:
            items.append(f"… 共 {len(value)} 项")
        return items
    # numpy 数组等其它对象
    shape = getattr(value, "shape", None)
    if shape is not None:
        return f"<array shape={tuple(shape)}>"
    return truncate(str(value), max_str)


# ---------------------------------------------------------------------------
# Run / Span 句柄
# ---------------------------------------------------------------------------


@dataclass
class RunHandle:
    """当前运行中的 run。节点可通过 current_run() 修改 mode / model / output，结束时统一落库。"""

    id: str
    kind: str
    notebook_id: str | None
    mode: str | None = None
    model: str | None = None
    output: Any = None
    started: float = field(default_factory=time.perf_counter)


@dataclass
class SpanHandle:
    id: str
    run_id: str
    name: str
    type: str
    model: str | None = None
    output: Any = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0
    started: float = field(default_factory=time.perf_counter)


_current_run: ContextVar[RunHandle | None] = ContextVar("trace_current_run", default=None)
_current_span: ContextVar[str | None] = ContextVar("trace_current_span", default=None)
# run_id -> RunHandle，供上下文丢失时恢复
_active_runs: dict[str, RunHandle] = {}


def current_run() -> RunHandle | None:
    return _current_run.get()


def current_span_id() -> str | None:
    return _current_span.get()


def get_active_run(run_id: str | None) -> RunHandle | None:
    return _active_runs.get(run_id) if run_id else None


def trace_config(run: RunHandle, **extra: Any) -> RunnableConfig:
    """构造传给 graph 的 config：注入追踪回调，并把 run_id 放进 configurable/metadata 兜底。"""
    from app.observability.callback import TraceCallbackHandler
    from app.observability import langfuse_io

    callbacks: list[Any] = [TraceCallbackHandler()]
    lf = langfuse_io.make_handler()
    if lf is not None:
        callbacks.append(lf)
    configurable = {"trace_run_id": run.id, **extra}
    metadata: dict[str, Any] = {"trace_run_id": run.id, "kind": run.kind}
    if run.notebook_id:
        metadata["langfuse_session_id"] = run.notebook_id
        metadata["notebook_id"] = run.notebook_id
    return {
        "configurable": configurable,
        "metadata": metadata,
        "callbacks": callbacks,
        "run_name": f"{run.kind}_graph",
    }


# ---------------------------------------------------------------------------
# 底层写库
# ---------------------------------------------------------------------------


def create_span_row(
    run_id: str, parent_id: str | None, name: str, type_: str, input_: Any, model: str | None = None
) -> str:
    sid = new_id()
    with connect() as conn:
        conn.execute(
            """INSERT INTO spans(id, run_id, parent_id, name, type, status, model, input_json, started_at)
               VALUES (?,?,?,?,?, 'running', ?,?,?)""",
            (sid, run_id, parent_id, name, type_, model, dumps(input_), utc_now_iso()),
        )
    return sid


def finish_span_row(
    span_id: str,
    *,
    status: str,
    latency_ms: int,
    output: Any = None,
    error: str | None = None,
    model: str | None = None,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    cost_usd: float = 0.0,
) -> None:
    with connect() as conn:
        conn.execute(
            """UPDATE spans SET status = ?, output_json = ?, error = ?, model = COALESCE(?, model),
                   prompt_tokens = ?, completion_tokens = ?, cost_usd = ?, latency_ms = ?, ended_at = ?
               WHERE id = ?""",
            (
                status,
                dumps(output),
                error,
                model,
                prompt_tokens,
                completion_tokens,
                cost_usd,
                latency_ms,
                utc_now_iso(),
                span_id,
            ),
        )


def _descendant_totals(conn, run_id: str, span_id: str) -> tuple[int, int, float]:
    """汇总某个 span 所有子孙叶子（llm/embedding）的 token 与成本。"""
    row = conn.execute(
        """WITH RECURSIVE tree(id) AS (
               SELECT id FROM spans WHERE parent_id = ? AND run_id = ?
               UNION ALL
               SELECT s.id FROM spans s JOIN tree t ON s.parent_id = t.id
           )
           SELECT COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0), COALESCE(SUM(cost_usd),0)
           FROM spans WHERE id IN (SELECT id FROM tree) AND type IN ('llm','embedding')""",
        (span_id, run_id),
    ).fetchone()
    return int(row[0]), int(row[1]), float(row[2])


# ---------------------------------------------------------------------------
# Run 上下文
# ---------------------------------------------------------------------------


@asynccontextmanager
async def start_run(kind: str, notebook_id: str | None, input_: Any) -> AsyncIterator[RunHandle]:
    """创建 run 并设为当前上下文；结束时汇总 span 的 token/成本并写入耗时、状态、输出。"""
    run = RunHandle(id=new_id(), kind=kind, notebook_id=notebook_id)
    with connect() as conn:
        conn.execute(
            """INSERT INTO runs(id, kind, notebook_id, status, input_json, started_at)
               VALUES (?,?,?, 'running', ?, ?)""",
            (run.id, kind, notebook_id, dumps(input_), utc_now_iso()),
        )
    _active_runs[run.id] = run
    run_token = _current_run.set(run)
    span_token = _current_span.set(None)
    status, error = "success", None
    from app.observability import langfuse_io

    try:
        with langfuse_io.trace_scope(kind=kind, run_id=run.id, notebook_id=notebook_id):
            yield run
    except BaseException as exc:  # 包含 CancelledError（客户端断开）
        status = "error"
        error = _error_text(exc)
        raise
    finally:
        langfuse_io.flush()
        _current_span.reset(span_token)
        _current_run.reset(run_token)
        _active_runs.pop(run.id, None)
        _finish_run(run, status, error)


def _error_text(exc: BaseException) -> str:
    import asyncio

    if isinstance(exc, asyncio.CancelledError):
        return "调用被取消（可能是客户端断开连接）"
    return truncate(str(exc) or exc.__class__.__name__, 1000)


def _finish_run(run: RunHandle, status: str, error: str | None) -> None:
    latency = int((time.perf_counter() - run.started) * 1000)
    with connect() as conn:
        # 仍处于 running 的 span（如异常中断）统一标记为 error，避免后台显示悬挂
        conn.execute(
            "UPDATE spans SET status = 'error', error = COALESCE(error, '运行中断'), ended_at = ? "
            "WHERE run_id = ? AND status = 'running'",
            (utc_now_iso(), run.id),
        )
        totals = conn.execute(
            """SELECT COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0), COALESCE(SUM(cost_usd),0)
               FROM spans WHERE run_id = ? AND type IN ('llm','embedding')""",
            (run.id,),
        ).fetchone()
        model = run.model
        if model is None:
            # 未显式指定时取最后一次 LLM 调用的模型
            row = conn.execute(
                "SELECT model FROM spans WHERE run_id = ? AND type = 'llm' AND model IS NOT NULL "
                "ORDER BY started_at DESC LIMIT 1",
                (run.id,),
            ).fetchone()
            model = row[0] if row else None
        conn.execute(
            """UPDATE runs SET status = ?, mode = ?, model = ?, output_json = ?, error = ?,
                   prompt_tokens = ?, completion_tokens = ?, cost_usd = ?, latency_ms = ?, ended_at = ?
               WHERE id = ?""",
            (
                status,
                run.mode,
                model,
                dumps(run.output),
                error,
                int(totals[0]),
                int(totals[1]),
                float(totals[2]),
                latency,
                utc_now_iso(),
                run.id,
            ),
        )


# ---------------------------------------------------------------------------
# Span 上下文（retriever / embedding 手动记录，也被 traced_node 复用）
# ---------------------------------------------------------------------------


@asynccontextmanager
async def span(
    name: str,
    type_: str,
    input_: Any = None,
    model: str | None = None,
    run_id: str | None = None,
) -> AsyncIterator[SpanHandle | None]:
    """记录一个 span。当前没有 run（例如单元测试直接调用检索）时不记录，yield None。

    用法：
        async with span("vector_search", "retriever", {"query": q}) as sp:
            ...
            if sp: sp.output = {...}
    """
    run = current_run()
    rid = run_id or (run.id if run else None)
    if rid is None:
        yield None
        return
    parent = _current_span.get()
    sid = create_span_row(rid, parent, name, type_, input_, model)
    handle = SpanHandle(id=sid, run_id=rid, name=name, type=type_, model=model)
    token = _current_span.set(sid)
    status, error = "success", None
    try:
        yield handle
    except BaseException as exc:
        status, error = "error", _error_text(exc)
        raise
    finally:
        _current_span.reset(token)
        if type_ == "node":
            # node span 记录子孙叶子的合计，瀑布图上可直接看到每个节点消耗
            with connect() as conn:
                p, c, cost = _descendant_totals(conn, rid, sid)
            handle.prompt_tokens, handle.completion_tokens, handle.cost_usd = p, c, cost
        finish_span_row(
            sid,
            status=status,
            latency_ms=int((time.perf_counter() - handle.started) * 1000),
            output=handle.output,
            error=error,
            model=handle.model,
            prompt_tokens=handle.prompt_tokens,
            completion_tokens=handle.completion_tokens,
            cost_usd=handle.cost_usd,
        )


# ---------------------------------------------------------------------------
# 节点装饰器
# ---------------------------------------------------------------------------

NodeFn = Callable[..., Awaitable[dict]]


def _emit_step(node: str, status: str, label: str) -> None:
    """通过 LangGraph custom 流发送 step 事件；不在流式上下文中（如 ainvoke）时静默忽略。"""
    try:
        from langgraph.config import get_stream_writer

        writer = get_stream_writer()
    except Exception:
        return
    try:
        writer({"type": "step", "node": node, "status": status, "label": label})
    except Exception:
        pass


def traced_node(name: str, label: str | None = None) -> Callable[[NodeFn], NodeFn]:
    """装饰 LangGraph 异步节点：记录 node span（输入/输出摘要），并可选发送中文 step 事件。

    被装饰函数签名可以是 `fn(state)` 或 `fn(state, config)`。包装函数固定为
    `(state, config)`，LangGraph 按参数名 config 自动注入 RunnableConfig。
    """

    def decorator(fn: NodeFn) -> NodeFn:
        wants_config = len(inspect.signature(fn).parameters) >= 2

        async def wrapper(state: Any, config: RunnableConfig) -> dict:
            # 上下文丢失时，从 configurable 中恢复 run
            restored = None
            if current_run() is None:
                rid = (config or {}).get("configurable", {}).get("trace_run_id")
                run = get_active_run(rid)
                if run is not None:
                    restored = _current_run.set(run)
            try:
                if label:
                    _emit_step(name, "start", label)
                async with span(name, "node", summarize_value(state)) as sp:
                    result = await (fn(state, config) if wants_config else fn(state))
                    if sp is not None:
                        sp.output = summarize_value(result)
                if label:
                    _emit_step(name, "end", label)
                return result
            finally:
                if restored is not None:
                    _current_run.reset(restored)

        wrapper.__name__ = getattr(fn, "__name__", name)
        wrapper.__qualname__ = getattr(fn, "__qualname__", name)
        wrapper.__doc__ = fn.__doc__
        return wrapper

    return decorator
