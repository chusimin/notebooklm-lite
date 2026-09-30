"""引用解析与规范化。

模型输出的引用写法不统一：`[1]`、`[1][2]`、`[1, 2]`、`[1，2]`、`[1、2]`。
这里统一规范为 `[1][2]`，丢弃越界编号，并只为正文中实际出现的编号生成 citations，
citation.index 与正文编号保持一致，前端点击角标即可按 index 找到原文。
"""

from __future__ import annotations

import re

# 方括号内是若干数字，以英文/中文逗号、顿号或空白分隔；排除 Markdown 链接 [1](url) 与脚注 [^1]
_CITE_RE = re.compile(r"\[\s*(\d{1,3}(?:\s*[,，、;；\s]\s*\d{1,3})*)\s*\](?!\()")
_NUM_RE = re.compile(r"\d+")

SNIPPET_LEN = 200


def normalize_citations(text: str, max_index: int) -> tuple[str, list[int]]:
    """返回 (规范化后的正文, 按首次出现顺序的有效编号列表)。"""
    used: list[int] = []

    def replace(match: re.Match) -> str:
        nums: list[int] = []
        for n in (int(x) for x in _NUM_RE.findall(match.group(1))):
            if 1 <= n <= max_index and n not in nums:
                nums.append(n)
        for n in nums:
            if n not in used:
                used.append(n)
        return "".join(f"[{n}]" for n in nums)

    normalized = _CITE_RE.sub(replace, text)
    # 删除越界引用后可能留下多余空格（如“内容 。”）
    normalized = re.sub(r"[ \t]+([。，；：！？,.;:!?])", r"\1", normalized)
    return normalized, used


def build_citations(text: str, contexts: list[dict]) -> tuple[str, list[dict]]:
    """contexts 为按编号顺序排列的片段（contexts[i] 对应 [i+1]）。"""
    normalized, used = normalize_citations(text, len(contexts))
    citations = []
    for n in sorted(used):
        c = contexts[n - 1]
        citations.append(
            {
                "index": n,
                "chunk_id": c["id"],
                "source_id": c["source_id"],
                "source_title": c["source_title"],
                "page": c["page"],
                "snippet": c["text"][:SNIPPET_LEN],
            }
        )
    return normalized, citations


def strip_citations(text: str) -> str:
    """历史消息里的编号对应的是旧的上下文，传给模型前去掉，避免编号混淆。"""
    return _CITE_RE.sub("", text)
