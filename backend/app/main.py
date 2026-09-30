"""FastAPI 应用入口。

启动：cd backend && uv run uvicorn app.main:app --port 8765
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import repo
from app.api import admin, chat, notebooks, notes, sources
from app.config import export_langsmith_env, settings
from app.observability import langfuse_io
from app.db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("notebooklm")


@asynccontextmanager
async def lifespan(_: FastAPI):
    export_langsmith_env()
    langfuse_io.export_env()
    langfuse_io.startup_check()
    init_db()
    stale = repo.fail_stale_processing_sources()
    if stale:
        logger.info("已将 %d 个中断的导入任务标记为失败", stale)
    yield


app = FastAPI(title="NotebookLM Lite", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    """统一错误格式 {"detail": "中文错误信息"}（FastAPI 默认 detail 是列表）。"""
    parts = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []) if x not in ("body", "query", "path"))
        parts.append(f"{loc or '请求体'}（{err.get('type', 'invalid')}）")
    return JSONResponse(status_code=422, content={"detail": "请求参数不合法：" + "；".join(parts)})


@app.exception_handler(Exception)
async def unhandled_handler(_: Request, exc: Exception):
    logger.exception("未处理的异常")
    return JSONResponse(status_code=500, content={"detail": f"服务器内部错误：{exc.__class__.__name__}"})


api = APIRouter(prefix="/api")


@api.get("/health")
def health():
    return {
        "ok": True,
        "model": settings.llm_model,
        "embedding_model": settings.embedding_model,
        "llm_configured": bool(settings.llm_api_key.strip()),
        "embedding_configured": bool(settings.embedding_api_key.strip()),
        "langfuse_configured": langfuse_io.is_enabled(),
        "langfuse_host": settings.langfuse_base_url if langfuse_io.is_enabled() else None,
    }


for module in (notebooks, sources, chat, notes, admin):
    api.include_router(module.router)
app.include_router(api)
