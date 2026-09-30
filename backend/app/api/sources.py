"""资料管理：上传文件 / 网页链接 / 粘贴文本，列表、删除，片段查看。

添加资料接口立即返回 status=processing 的 Source，导入流程在后台执行（ingest_graph）。
"""

from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, File, HTTPException, UploadFile

from app import repo
from app.api.deps import require_notebook
from app.api.schemas import TextSourceIn, UrlSourceIn
from app.config import settings
from app.graphs.ingest import schedule_ingest

router = APIRouter(tags=["sources"])

# 扩展名 -> Source.type
FILE_TYPES = {".pdf": "pdf", ".txt": "text", ".md": "markdown", ".markdown": "markdown"}
TEXT_MAX_CHARS = 2_000_000


@router.get("/notebooks/{notebook_id}/sources")
def list_sources(notebook_id: str):
    require_notebook(notebook_id)
    return repo.list_sources(notebook_id)


@router.post("/notebooks/{notebook_id}/sources/file")
async def upload_file(notebook_id: str, file: UploadFile = File(...)):
    require_notebook(notebook_id)
    filename = file.filename or "未命名文件"
    ext = Path(filename).suffix.lower()
    if ext not in FILE_TYPES:
        raise HTTPException(status_code=400, detail="仅支持 .pdf / .txt / .md 文件")
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"文件大小不能超过 {settings.max_upload_mb}MB")
    if not data:
        raise HTTPException(status_code=400, detail="文件内容为空")
    source = repo.create_source(notebook_id, FILE_TYPES[ext], filename, None)
    schedule_ingest(source, file_bytes=data)
    return source


# 注意：调度后台任务需要运行中的事件循环，因此以下接口必须是 async def（sync 路由在线程池执行）
@router.post("/notebooks/{notebook_id}/sources/url")
async def add_url(notebook_id: str, body: UrlSourceIn):
    require_notebook(notebook_id)
    url = body.url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="请输入以 http:// 或 https:// 开头的有效网址")
    # 标题先用网址占位，抓取成功后替换为网页 title
    source = repo.create_source(notebook_id, "url", url, url)
    schedule_ingest(source)
    return source


@router.post("/notebooks/{notebook_id}/sources/text")
async def add_text(notebook_id: str, body: TextSourceIn):
    require_notebook(notebook_id)
    content = body.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="文本内容不能为空")
    if len(content) > TEXT_MAX_CHARS:
        raise HTTPException(status_code=400, detail=f"文本不能超过 {TEXT_MAX_CHARS} 字")
    title = body.title.strip()[:100] or content.splitlines()[0][:30] or "粘贴的文本"
    source = repo.create_source(notebook_id, "text", title, None)
    schedule_ingest(source, text=content)
    return source


@router.delete("/sources/{source_id}")
def delete_source(source_id: str):
    if not repo.delete_source(source_id):
        raise HTTPException(status_code=404, detail="资料不存在")
    return {"ok": True}


@router.get("/chunks/{chunk_id}")
def get_chunk(chunk_id: str):
    chunk = repo.get_chunk(chunk_id)
    if chunk is None:
        raise HTTPException(status_code=404, detail="片段不存在（资料可能已被删除）")
    return chunk
