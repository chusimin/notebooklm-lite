"""对话：消息列表 / 清空 / 反馈，以及流式问答 SSE（DESIGN 5.3）。

SSE 事件顺序：user_message → step(start/end)… → token… → done；出错时发 error 后结束。
事件来源：
- step：由 @traced_node 通过 LangGraph custom 流发出；
- token：LangGraph messages 流中 metadata.langgraph_node == "generate" 的 LLM 增量；
- done：图最终状态中的 message（finalize 已写库）。
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app import repo
from app.api.deps import model_error_text, require_notebook
from app.api.schemas import ChatIn, FeedbackIn
from app.graphs.chat import chat_graph
from app.llm.output import message_text
from app.observability.tracer import start_run, trace_config

router = APIRouter(tags=["chat"])
logger = logging.getLogger(__name__)

HISTORY_LIMIT = 6
QUESTION_MAX = 4000
NO_SOURCE_REPLY = "当前没有可用的资料。请先在左侧添加资料（PDF、文本或网页链接），等待处理完成后，或勾选至少一份已就绪的资料再提问。"


def sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/notebooks/{notebook_id}/messages")
def list_messages(notebook_id: str):
    require_notebook(notebook_id)
    return repo.list_messages(notebook_id)


@router.delete("/notebooks/{notebook_id}/messages")
def clear_messages(notebook_id: str):
    require_notebook(notebook_id)
    repo.clear_messages(notebook_id)
    return {"ok": True}


@router.post("/messages/{message_id}/feedback")
def feedback(message_id: str, body: FeedbackIn):
    if body.value not in (-1, 0, 1):
        raise HTTPException(status_code=400, detail="反馈值只能是 -1、0 或 1")
    msg = repo.set_message_feedback(message_id, body.value)
    if msg is None:
        raise HTTPException(status_code=404, detail="消息不存在")
    return msg


@router.post("/notebooks/{notebook_id}/chat")
async def chat(notebook_id: str, body: ChatIn):
    require_notebook(notebook_id)
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="问题不能为空")
    if len(question) > QUESTION_MAX:
        raise HTTPException(status_code=400, detail=f"问题不能超过 {QUESTION_MAX} 字")

    # 先取历史再写入本次提问，历史中不包含当前问题
    history = [{"role": m["role"], "content": m["content"]} for m in repo.recent_history(notebook_id, HISTORY_LIMIT)]
    sources = repo.resolve_ready_sources(notebook_id, body.source_ids)
    user_msg = repo.create_message(notebook_id, "user", question)

    async def event_stream():
        yield sse("user_message", user_msg)
        if not sources:
            reply = repo.create_message(notebook_id, "assistant", NO_SOURCE_REPLY)
            yield sse("done", reply)
            return
        state = {
            "notebook_id": notebook_id,
            "question": question,
            "sources": [{"id": s["id"], "title": s["title"], "char_count": s["char_count"]} for s in sources],
            "history": history,
        }
        run_input = {"question": question, "source_ids": body.source_ids, "history_count": len(history)}
        try:
            final: dict = {}
            async with start_run("chat", notebook_id, run_input) as run:
                async for mode, chunk in chat_graph.astream(
                    state, trace_config(run), stream_mode=["messages", "custom", "values"]
                ):
                    if mode == "custom":
                        if isinstance(chunk, dict) and chunk.get("type") == "step":
                            yield sse("step", {"node": chunk["node"], "status": chunk["status"], "label": chunk["label"]})
                    elif mode == "messages":
                        msg, meta = chunk
                        if meta.get("langgraph_node") == "generate":
                            text = message_text(msg)
                            if text:
                                yield sse("token", {"text": text})
                    elif mode == "values":
                        final = chunk
            message = final.get("message")
            if not message:
                raise RuntimeError("未生成回答消息")
            yield sse("done", message)
        except Exception as exc:
            logger.exception("问答失败 notebook=%s", notebook_id)
            yield sse("error", {"message": f"回答生成失败：{model_error_text(exc)}"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )
