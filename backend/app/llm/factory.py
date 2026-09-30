"""模型工厂：统一创建聊天模型与向量化客户端。

业务代码一律通过 `factory.get_chat_model()` / `factory.get_embedder()` 获取模型
（以模块属性方式调用），测试用 monkeypatch 替换这两个函数即可注入假模型，无需网络。
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import numpy as np
from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from app.config import settings
from app.observability.tracer import estimate_tokens


def get_chat_model(fast: bool = False) -> BaseChatModel:
    """OpenAI 兼容接口的聊天模型。stream_usage=True 让流式响应最后带回 token 用量。"""
    return ChatOpenAI(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_fast_model if fast else settings.llm_model,
        temperature=0.2 if fast else 0.3,
        stream_usage=True,
        timeout=120,
        max_retries=2,
    )


@dataclass
class EmbedResult:
    vectors: np.ndarray  # shape (n, dim)，float32，已 L2 归一化
    tokens: int
    model: str


class EmbeddingError(RuntimeError):
    pass


def normalize(vectors: np.ndarray) -> np.ndarray:
    """L2 归一化后，余弦相似度 = 点积，检索时只需一次矩阵乘法。"""
    vectors = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


class OpenAICompatibleEmbedder:
    """直接用 httpx 调 `/embeddings`。

    不用 langchain 的 OpenAIEmbeddings：它默认用 tiktoken 按 OpenAI 模型名分块，
    在 OpenRouter 的模型名下不适用；且直接调用能拿到 usage.prompt_tokens 用于成本统计。
    """

    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    async def embed(self, texts: list[str]) -> EmbedResult:
        if not texts:
            return EmbedResult(np.zeros((0, 0), dtype=np.float32), 0, self.model)
        async with httpx.AsyncClient(timeout=60) as client:
            last_err: Exception | None = None
            for _ in range(3):  # 简单重试，应对偶发网络抖动
                try:
                    resp = await client.post(
                        f"{self.base_url}/embeddings",
                        headers={"Authorization": f"Bearer {self.api_key}"},
                        json={"model": self.model, "input": texts},
                    )
                    if resp.status_code >= 400:
                        raise EmbeddingError(f"向量化接口返回 {resp.status_code}：{resp.text[:200]}")
                    payload = resp.json()
                    break
                except (httpx.HTTPError, EmbeddingError, ValueError) as exc:
                    last_err = exc
            else:
                raise EmbeddingError(f"向量化失败：{last_err}")
        data = payload.get("data") or []
        if len(data) != len(texts):
            raise EmbeddingError(f"向量化返回数量不符：期望 {len(texts)}，实际 {len(data)}")
        data = sorted(data, key=lambda d: d.get("index", 0))
        vectors = normalize(np.array([d["embedding"] for d in data], dtype=np.float32))
        tokens = (payload.get("usage") or {}).get("prompt_tokens") or sum(estimate_tokens(t) for t in texts)
        return EmbedResult(vectors, int(tokens), self.model)


def get_embedder() -> OpenAICompatibleEmbedder:
    return OpenAICompatibleEmbedder(
        settings.embedding_base_url, settings.embedding_api_key, settings.embedding_model
    )
