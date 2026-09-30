"""文本切分：RecursiveCharacterTextSplitter，中文标点优先。

逐页切分，保证每个片段只属于一页，从而保留 page 页码用于引用定位；
idx 在整份资料内连续编号，full 模式按 idx 还原原文顺序。
"""

from __future__ import annotations

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.utils import new_id

CHUNK_SIZE = 800
CHUNK_OVERLAP = 120

# 段落 > 换行 > 中文句末标点 > 英文句末标点 > 中文逗号/顿号 > 空格 > 字符
SEPARATORS = ["\n\n", "\n", "。", "！", "？", "；", ". ", "! ", "? ", "; ", "，", "、", ", ", " ", ""]


def make_splitter(chunk_size: int = CHUNK_SIZE, chunk_overlap: int = CHUNK_OVERLAP) -> RecursiveCharacterTextSplitter:
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=SEPARATORS,
        keep_separator="end",  # 标点留在句尾，片段读起来更自然
        strip_whitespace=True,
    )


def split_pages(
    pages: list[dict], chunk_size: int = CHUNK_SIZE, chunk_overlap: int = CHUNK_OVERLAP
) -> list[dict]:
    """[{page, text}] -> [{id, idx, page, text}]"""
    splitter = make_splitter(chunk_size, chunk_overlap)
    chunks: list[dict] = []
    for page in pages:
        for piece in splitter.split_text(page["text"]):
            piece = piece.strip()
            if not piece:
                continue
            chunks.append({"id": new_id(), "idx": len(chunks), "page": page.get("page"), "text": piece})
    return chunks
