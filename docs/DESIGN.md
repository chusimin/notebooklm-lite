# NotebookLM Lite 设计文档

> 个人版 NotebookLM 示例：基于自己的资料进行带引用问答，并附带一个可观测后台。

## 1. 产品定义（MVP）

| 问题 | 回答 |
| --- | --- |
| 目标是什么 | 把个人资料（PDF / 网页 / 文本）变成可对话、可追溯来源的知识笔记本 |
| 为什么 | 通用 AI 聊天会编造、没有引用；个人资料分散，难以快速复习和提炼 |
| 给谁用 | 单个用户（学习者、研究者、产品经理），本机运行，无登录 |
| 怎么用 | 建笔记本 → 添加资料 → 带引用问答 → 一键生成简报/学习指南/FAQ → 存为笔记；在观测后台查看每次调用的链路、耗时、token 与成本 |

### MVP 范围

- 包含：笔记本管理；资料导入（PDF、TXT/Markdown、网页链接、粘贴文本）；资料概要与推荐问题；带引用的流式问答（点击角标查看原文）；勾选资料限定问答范围；回答存为笔记；工作室生成简报 / 学习指南 / FAQ；回答点赞/点踩；观测后台（总览、节点耗时、调用列表、单次调用瀑布图与详情）。
- 不包含（后续迭代）：音频播客、视频/音频资料、思维导图、多用户、云部署。

## 1.5 界面与体验

### 布局
- **产品首页**：卡片网格列出笔记本；顶栏右侧进入观测后台。
- **工作台**（桌面）：三栏 `资料 300px | 对话自适应 | 工作室 340px`。资料栏勾选范围，对话栏流式回答，工作室生成简报/学习指南/FAQ 并保存笔记。
- **工作台**（窄屏）：顶部分段切换「资料 / 对话 / 工作室」，默认落在对话。
- **观测后台**：左侧 220px 导航（总览 / 调用记录）+ 右侧内容；调用详情为瀑布图 + 节点输入输出。

### 体验路径
1. 新建笔记本 → 添加 PDF / 文本 / 网页。
2. 资料变为就绪后，看到概要与推荐问题。
3. 提问 → 流式回答 → 点击 `[1]` 打开原文抽屉。
4. 把回答存为笔记，或在工作室一键生成简报。
5. 打开观测后台，看到这次调用的节点耗时、token、成本；点进详情看瀑布图。

失败重试：同一问题失败后再次发送，**复用已写入的用户消息**，不在库里堆重复提问。

### 视觉
对标 Google NotebookLM 的工作台气质：纯白底、柔黑文字、系统字体、细描边、少装饰。这是长时间对着资料工作的界面，不是杂志封面，因此不用奶油色 bento。

观测后台同一套黑白灰 token，用图表和瀑布图表达密度，不用彩色仪表盘。

### 观测（自建 LangSmith-lite）
每次 ingest / chat / studio 写一条 `run`，节点、LLM、检索、向量化写 `span`。不依赖 LangSmith 账号即可看链路；可选打开 `LANGSMITH_TRACING` 同步到云端。

## 2. 技术架构

```text
前端  Vite + React + TS + Tailwind（端口 5173，/api 代理到 8765）
      ├─ /                  笔记本列表
      ├─ /notebooks/:id     三栏：资料 | 对话 | 工作室
      └─ /admin             观测后台（总览 / 调用列表 / 调用详情）
后端  FastAPI（端口 8765）
      ├─ api/               REST + SSE
      ├─ graphs/            LangGraph：ingest_graph / chat_graph / studio_graph
      ├─ rag/               加载器、切分、向量化、混合检索
      ├─ llm/               模型工厂（OpenAI 兼容接口，默认 OpenRouter）、提示词
      ├─ observability/     自建追踪：runs / spans 写入 SQLite
      └─ db.py              SQLite（业务数据 + 向量 + 追踪）
```

### 关键选型

- **模型**：OpenAI 兼容接口（`langchain-openai` 的 `ChatOpenAI`），默认 OpenRouter 的 `deepseek/deepseek-v3.2`（主回答）+ `qwen/qwen3-next-80b-a3b-instruct`（改写、概要等轻量任务），可通过 `.env` 切换任意兼容模型。选型依据是实测首字延迟：deepseek-chat 约 7.7s，deepseek-v3.2 约 2s，qwen3-next 约 1s。
- **向量化**：`openai/text-embedding-3-small`（经 OpenRouter）。
- **向量存储**：SQLite 存 float32 向量 + numpy 余弦相似度。个人规模（< 10 万片段）足够，零运维。
- **关键词检索**：jieba 分词 + BM25，与向量检索用 RRF 融合。
- **观测**：自建（`runs` / `spans` 表 + LangChain 回调），无需外部账号；可选打开 `LANGSMITH_TRACING=true` 同步到 LangSmith。

## 3. 核心流程（LangGraph）

### 3.1 ingest_graph：资料导入（后台任务）

`load → split → embed → summarize → save`

- load：PDF 按页提取（pypdf，保留页码）；网页用 trafilatura 提取正文；文本直接读取。
- split：`RecursiveCharacterTextSplitter`，chunk 约 800 字、重叠 120，中文标点优先分割；每个片段保留 `source_id / idx / page`。
- embed：批量向量化（每批 64）。
- summarize：快模型生成资料概要（150 字内）与 3 个推荐问题（JSON 输出）。
- 状态：`processing → ready / failed`，前端轮询。

### 3.2 chat_graph：带引用问答（核心）

`choose_mode → rewrite_query → retrieve → generate → finalize`

- **双模式**（`choose_mode`）：所选资料总字数 ≤ `FULL_CONTEXT_MAX_CHARS`（默认 40000）时走 **full 模式**，按原顺序把全部片段放入上下文；否则走 **rag 模式**。
- rewrite_query（仅 rag 模式且有历史时）：结合最近 6 条对话把追问改写为独立问题。
- retrieve（仅 rag 模式）：向量 top20 + BM25 top20 → RRF 融合 → top 8。
- generate：上下文片段编号为 `[1] [2] …`，要求模型只依据资料回答，每个事实句后标注编号；资料中没有时明确说明。流式输出 token。
- finalize：解析回答中的 `[n]`，丢弃越界编号，映射为 citations，写入 messages 表。

### 3.3 studio_graph：内容生成

`collect → (map_summarize，并行) → write → save`

- 资料总量小：直接全文生成；总量大：用 `Send` 按资料并行生成要点，再汇总。
- kind：`briefing`（简报）、`study_guide`（学习指南）、`faq`（常见问题），输出 Markdown，保存为笔记。

## 4. 数据模型（SQLite：`backend/data/app.db`）

- `notebooks(id, title, created_at, updated_at)`
- `sources(id, notebook_id, type, title, uri, status, error, char_count, chunk_count, summary, suggested_questions_json, created_at)`
- `chunks(id, source_id, notebook_id, idx, page, text, embedding BLOB)`
- `messages(id, notebook_id, role, content, citations_json, run_id, mode, feedback, created_at)`
- `notes(id, notebook_id, kind, title, content, created_at)`
- `runs(id, kind, notebook_id, status, mode, model, input_json, output_json, error, prompt_tokens, completion_tokens, cost_usd, latency_ms, feedback, started_at, ended_at)`
- `spans(id, run_id, parent_id, name, type, status, model, input_json, output_json, error, prompt_tokens, completion_tokens, cost_usd, latency_ms, started_at, ended_at)`

id 使用 uuid4 hex 字符串；时间为 UTC ISO 8601 字符串（带毫秒，如 `2026-09-30T08:00:00.123Z`）。

## 5. API 契约（前后端共同遵守）

所有接口前缀 `/api`，JSON，错误返回 `{"detail": "中文错误信息"}` + 4xx/5xx。

### 5.1 类型

```ts
type Notebook = { id: string; title: string; source_count: number; created_at: string; updated_at: string }

type Source = {
  id: string; notebook_id: string
  type: "pdf" | "text" | "markdown" | "url"
  title: string; uri: string | null
  status: "processing" | "ready" | "failed"; error: string | null
  char_count: number; chunk_count: number
  summary: string | null; suggested_questions: string[]
  created_at: string
}

type Citation = {
  index: number          // 对应回答正文里的 [index]
  chunk_id: string; source_id: string; source_title: string
  page: number | null; snippet: string   // snippet 为片段前 200 字
}

type Message = {
  id: string; notebook_id: string; role: "user" | "assistant"
  content: string; citations: Citation[]
  run_id: string | null; mode: "full" | "rag" | null
  feedback: -1 | 0 | 1; created_at: string
}

type Chunk = { id: string; source_id: string; source_title: string; idx: number; page: number | null; text: string }

type Note = {
  id: string; notebook_id: string
  kind: "manual" | "answer" | "briefing" | "study_guide" | "faq"
  title: string; content: string   // Markdown
  created_at: string
}

type Run = {
  id: string; kind: "chat" | "ingest" | "studio"
  notebook_id: string | null; notebook_title: string | null
  status: "running" | "success" | "error"; mode: "full" | "rag" | null
  model: string | null
  input_preview: string; output_preview: string   // 各截断 120 字
  latency_ms: number | null; prompt_tokens: number; completion_tokens: number; cost_usd: number
  feedback: -1 | 0 | 1; error: string | null; started_at: string
}

type Span = {
  id: string; run_id: string; parent_id: string | null
  name: string; type: "node" | "llm" | "retriever" | "embedding"
  status: "running" | "success" | "error"; model: string | null
  input: any; output: any; error: string | null
  prompt_tokens: number; completion_tokens: number; cost_usd: number
  latency_ms: number | null; started_at: string; ended_at: string | null
}
```

### 5.2 业务接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notebooks` | `Notebook[]`，按 updated_at 倒序 |
| POST | `/notebooks` | body `{title}` → `Notebook` |
| PATCH | `/notebooks/{id}` | body `{title}` → `Notebook` |
| DELETE | `/notebooks/{id}` | 级联删除 → `{ok:true}` |
| GET | `/notebooks/{id}` | `Notebook` |
| GET | `/notebooks/{id}/sources` | `Source[]` |
| POST | `/notebooks/{id}/sources/file` | multipart `file`（.pdf .txt .md，≤ 20MB）→ `Source`（status=processing） |
| POST | `/notebooks/{id}/sources/url` | body `{url}` → `Source` |
| POST | `/notebooks/{id}/sources/text` | body `{title, content}` → `Source` |
| DELETE | `/sources/{id}` | `{ok:true}` |
| GET | `/chunks/{id}` | `Chunk` |
| GET | `/notebooks/{id}/messages` | `Message[]`，按时间正序 |
| DELETE | `/notebooks/{id}/messages` | 清空对话 → `{ok:true}` |
| POST | `/notebooks/{id}/chat` | body `{question, source_ids: string[] \| null}` → SSE（见 5.3） |
| POST | `/messages/{id}/feedback` | body `{value: -1\|0\|1}` → `Message`（同步写入 runs.feedback） |
| GET | `/notebooks/{id}/notes` | `Note[]`，按时间倒序 |
| POST | `/notebooks/{id}/notes` | body `{kind, title, content}` → `Note` |
| DELETE | `/notes/{id}` | `{ok:true}` |
| POST | `/notebooks/{id}/studio` | body `{kind: "briefing"\|"study_guide"\|"faq", source_ids: string[] \| null}` → `Note`（同步，可能 10–60 秒） |
| GET | `/health` | `{ok:true, model, embedding_model, llm_configured, embedding_configured}` |

### 5.3 问答 SSE 事件

响应 `Content-Type: text/event-stream`，每个事件为 `event: <name>\ndata: <json>\n\n`：

| event | data | 说明 |
| --- | --- | --- |
| `user_message` | `Message` | 已保存的用户消息 |
| `step` | `{node, status: "start"\|"end", label}` | 节点进度，label 为中文（如“正在检索资料”） |
| `token` | `{text}` | 回答增量文本 |
| `done` | `Message` | 最终助手消息（含 citations） |
| `error` | `{message}` | 出错，流结束 |

### 5.4 观测后台接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/admin/overview?days=7` | 见下方结构 |
| GET | `/admin/runs?kind=&status=&limit=50&offset=0` | `{items: Run[], total: number}`，按 started_at 倒序 |
| GET | `/admin/runs/{id}` | `Run & {input: any, output: any, spans: Span[]}`，spans 按 started_at 正序 |

```ts
type Overview = {
  totals: {
    runs: number; chat_runs: number; ingest_runs: number; studio_runs: number
    error_rate: number            // 0–1
    avg_latency_ms: number; p95_latency_ms: number   // 仅 chat
    prompt_tokens: number; completion_tokens: number; cost_usd: number
    feedback_up: number; feedback_down: number
  }
  daily: { date: string; runs: number; errors: number; tokens: number; cost_usd: number; avg_latency_ms: number }[]  // 连续日期，含 0 值
  by_node: { name: string; count: number; avg_latency_ms: number; p95_latency_ms: number; error_count: number }[]
  by_mode: { full: number; rag: number }
  by_model: { model: string; calls: number; tokens: number; cost_usd: number }[]
}
```

## 6. 观测方案

- 每次 chat / ingest / studio 调用生成一条 `run`；图中每个节点生成 `node` span；每次 LLM 调用、检索、向量化分别生成 `llm` / `retriever` / `embedding` span，挂在所属节点下。
- LLM span 记录：模型、完整 messages 输入、输出文本、token 用量、估算成本（按 `.env` 中的单价配置）。
- retriever span 记录：查询语句、命中片段（id、来源、分数、前 100 字）。
- 实现：`contextvars` 维护当前 run / span；节点函数用 `@traced_node` 装饰器；LLM 调用通过 LangChain `AsyncCallbackHandler` 采集。
- 用户反馈（点赞/点踩）回写到 run，后台可按反馈追溯差评回答的完整链路。

## 7. 质量要求

- 后端：pytest 覆盖切分、检索融合、引用解析、追踪写入、主要 API（LLM 用假模型替身）。
- 前端：`npm run build` 通过（TypeScript 无错误）。
- 端到端：真实模型下完成“建笔记本 → 上传资料 → 问答带引用 → 生成简报 → 后台看到链路”。
