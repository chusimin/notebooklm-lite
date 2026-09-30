"""主要 API：笔记本、资料导入、片段、笔记、工作室、级联删除、错误格式。"""

from app.config import settings
from app.db import connect
from tests.conftest import SAMPLE_TEXT, wait_source_ready


def _new_notebook(client, title="测试笔记本"):
    r = client.post("/api/notebooks", json={"title": title})
    assert r.status_code == 200
    return r.json()


def _add_text(client, nb_id, content=SAMPLE_TEXT, title="动物资料"):
    r = client.post(f"/api/notebooks/{nb_id}/sources/text", json={"title": title, "content": content})
    assert r.status_code == 200
    src = r.json()
    assert src["status"] == "processing"
    return wait_source_ready(client, nb_id, src["id"])


def test_health(client):
    r = client.get("/api/health").json()
    assert r["ok"] is True and "model" in r and "embedding_model" in r


def test_notebook_crud(client):
    nb = _new_notebook(client)
    assert set(nb) == {"id", "title", "source_count", "created_at", "updated_at"}
    assert nb["source_count"] == 0 and nb["created_at"].endswith("Z")

    nb2 = _new_notebook(client, "第二个")
    items = client.get("/api/notebooks").json()
    assert [i["id"] for i in items] == [nb2["id"], nb["id"]]  # updated_at 倒序

    r = client.patch(f"/api/notebooks/{nb['id']}", json={"title": "改名"}).json()
    assert r["title"] == "改名"
    assert client.get(f"/api/notebooks/{nb['id']}").json()["title"] == "改名"

    assert client.delete(f"/api/notebooks/{nb['id']}").json() == {"ok": True}
    r = client.get(f"/api/notebooks/{nb['id']}")
    assert r.status_code == 404 and r.json() == {"detail": "笔记本不存在"}


def test_text_source_ingest(client):
    nb = _new_notebook(client)
    src = _add_text(client, nb["id"])
    assert src["status"] == "ready", src["error"]
    assert src["char_count"] > 0 and src["chunk_count"] >= 1
    assert src["summary"] == "这是一份关于测试的资料概要。"
    assert src["suggested_questions"] == ["问题一？", "问题二？", "问题三？"]
    assert src["type"] == "text" and src["uri"] is None
    assert client.get(f"/api/notebooks/{nb['id']}").json()["source_count"] == 1

    # 片段接口
    with connect() as conn:
        chunk_id = conn.execute("SELECT id FROM chunks WHERE source_id = ?", (src["id"],)).fetchone()[0]
    chunk = client.get(f"/api/chunks/{chunk_id}").json()
    assert set(chunk) == {"id", "source_id", "source_title", "idx", "page", "text"}
    assert chunk["source_title"] == "动物资料"


def test_summary_fallback_when_json_invalid(client, fake_models):
    fake_models["responder"] = lambda messages: "这不是 JSON"
    nb = _new_notebook(client)
    src = _add_text(client, nb["id"])
    assert src["status"] == "ready"
    assert src["summary"].startswith("猫是一种常见的家养宠物")
    assert len(src["suggested_questions"]) == 3


def test_file_upload_and_validation(client):
    nb = _new_notebook(client)
    r = client.post(
        f"/api/notebooks/{nb['id']}/sources/file",
        files={"file": ("笔记.md", "# 标题\n\n内容正文，关于猫。".encode(), "text/markdown")},
    )
    assert r.status_code == 200
    src = wait_source_ready(client, nb["id"], r.json()["id"])
    assert src["status"] == "ready" and src["type"] == "markdown" and src["title"] == "笔记.md"

    r = client.post(
        f"/api/notebooks/{nb['id']}/sources/file", files={"file": ("a.docx", b"xx", "application/octet-stream")}
    )
    assert r.status_code == 400 and "仅支持" in r.json()["detail"]


def test_file_too_large(client, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    nb = _new_notebook(client)
    r = client.post(f"/api/notebooks/{nb['id']}/sources/file", files={"file": ("a.txt", b"abc", "text/plain")})
    assert r.status_code == 413 and "MB" in r.json()["detail"]


def test_bad_pdf_marks_failed(client):
    nb = _new_notebook(client)
    r = client.post(f"/api/notebooks/{nb['id']}/sources/file", files={"file": ("x.pdf", b"garbage", "application/pdf")})
    src = wait_source_ready(client, nb["id"], r.json()["id"])
    assert src["status"] == "failed" and "PDF" in src["error"]
    # ingest run 记录为 error
    runs = client.get("/api/admin/runs?kind=ingest&status=error").json()
    assert runs["total"] == 1


def test_url_validation(client):
    nb = _new_notebook(client)
    r = client.post(f"/api/notebooks/{nb['id']}/sources/url", json={"url": "ftp://x"})
    assert r.status_code == 400 and "网址" in r.json()["detail"]


def test_validation_error_is_chinese_string(client):
    r = client.post("/api/notebooks/x/sources/text", json={"title": "t"})
    assert r.status_code == 422 and isinstance(r.json()["detail"], str) and "请求参数不合法" in r.json()["detail"]


def test_notes_and_studio(client):
    nb = _new_notebook(client)
    _add_text(client, nb["id"])
    note = client.post(f"/api/notebooks/{nb['id']}/notes", json={"kind": "answer", "title": "收藏", "content": "回答内容"}).json()
    assert set(note) == {"id", "notebook_id", "kind", "title", "content", "created_at"}

    r = client.post(f"/api/notebooks/{nb['id']}/studio", json={"kind": "briefing", "source_ids": None})
    assert r.status_code == 200
    brief = r.json()
    assert brief["kind"] == "briefing" and brief["title"].startswith("简报 · ")
    assert brief["content"].startswith("# 测试生成标题")

    notes = client.get(f"/api/notebooks/{nb['id']}/notes").json()
    assert [n["id"] for n in notes] == [brief["id"], note["id"]]  # 时间倒序

    assert client.delete(f"/api/notes/{note['id']}").json() == {"ok": True}
    assert client.post(f"/api/notebooks/{nb['id']}/studio", json={"kind": "xx"}).status_code == 400


def test_studio_map_reduce_for_large_material(client, monkeypatch):
    nb = _new_notebook(client)
    _add_text(client, nb["id"], title="资料一")
    _add_text(client, nb["id"], content="第二份资料的内容，关于鸟类。" * 5, title="资料二")
    monkeypatch.setattr(settings, "full_context_max_chars", 10)
    note = client.post(f"/api/notebooks/{nb['id']}/studio", json={"kind": "faq"}).json()
    assert note["kind"] == "faq" and note["title"].startswith("常见问题 · ")
    run = client.get("/api/admin/runs?kind=studio").json()["items"][0]
    detail = client.get(f"/api/admin/runs/{run['id']}").json()
    names = [s["name"] for s in detail["spans"] if s["type"] == "node"]
    assert names.count("map_summarize") == 2 and "write" in names and "save" in names


def test_studio_without_sources(client):
    nb = _new_notebook(client)
    r = client.post(f"/api/notebooks/{nb['id']}/studio", json={"kind": "faq"})
    assert r.status_code == 400 and "没有可用的资料" in r.json()["detail"]


def test_delete_notebook_cascades(client):
    nb = _new_notebook(client)
    src = _add_text(client, nb["id"])
    client.post(f"/api/notebooks/{nb['id']}/notes", json={"kind": "manual", "title": "t", "content": "c"})
    client.delete(f"/api/notebooks/{nb['id']}")
    with connect() as conn:
        for table in ("sources", "chunks", "messages", "notes"):
            assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
    assert client.get(f"/api/chunks/{src['id']}").status_code == 404


def test_delete_source(client):
    nb = _new_notebook(client)
    src = _add_text(client, nb["id"])
    assert client.delete(f"/api/sources/{src['id']}").json() == {"ok": True}
    assert client.get(f"/api/notebooks/{nb['id']}/sources").json() == []
    assert client.delete(f"/api/sources/{src['id']}").status_code == 404
