"""笔记与工作室：手动/回答笔记的增删查，以及同步生成简报 / 学习指南 / FAQ。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app import repo
from app.api.deps import model_error_text, require_notebook
from app.api.schemas import NoteIn, StudioIn
from app.graphs.studio import studio_graph
from app.llm.prompts import STUDIO_KIND_LABELS
from app.observability.tracer import start_run, trace_config

router = APIRouter(tags=["notes"])
logger = logging.getLogger(__name__)

NOTE_KINDS = {"manual", "answer", "briefing", "study_guide", "faq"}


@router.get("/notebooks/{notebook_id}/notes")
def list_notes(notebook_id: str):
    require_notebook(notebook_id)
    return repo.list_notes(notebook_id)


@router.post("/notebooks/{notebook_id}/notes")
def create_note(notebook_id: str, body: NoteIn):
    require_notebook(notebook_id)
    if body.kind not in NOTE_KINDS:
        raise HTTPException(status_code=400, detail="笔记类型不合法")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="笔记内容不能为空")
    title = body.title.strip()[:100] or body.content.strip().splitlines()[0][:30]
    return repo.create_note(notebook_id, body.kind, title, body.content)


@router.delete("/notes/{note_id}")
def delete_note(note_id: str):
    if not repo.delete_note(note_id):
        raise HTTPException(status_code=404, detail="笔记不存在")
    return {"ok": True}


@router.post("/notebooks/{notebook_id}/studio")
async def studio(notebook_id: str, body: StudioIn):
    require_notebook(notebook_id)
    if body.kind not in STUDIO_KIND_LABELS:
        raise HTTPException(status_code=400, detail="生成类型只能是 briefing、study_guide 或 faq")
    sources = repo.resolve_ready_sources(notebook_id, body.source_ids)
    if not sources:
        raise HTTPException(status_code=400, detail="没有可用的资料，请先添加资料并等待处理完成")
    state = {
        "notebook_id": notebook_id,
        "kind": body.kind,
        "sources": [{"id": s["id"], "title": s["title"], "char_count": s["char_count"]} for s in sources],
    }
    try:
        async with start_run(
            "studio", notebook_id, {"kind": body.kind, "title": STUDIO_KIND_LABELS[body.kind], "source_ids": body.source_ids}
        ) as run:
            final = await studio_graph.ainvoke(state, trace_config(run))
    except Exception as exc:
        logger.exception("工作室生成失败 notebook=%s", notebook_id)
        raise HTTPException(status_code=502, detail=f"生成失败：{model_error_text(exc)}") from exc
    return final["note"]
