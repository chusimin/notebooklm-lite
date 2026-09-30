"""笔记本 CRUD。"""

from fastapi import APIRouter, HTTPException

from app import repo
from app.api.deps import require_notebook
from app.api.schemas import NotebookIn

router = APIRouter(tags=["notebooks"])

TITLE_MAX = 100


def _clean_title(title: str) -> str:
    title = (title or "").strip()
    if len(title) > TITLE_MAX:
        raise HTTPException(status_code=400, detail=f"标题不能超过 {TITLE_MAX} 个字")
    return title or "未命名笔记本"


@router.get("/notebooks")
def list_notebooks():
    return repo.list_notebooks()


@router.post("/notebooks")
def create_notebook(body: NotebookIn):
    return repo.create_notebook(_clean_title(body.title))


@router.get("/notebooks/{notebook_id}")
def get_notebook(notebook_id: str):
    return require_notebook(notebook_id)


@router.patch("/notebooks/{notebook_id}")
def rename_notebook(notebook_id: str, body: NotebookIn):
    require_notebook(notebook_id)
    return repo.update_notebook_title(notebook_id, _clean_title(body.title))


@router.delete("/notebooks/{notebook_id}")
def delete_notebook(notebook_id: str):
    if not repo.delete_notebook(notebook_id):
        raise HTTPException(status_code=404, detail="笔记本不存在")
    return {"ok": True}
