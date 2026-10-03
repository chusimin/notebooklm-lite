"""RAG 流转演示的预置案例「喵记咖啡」（docs/RAG_FLOW_DEMO.md 第 3 节）。

一键创建（或复用）演示笔记本并导入 examples/rag-demo 下的资料。
演示资料用 300 字小切片：卡片多到"从一堆里挑几张"才有意义，单张卡片也能在屏幕上读完。
"""

from __future__ import annotations

import re
from pathlib import Path

from app import repo
from app.config import BACKEND_DIR
from app.graphs.ingest import schedule_ingest

DEMO_TITLE = "RAG 演示 · 喵记咖啡"
DEMO_DIR = BACKEND_DIR.parent / "examples" / "rag-demo"
DEMO_CHUNKING = (300, 60)

# 每个问题演示一个知识点，lesson 是给前端的讲解标签
QUESTIONS = [
    {
        "question": "咖啡买错了还能把钱要回来吗？",
        "lesson": "按意思找赢了",
        "hint": "资料写的是「订单取消与退款」，问题里一个「退款」都没有，关键词只能找到满地的「咖啡」",
    },
    {
        "question": "Q7303 是什么？",
        "lesson": "按字面找赢了",
        "hint": "Q7303 是新品编号，向量对编号不敏感，关键词一下就找到了",
    },
    {
        "question": "金卡会员每个月送几杯？",
        "lesson": "两路都找到",
        "hint": "两份名单都把同一张卡片排在前面，合并后稳居第一",
    },
    {
        "question": "你们支持比特币支付吗？",
        "lesson": "资料里没有",
        "hint": "能找到讲支付的卡片，但里面没有比特币，模型应该如实说没提到",
    },
]


def _doc_title(path: Path) -> str:
    return re.sub(r"^\d+[-_ ]*", "", path.stem)


def _find_notebook() -> dict | None:
    return next((n for n in repo.list_notebooks() if n["title"] == DEMO_TITLE), None)


def info() -> dict:
    nb = _find_notebook()
    return {
        "title": DEMO_TITLE,
        "notebook": nb,
        "sources": repo.list_sources(nb["id"]) if nb else [],
        "questions": QUESTIONS,
        "chunking": {"size": DEMO_CHUNKING[0], "overlap": DEMO_CHUNKING[1]},
    }


def setup() -> dict:
    """幂等：已导入且未失败的资料不重复导入；失败的删掉重导。需要在事件循环中调用。"""
    nb = _find_notebook() or repo.create_notebook(DEMO_TITLE)
    existing = {s["title"]: s for s in repo.list_sources(nb["id"])}
    for path in sorted(DEMO_DIR.glob("*.md")):
        title = _doc_title(path)
        old = existing.get(title)
        if old and old["status"] != "failed":
            continue
        if old:
            repo.delete_source(old["id"])
        source = repo.create_source(nb["id"], "markdown", title, None)
        schedule_ingest(source, text=path.read_text(encoding="utf-8"), chunking=DEMO_CHUNKING)
    return info()
