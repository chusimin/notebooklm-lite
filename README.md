# NotebookLM Lite

个人版 NotebookLM 示例：把 PDF / 网页 / 文本变成可对话、可溯源的知识笔记本，并附带一个调用观测后台。

- 产品：http://localhost:5173
- 观测后台：http://localhost:5173/admin
- 设计文档：[docs/DESIGN.md](docs/DESIGN.md)
- 示例资料：[examples/什么是NotebookLM.md](examples/什么是NotebookLM.md)

## 它做什么

1. 建笔记本，添加资料（PDF、TXT/Markdown、网页、粘贴文本）。
2. 基于勾选的资料提问，回答带 `[1][2]` 引用，点击可看原文。
3. 工作室一键生成简报 / 学习指南 / FAQ，或把回答存成笔记。
4. 在观测后台看每次调用的链路、耗时、token 与估算成本。

技术栈：FastAPI + LangGraph（导入 / 问答 / 生成三张图）+ Vite React；追踪写入本机 SQLite，不依赖 LangSmith 账号。

## 启动

需要 Python 3.12+、Node.js 20+、[uv](https://docs.astral.sh/uv/)。

### 1. 配置模型密钥

```bash
cd backend
cp .env.example .env
```

编辑 `.env`，填入 OpenRouter（或任意 OpenAI 兼容接口）的 `LLM_API_KEY` 与 `EMBEDDING_API_KEY`。默认模型：

- 主回答：`deepseek/deepseek-v3.2`
- 改写 / 概要：`qwen/qwen3-next-80b-a3b-instruct`
- 向量化：`openai/text-embedding-3-small`

### 2. 启动后端

```bash
cd backend
uv sync
uv run uvicorn app.main:app --port 8765 --reload --reload-dir app
```

健康检查：http://localhost:8765/api/health

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:5173

## 第一次怎么用

1. 点「新建笔记本」，例如「NotebookLM 调研」。
2. 添加资料：把 `examples/什么是NotebookLM.md` 拖进去，或粘贴文本、填网页链接。
3. 等资料变为「就绪」后，点推荐问题，或自己提问。
4. 点回答里的编号，核对原文；可把回答存为笔记，或在右侧生成简报。
5. 顶栏进入「观测后台」，看这次问答的瀑布图、节点耗时和成本。

未配置密钥时，首页会提示；导入和问答会失败。

## 用 Langfuse 看运行过程

本机 `/admin` 是自建观测后台。要看 **LangGraph 节点树 + 每次 LLM 的完整 prompt/completion**，用本机 Langfuse（已写好配置，不必改 `.env`）。

```bash
chmod +x scripts/start-langfuse.sh
./scripts/start-langfuse.sh
# 然后重启后端
cd backend && uv run uvicorn app.main:app --port 8765 --reload --reload-dir app
```

- 界面：http://localhost:3100
- 登录：`local@notebooklm.lite` / `notebooklm-local`
- 在产品里问一句，回到 Langfuse 左侧 **Tracing**

你会看到 Trace 名称 `chat_graph` / `ingest_graph` / `studio_graph`，点进去是各节点 → `ChatOpenAI`。

也可用云端：把 `.env` 里的 `LANGFUSE_BASE_URL` 改回 `https://cloud.langfuse.com` 并填官方 pk/sk。LangSmith（`LANGSMITH_TRACING=true`）与本机后台可同时开。

## 测试

```bash
cd backend && uv run pytest -q
cd frontend && npm run build
```

测试使用假模型，不访问网络。

## 目录

```text
docs/DESIGN.md     产品、API、观测契约
backend/           FastAPI + LangGraph
frontend/          Vite + React 工作台与观测后台
examples/          可直接导入的示例资料
```
