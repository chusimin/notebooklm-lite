"""LangChain 回调：把每次聊天模型调用记录为 llm span。

- on_chat_model_start：创建 llm span，parent 为当前 node span（从 contextvars 读取），
  记录模型与完整 messages。
- on_llm_end：记录输出文本与 usage（优先 message.usage_metadata，流式时由 stream_usage=True
  在最后一个 chunk 带回；其次 llm_output.token_usage；都没有则按字数估算并标记 usage_estimated）。
- on_llm_error：记录错误。

run_inline=True 让回调在调用方协程内顺序执行，保证能读到节点上下文中的 contextvars，
并保证 span 写入顺序与调用顺序一致。
"""

from __future__ import annotations

import time
from typing import Any
from uuid import UUID

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import BaseMessage
from langchain_core.outputs import LLMResult

from app.observability import tracer


def _role(msg: BaseMessage) -> str:
    return {"human": "user", "ai": "assistant", "system": "system"}.get(msg.type, msg.type)


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # 多模态内容块
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return str(content)


class TraceCallbackHandler(AsyncCallbackHandler):
    run_inline = True

    def __init__(self) -> None:
        super().__init__()
        # LangChain run_id -> 我们的 span 信息
        self._spans: dict[UUID, dict[str, Any]] = {}

    async def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[BaseMessage]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        metadata = metadata or {}
        run = tracer.current_run() or tracer.get_active_run(metadata.get("trace_run_id"))
        if run is None:
            return
        params = kwargs.get("invocation_params") or {}
        model = params.get("model") or params.get("model_name") or metadata.get("ls_model_name")
        flat = [{"role": _role(m), "content": _content_text(m.content)} for m in (messages[0] if messages else [])]
        span_input = {"messages": flat}
        if metadata.get("langgraph_node"):
            span_input["node"] = metadata["langgraph_node"]
        span_id = tracer.create_span_row(
            run.id, tracer.current_span_id(), f"llm:{model or 'chat'}", "llm", span_input, model
        )
        self._spans[run_id] = {
            "span_id": span_id,
            "started": time.perf_counter(),
            "model": model,
            "prompt_text": "".join(m["content"] for m in flat),
        }

    async def on_llm_end(self, response: LLMResult, *, run_id: UUID, **kwargs: Any) -> None:
        info = self._spans.pop(run_id, None)
        if info is None:
            return
        text, usage = "", None
        if response.generations and response.generations[0]:
            gen = response.generations[0][0]
            text = gen.text or ""
            message = getattr(gen, "message", None)
            if message is not None:
                text = text or _content_text(message.content)
                usage = getattr(message, "usage_metadata", None)
        prompt_tokens = completion_tokens = 0
        estimated = False
        if usage:
            prompt_tokens = int(usage.get("input_tokens") or 0)
            completion_tokens = int(usage.get("output_tokens") or 0)
        else:
            token_usage = (response.llm_output or {}).get("token_usage") or {}
            prompt_tokens = int(token_usage.get("prompt_tokens") or 0)
            completion_tokens = int(token_usage.get("completion_tokens") or 0)
        if prompt_tokens == 0 and completion_tokens == 0:
            estimated = True
            prompt_tokens = tracer.estimate_tokens(info["prompt_text"])
            completion_tokens = tracer.estimate_tokens(text)
        model = (response.llm_output or {}).get("model_name") or info["model"]
        output: dict[str, Any] = {"text": text}
        if estimated:
            output["usage_estimated"] = True
        tracer.finish_span_row(
            info["span_id"],
            status="success",
            latency_ms=int((time.perf_counter() - info["started"]) * 1000),
            output=output,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=tracer.llm_cost(prompt_tokens, completion_tokens),
        )

    async def on_llm_error(self, error: BaseException, *, run_id: UUID, **kwargs: Any) -> None:
        info = self._spans.pop(run_id, None)
        if info is None:
            return
        tracer.finish_span_row(
            info["span_id"],
            status="error",
            latency_ms=int((time.perf_counter() - info["started"]) * 1000),
            error=str(error) or error.__class__.__name__,
        )
