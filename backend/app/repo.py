"""业务数据访问层（Repository）。

职责：封装 notebooks / sources / chunks / messages / notes 的读写 SQL，
并把数据库行序列化为 DESIGN 5.1 约定的对外类型（Notebook / Source / Message ...）。
API 路由与 LangGraph 节点都只通过这里访问业务表，保证字段口径一致。
"""

import sqlite3
from typing import Any

import numpy as np

from app.db import connect
from app.utils import dumps, loads, new_id, utc_now_iso

# ---------------------------------------------------------------------------
# 序列化：数据库行 -> 契约类型
# ---------------------------------------------------------------------------


def _notebook(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "source_count": row["source_count"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _source(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "notebook_id": row["notebook_id"],
        "type": row["type"],
        "title": row["title"],
        "uri": row["uri"],
        "status": row["status"],
        "error": row["error"],
        "char_count": row["char_count"],
        "chunk_count": row["chunk_count"],
        "summary": row["summary"],
        "suggested_questions": loads(row["suggested_questions_json"], []) or [],
        "created_at": row["created_at"],
    }


def _message(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "notebook_id": row["notebook_id"],
        "role": row["role"],
        "content": row["content"],
        "citations": loads(row["citations_json"], []) or [],
        "run_id": row["run_id"],
        "mode": row["mode"],
        "feedback": row["feedback"],
        "created_at": row["created_at"],
    }


def _note(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in ("id", "notebook_id", "kind", "title", "content", "created_at")}


# ---------------------------------------------------------------------------
# Notebooks
# ---------------------------------------------------------------------------

_NOTEBOOK_SELECT = """
SELECT n.*, (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count
FROM notebooks n
"""


def list_notebooks() -> list[dict]:
    with connect() as conn:
        rows = conn.execute(_NOTEBOOK_SELECT + " ORDER BY n.updated_at DESC").fetchall()
    return [_notebook(r) for r in rows]


def get_notebook(notebook_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute(_NOTEBOOK_SELECT + " WHERE n.id = ?", (notebook_id,)).fetchone()
    return _notebook(row) if row else None


def create_notebook(title: str) -> dict:
    nid, now = new_id(), utc_now_iso()
    with connect() as conn:
        conn.execute(
            "INSERT INTO notebooks(id, title, created_at, updated_at) VALUES (?,?,?,?)",
            (nid, title, now, now),
        )
    return get_notebook(nid)  # type: ignore[return-value]


def update_notebook_title(notebook_id: str, title: str) -> dict | None:
    with connect() as conn:
        conn.execute(
            "UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ?",
            (title, utc_now_iso(), notebook_id),
        )
    return get_notebook(notebook_id)


def touch_notebook(notebook_id: str) -> None:
    """有新活动（加资料、对话、笔记）时刷新 updated_at，列表按最近使用排序。"""
    with connect() as conn:
        conn.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (utc_now_iso(), notebook_id))


def delete_notebook(notebook_id: str) -> bool:
    """外键 ON DELETE CASCADE 会级联删除资料、片段、消息与笔记。"""
    with connect() as conn:
        cur = conn.execute("DELETE FROM notebooks WHERE id = ?", (notebook_id,))
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------


def create_source(notebook_id: str, type_: str, title: str, uri: str | None) -> dict:
    sid = new_id()
    with connect() as conn:
        conn.execute(
            """INSERT INTO sources(id, notebook_id, type, title, uri, status, created_at)
               VALUES (?,?,?,?,?, 'processing', ?)""",
            (sid, notebook_id, type_, title, uri, utc_now_iso()),
        )
    touch_notebook(notebook_id)
    return get_source(sid)  # type: ignore[return-value]


def get_source(source_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM sources WHERE id = ?", (source_id,)).fetchone()
    return _source(row) if row else None


def list_sources(notebook_id: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sources WHERE notebook_id = ? ORDER BY created_at", (notebook_id,)
        ).fetchall()
    return [_source(r) for r in rows]


def update_source(source_id: str, **fields: Any) -> None:
    if not fields:
        return
    if "suggested_questions" in fields:
        fields["suggested_questions_json"] = dumps(fields.pop("suggested_questions"))
    cols = ", ".join(f"{k} = ?" for k in fields)
    with connect() as conn:
        conn.execute(f"UPDATE sources SET {cols} WHERE id = ?", (*fields.values(), source_id))


def delete_source(source_id: str) -> bool:
    src = get_source(source_id)
    if not src:
        return False
    with connect() as conn:
        conn.execute("DELETE FROM sources WHERE id = ?", (source_id,))
    touch_notebook(src["notebook_id"])
    return True


def fail_stale_processing_sources() -> int:
    """服务重启时，内存中的后台导入任务已丢失，把遗留的 processing 资料标记为失败，
    避免前端无限轮询。"""
    with connect() as conn:
        cur = conn.execute(
            "UPDATE sources SET status = 'failed', error = ? WHERE status = 'processing'",
            ("服务重启导致处理中断，请删除后重新添加",),
        )
    return cur.rowcount


def resolve_ready_sources(notebook_id: str, source_ids: list[str] | None) -> list[dict]:
    """source_ids 为 None 表示该笔记本全部 ready 资料；否则取交集（忽略未就绪/不属于该笔记本的 id）。"""
    sources = [s for s in list_sources(notebook_id) if s["status"] == "ready"]
    if source_ids is None:
        return sources
    wanted = set(source_ids)
    return [s for s in sources if s["id"] in wanted]


# ---------------------------------------------------------------------------
# Chunks
# ---------------------------------------------------------------------------


def insert_chunks(source_id: str, notebook_id: str, chunks: list[dict], vectors: np.ndarray) -> None:
    """批量写入片段与向量（float32 BLOB，写入前已做 L2 归一化）。"""
    rows = [
        (
            c["id"],
            source_id,
            notebook_id,
            c["idx"],
            c["page"],
            c["text"],
            np.asarray(vectors[i], dtype=np.float32).tobytes(),
        )
        for i, c in enumerate(chunks)
    ]
    with connect() as conn:
        conn.executemany(
            "INSERT INTO chunks(id, source_id, notebook_id, idx, page, text, embedding) VALUES (?,?,?,?,?,?,?)",
            rows,
        )


def load_chunks(source_ids: list[str], with_embedding: bool = False) -> list[dict]:
    """按资料创建顺序、片段序号加载片段（附带来源标题），full 模式直接按此顺序拼上下文。"""
    if not source_ids:
        return []
    marks = ",".join("?" * len(source_ids))
    emb_col = ", c.embedding" if with_embedding else ""
    with connect() as conn:
        rows = conn.execute(
            f"""SELECT c.id, c.source_id, c.idx, c.page, c.text, s.title AS source_title{emb_col}
                FROM chunks c JOIN sources s ON s.id = c.source_id
                WHERE c.source_id IN ({marks})
                ORDER BY s.created_at, c.idx""",
            source_ids,
        ).fetchall()
    result = []
    for r in rows:
        item = {
            "id": r["id"],
            "source_id": r["source_id"],
            "source_title": r["source_title"],
            "idx": r["idx"],
            "page": r["page"],
            "text": r["text"],
        }
        if with_embedding:
            item["embedding"] = np.frombuffer(r["embedding"], dtype=np.float32) if r["embedding"] else None
        result.append(item)
    return result


def get_chunk(chunk_id: str) -> dict | None:
    with connect() as conn:
        r = conn.execute(
            """SELECT c.id, c.source_id, c.idx, c.page, c.text, s.title AS source_title
               FROM chunks c JOIN sources s ON s.id = c.source_id WHERE c.id = ?""",
            (chunk_id,),
        ).fetchone()
    if not r:
        return None
    return {k: r[k] for k in ("id", "source_id", "source_title", "idx", "page", "text")}


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def create_message(
    notebook_id: str,
    role: str,
    content: str,
    citations: list[dict] | None = None,
    run_id: str | None = None,
    mode: str | None = None,
) -> dict:
    mid = new_id()
    with connect() as conn:
        conn.execute(
            """INSERT INTO messages(id, notebook_id, role, content, citations_json, run_id, mode, feedback, created_at)
               VALUES (?,?,?,?,?,?,?,0,?)""",
            (mid, notebook_id, role, content, dumps(citations or []), run_id, mode, utc_now_iso()),
        )
    touch_notebook(notebook_id)
    return get_message(mid)  # type: ignore[return-value]


def get_message(message_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
    return _message(row) if row else None


def list_messages(notebook_id: str) -> list[dict]:
    # rowid 作为同毫秒写入时的次级排序，保证用户消息在助手消息之前
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE notebook_id = ? ORDER BY created_at, rowid", (notebook_id,)
        ).fetchall()
    return [_message(r) for r in rows]


def recent_history(notebook_id: str, limit: int = 6) -> list[dict]:
    """最近 limit 条消息（时间正序），供改写问题与多轮对话使用。"""
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE notebook_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (notebook_id, limit),
        ).fetchall()
    return [_message(r) for r in reversed(rows)]


def clear_messages(notebook_id: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM messages WHERE notebook_id = ?", (notebook_id,))


def set_message_feedback(message_id: str, value: int) -> dict | None:
    """写消息反馈，并同步回写对应 run 的 feedback，便于后台按差评追溯链路。"""
    msg = get_message(message_id)
    if not msg:
        return None
    with connect() as conn:
        conn.execute("UPDATE messages SET feedback = ? WHERE id = ?", (value, message_id))
        if msg["run_id"]:
            conn.execute("UPDATE runs SET feedback = ? WHERE id = ?", (value, msg["run_id"]))
    return get_message(message_id)


# ---------------------------------------------------------------------------
# Notes
# ---------------------------------------------------------------------------


def create_note(notebook_id: str, kind: str, title: str, content: str) -> dict:
    nid = new_id()
    with connect() as conn:
        conn.execute(
            "INSERT INTO notes(id, notebook_id, kind, title, content, created_at) VALUES (?,?,?,?,?,?)",
            (nid, notebook_id, kind, title, content, utc_now_iso()),
        )
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (nid,)).fetchone()
    touch_notebook(notebook_id)
    return _note(row)


def list_notes(notebook_id: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM notes WHERE notebook_id = ? ORDER BY created_at DESC, rowid DESC", (notebook_id,)
        ).fetchall()
    return [_note(r) for r in rows]


def delete_note(note_id: str) -> bool:
    with connect() as conn:
        cur = conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return cur.rowcount > 0
