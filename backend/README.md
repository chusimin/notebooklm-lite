# NotebookLM Lite · 后端

FastAPI + LangGraph 实现的个人版 NotebookLM 后端。需求与 API 契约见 `../docs/DESIGN.md`。

## 快速开始

```bash
cd backend
cp .env.example .env        # 填入 LLM_API_KEY / EMBEDDING_API_KEY（OpenRouter Key）
uv sync                     # Python 3.12
uv run uvicorn app.main:app --port 8765
```

- 健康检查：`curl localhost:8765/api/health`
- 接口文档：http://localhost:8765/docs
- 数据库：`backend/data/app.db`（自动创建，SQLite WAL）
- CORS 已允许 `http://localhost:5173`

## 测试

```bash
uv run pytest -q
```

测试使用临时数据库 + 假聊天模型 / 假向量化（`tests/conftest.py`），不访问网络。

## 目录结构

```text
app/
  main.py              应用入口：CORS、统一中文错误格式、路由挂载、启动时建表
  config.py            pydantic-settings 读取 .env
  db.py                SQLite 建表与连接（外键 + WAL）
  repo.py              业务表读写 + 契约类型序列化
  api/                 REST 与 SSE 路由（notebooks / sources / chat / notes+studio / admin）
  graphs/              LangGraph：ingest.py / chat.py / studio.py
  rag/                 loaders（PDF/文本/网页）、splitter、retriever（向量+BM25+RRF）、citations
  llm/                 factory（模型工厂）、prompts（提示词）、output（输出解析）
  observability/       tracer（run/span + @traced_node）、callback（LLM 回调）、stats（后台统计）
tests/                 pytest
```

## 关键设计

- **导入**：上传接口立即返回 `status=processing`，`asyncio.create_task` 后台执行 `load → split → embed → summarize → save`；失败写 `failed` 与中文 `error`。服务重启时遗留的 processing 资料会被标为失败。
- **问答**：资料总字数 ≤ `FULL_CONTEXT_MAX_CHARS` 走 full 模式（跳过改写与检索），否则 rag 模式（改写 → 混合检索 top8）。引用统一规范为 `[1][2]`，越界编号丢弃，citations 只含正文实际出现的编号。
- **观测**：每次调用一条 run；节点、LLM、检索、向量化分别记 span。run 的 token/成本只累加 llm + embedding 叶子 span；node span 上显示其子孙合计。成本按 `.env` 单价估算。
- **LangSmith（可选）**：`.env` 中设置 `LANGSMITH_TRACING=true` 与 `LANGSMITH_API_KEY`（可选 `LANGSMITH_PROJECT`），启动时会导出到环境变量，LangChain / LangGraph 自带追踪即生效，无需额外代码；自建追踪不受影响。
