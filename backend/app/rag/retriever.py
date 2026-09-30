"""混合检索：向量 top20 + jieba BM25 top20，RRF(k=60) 融合取 top8。

- 向量检索：片段向量入库前已 L2 归一化，查询向量同样归一化，余弦 = 点积。
- BM25：按需对候选片段即时建索引（个人规模足够快，避免维护倒排索引的一致性问题）。
- RRF：score = Σ 1 / (k + rank)，对两路分数量纲不一致不敏感，是融合多路召回的稳健做法。
"""

from __future__ import annotations

import logging
import re

import jieba
import numpy as np
from rank_bm25 import BM25Okapi

from app.llm import factory
from app.observability.tracer import embedding_cost, span

jieba.setLogLevel(logging.WARNING)

VECTOR_TOP_K = 20
BM25_TOP_K = 20
RRF_K = 60
FINAL_TOP_N = 8

_TOKEN_OK = re.compile(r"[\w\u4e00-\u9fff]", re.U)


def tokenize(text: str) -> list[str]:
    """jieba 搜索引擎模式分词，小写化并过滤纯标点/空白 token。"""
    return [t.lower() for t in jieba.lcut_for_search(text) if t.strip() and _TOKEN_OK.search(t)]


def rrf_fuse(rankings: list[list[str]], k: int = RRF_K, top_n: int = FINAL_TOP_N) -> list[tuple[str, float]]:
    """倒数排名融合。rankings 为多路召回的 id 列表（按相关度降序）。
    分数相同时按首次出现顺序稳定排序。"""
    scores: dict[str, float] = {}
    first_seen: dict[str, int] = {}
    order = 0
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank)
            if doc_id not in first_seen:
                first_seen[doc_id] = order
                order += 1
    fused = sorted(scores.items(), key=lambda kv: (-kv[1], first_seen[kv[0]]))
    return fused[:top_n]


def vector_search(query_vec: np.ndarray, chunks: list[dict], top_k: int = VECTOR_TOP_K) -> list[tuple[str, float]]:
    valid = [c for c in chunks if c.get("embedding") is not None]
    if not valid:
        return []
    matrix = np.vstack([c["embedding"] for c in valid])
    sims = matrix @ query_vec.astype(np.float32)
    order = np.argsort(-sims)[:top_k]
    return [(valid[i]["id"], float(sims[i])) for i in order]


def bm25_search(query: str, chunks: list[dict], top_k: int = BM25_TOP_K) -> list[tuple[str, float]]:
    if not chunks:
        return []
    q_tokens = tokenize(query)
    if not q_tokens:
        return []
    corpus = [tokenize(c["text"]) or ["_"] for c in chunks]
    scores = BM25Okapi(corpus).get_scores(q_tokens)
    order = np.argsort(-scores)[:top_k]
    # 只保留有词项命中的片段（BM25 在小语料下 idf 可能为负，用命中判断更稳）
    q_set = set(q_tokens)
    return [
        (chunks[i]["id"], float(scores[i]))
        for i in order
        if q_set.intersection(corpus[i])
    ]


def _hit_summary(chunk: dict, score: float) -> dict:
    return {
        "chunk_id": chunk["id"],
        "source_title": chunk["source_title"],
        "page": chunk["page"],
        "score": round(score, 5),
        "text": chunk["text"][:100],
    }


async def hybrid_search(query: str, chunks: list[dict], top_n: int = FINAL_TOP_N) -> list[dict]:
    """对候选片段做混合检索，返回 top_n 片段（附 score），并记录 embedding / retriever span。"""
    if not chunks:
        return []
    by_id = {c["id"]: c for c in chunks}
    embedder = factory.get_embedder()

    async with span("embed_query", "embedding", {"count": 1, "text": query[:200]}, model=embedder.model) as sp:
        result = await embedder.embed([query])
        if sp is not None:
            sp.prompt_tokens = result.tokens
            sp.cost_usd = embedding_cost(result.tokens)
            sp.output = {"count": 1, "tokens": result.tokens, "dim": int(result.vectors.shape[1])}
    query_vec = result.vectors[0]

    async with span("hybrid_search", "retriever", {"query": query, "candidates": len(chunks)}) as sp:
        vec_hits = vector_search(query_vec, chunks)
        bm25_hits = bm25_search(query, chunks)
        fused = rrf_fuse([[i for i, _ in vec_hits], [i for i, _ in bm25_hits]], top_n=top_n)
        hits = [{**by_id[i], "score": s} for i, s in fused]
        if sp is not None:
            sp.output = {
                "vector_hits": [_hit_summary(by_id[i], s) for i, s in vec_hits[:10]],
                "bm25_hits": [_hit_summary(by_id[i], s) for i, s in bm25_hits[:10]],
                "fused": [_hit_summary(h, h["score"]) for h in hits],
            }
    return hits
