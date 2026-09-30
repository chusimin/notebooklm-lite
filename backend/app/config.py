"""全局配置。

职责：用 pydantic-settings 从 `backend/.env` 读取模型、向量化、成本单价等配置；
未配置项使用与 `.env.example` 一致的默认值。其它模块统一 `from app.config import settings`，
测试可直接修改 `settings` 的属性（如 db_path）来隔离环境。
"""

import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 目录（本文件位于 backend/app/config.py）
BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- 对话模型（OpenAI 兼容接口，默认 OpenRouter）----
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_api_key: str = ""
    llm_model: str = "deepseek/deepseek-v3.2"
    # 轻量任务（改写问题、资料概要）使用的快模型
    llm_fast_model: str = "qwen/qwen3-next-80b-a3b-instruct"

    # ---- 向量化模型 ----
    embedding_base_url: str = "https://openrouter.ai/api/v1"
    embedding_api_key: str = ""
    embedding_model: str = "openai/text-embedding-3-small"

    # 所选资料总字数不超过该值时走全文模式，否则走 RAG
    full_context_max_chars: int = 40000

    # ---- 成本估算单价（美元 / 百万 token）----
    price_input_per_m: float = 0.3
    price_output_per_m: float = 0.9
    price_embedding_per_m: float = 0.02

    # ---- 可选：LangSmith 追踪（LangChain 从环境变量读取）----
    langsmith_tracing: bool = False
    langsmith_api_key: str = ""
    langsmith_project: str = ""
    langsmith_endpoint: str = ""

    # ---- 运行参数 ----
    db_path: Path = BACKEND_DIR / "data" / "app.db"
    max_upload_mb: int = 20
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


settings = Settings()


def export_langsmith_env() -> None:
    """pydantic-settings 只读取 .env 不写入进程环境；LangChain 的 LangSmith 追踪
    依赖 os.environ，因此开启时把相关配置导出到环境变量。"""
    if not settings.langsmith_tracing:
        return
    os.environ.setdefault("LANGSMITH_TRACING", "true")
    for key, value in (
        ("LANGSMITH_API_KEY", settings.langsmith_api_key),
        ("LANGSMITH_PROJECT", settings.langsmith_project),
        ("LANGSMITH_ENDPOINT", settings.langsmith_endpoint),
    ):
        if value:
            os.environ.setdefault(key, value)
