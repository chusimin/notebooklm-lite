/**
 * API 层：类型定义与所有后端接口函数。
 * 类型严格对齐 docs/DESIGN.md 第 5 节契约，字段名不得随意修改。
 * 所有请求走相对路径 /api，由 Vite 代理到 FastAPI（8765）。
 */
import { streamSSE } from './sse'
import { ApiError, readError } from './http'

// ───────────────────────── 5.1 类型 ─────────────────────────

export type Notebook = {
  id: string
  title: string
  source_count: number
  created_at: string
  updated_at: string
}

export type SourceType = 'pdf' | 'text' | 'markdown' | 'url'
export type SourceStatus = 'processing' | 'ready' | 'failed'

export type Source = {
  id: string
  notebook_id: string
  type: SourceType
  title: string
  uri: string | null
  status: SourceStatus
  error: string | null
  char_count: number
  chunk_count: number
  summary: string | null
  suggested_questions: string[]
  created_at: string
}

export type Citation = {
  /** 对应回答正文里的 [index] */
  index: number
  chunk_id: string
  source_id: string
  source_title: string
  page: number | null
  /** 片段前 200 字 */
  snippet: string
}

export type ChatMode = 'full' | 'rag'
export type FeedbackValue = -1 | 0 | 1

export type Message = {
  id: string
  notebook_id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
  run_id: string | null
  mode: ChatMode | null
  feedback: FeedbackValue
  created_at: string
}

export type Chunk = {
  id: string
  source_id: string
  source_title: string
  idx: number
  page: number | null
  text: string
}

export type NoteKind = 'manual' | 'answer' | 'briefing' | 'study_guide' | 'faq'
export type StudioKind = 'briefing' | 'study_guide' | 'faq'

export type Note = {
  id: string
  notebook_id: string
  kind: NoteKind
  title: string
  /** Markdown */
  content: string
  created_at: string
}

export type RunKind = 'chat' | 'ingest' | 'studio'
export type RunStatus = 'running' | 'success' | 'error'

export type Run = {
  id: string
  kind: RunKind
  notebook_id: string | null
  notebook_title: string | null
  status: RunStatus
  mode: ChatMode | null
  model: string | null
  /** 截断 120 字 */
  input_preview: string
  output_preview: string
  latency_ms: number | null
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  feedback: FeedbackValue
  error: string | null
  started_at: string
}

export type SpanType = 'node' | 'llm' | 'retriever' | 'embedding'

export type Span = {
  id: string
  run_id: string
  parent_id: string | null
  name: string
  type: SpanType
  status: RunStatus
  model: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any
  error: string | null
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  latency_ms: number | null
  started_at: string
  ended_at: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RunDetail = Run & { input: any; output: any; spans: Span[] }

export type Overview = {
  totals: {
    runs: number
    chat_runs: number
    ingest_runs: number
    studio_runs: number
    /** 0–1 */
    error_rate: number
    /** 仅 chat */
    avg_latency_ms: number
    p95_latency_ms: number
    prompt_tokens: number
    completion_tokens: number
    cost_usd: number
    feedback_up: number
    feedback_down: number
  }
  daily: { date: string; runs: number; errors: number; tokens: number; cost_usd: number; avg_latency_ms: number }[]
  by_node: { name: string; count: number; avg_latency_ms: number; p95_latency_ms: number; error_count: number }[]
  by_mode: { full: number; rag: number }
  by_model: { model: string; calls: number; tokens: number; cost_usd: number }[]
}

export type Health = {
  ok: boolean
  model: string
  embedding_model: string
  llm_configured: boolean
  embedding_configured: boolean
  langfuse_configured?: boolean
  langfuse_host?: string | null
}

// ───────────── RAG 流转演示（docs/RAG_FLOW_DEMO.md 第 5 节）─────────────

export type FlowKind = 'ingest' | 'chat'
/** 2 维地图坐标，范围 0–1 */
export type XY = [number, number]

export type FlowListItem = {
  run_id: string
  kind: FlowKind
  status: RunStatus
  mode: ChatMode | null
  notebook_id: string | null
  notebook_title: string | null
  started_at: string
  latency_ms: number | null
  /** 问答为问题、导入为资料标题 */
  label: string
}

export type IngestSnapshot = {
  title: string
  type: SourceType
  char_count: number
  chunk_count: number
  chunk_size: number
  chunk_overlap: number
  dim: number
  chunks: { id: string; idx: number; page: number | null; text: string; keywords: string[]; xy: XY }[]
  /** 同一笔记本里已入库的其他卡片（灰点参照），旧快照没有 */
  neighbors?: { source_title: string; xy: XY }[]
}

export type FlowChunk = { id: string; source_id: string; source_title: string; idx: number; text: string; xy: XY }

/** 问答快照：full 模式没有检索相关字段 */
export type ChatSnapshot = {
  question: string
  mode: ChatMode
  forced: boolean
  total_chars: number
  threshold: number
  sources: { id: string; title: string; char_count: number }[]
  history_count: number
  rewritten?: string
  query?: string
  query_tokens?: string[]
  query_xy?: XY | null
  candidate_count?: number
  chunks?: FlowChunk[]
  vector?: { id: string; score: number }[]
  bm25?: { id: string; score: number; matched: string[] }[]
  fused?: { id: string; score: number; vector_rank: number | null; bm25_rank: number | null }[]
  params?: { vector_top_k: number; bm25_top_k: number; rrf_k: number; top_n: number }
  contexts?: { n: number; id: string; source_title: string; idx: number; text: string }[]
  answer?: string
  raw_answer?: string
  cited?: number[]
  dropped?: number[]
}

type FlowBase = {
  run: Run
  nodes: { name: string; latency_ms: number | null; status: RunStatus }[]
  leaf_spans: Record<string, { latency_ms: number | null; tokens: number; model: string | null }>
}
export type FlowDetail = (FlowBase & { kind: 'ingest'; data: IngestSnapshot }) | (FlowBase & { kind: 'chat'; data: ChatSnapshot })

export type DemoQuestion = { question: string; lesson: string; hint: string }
export type DemoInfo = {
  title: string
  notebook: Notebook | null
  sources: Source[]
  questions: DemoQuestion[]
  chunking: { size: number; overlap: number }
}

/** 5.3 SSE step 事件 */
export type StepEvent = { node: string; status: 'start' | 'end'; label: string }

// ───────────────────────── 请求基础 ─────────────────────────

export const API_BASE = '/api'
export { ApiError, errMsg } from './http'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_BASE + path, init)
  } catch {
    throw new ApiError('网络异常，无法连接后端服务', 0)
  }
  if (!res.ok) throw await readError(res)
  return (await res.json()) as T
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

type Ok = { ok: true }

// ───────────────────────── 5.2 业务接口 ─────────────────────────

export const api = {
  health: () => request<Health>('/health'),

  // 笔记本
  listNotebooks: () => request<Notebook[]>('/notebooks'),
  getNotebook: (id: string) => request<Notebook>(`/notebooks/${id}`),
  createNotebook: (title: string) => request<Notebook>('/notebooks', json('POST', { title })),
  renameNotebook: (id: string, title: string) => request<Notebook>(`/notebooks/${id}`, json('PATCH', { title })),
  deleteNotebook: (id: string) => request<Ok>(`/notebooks/${id}`, json('DELETE')),

  // 资料
  listSources: (notebookId: string) => request<Source[]>(`/notebooks/${notebookId}/sources`),
  uploadSourceFile: (notebookId: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return request<Source>(`/notebooks/${notebookId}/sources/file`, { method: 'POST', body: fd })
  },
  addSourceUrl: (notebookId: string, url: string) =>
    request<Source>(`/notebooks/${notebookId}/sources/url`, json('POST', { url })),
  addSourceText: (notebookId: string, title: string, content: string) =>
    request<Source>(`/notebooks/${notebookId}/sources/text`, json('POST', { title, content })),
  deleteSource: (id: string) => request<Ok>(`/sources/${id}`, json('DELETE')),
  getChunk: (id: string) => request<Chunk>(`/chunks/${id}`),

  // 对话
  listMessages: (notebookId: string) => request<Message[]>(`/notebooks/${notebookId}/messages`),
  clearMessages: (notebookId: string) => request<Ok>(`/notebooks/${notebookId}/messages`, json('DELETE')),
  setFeedback: (messageId: string, value: FeedbackValue) =>
    request<Message>(`/messages/${messageId}/feedback`, json('POST', { value })),

  // 笔记 / 工作室
  listNotes: (notebookId: string) => request<Note[]>(`/notebooks/${notebookId}/notes`),
  createNote: (notebookId: string, body: { kind: NoteKind; title: string; content: string }) =>
    request<Note>(`/notebooks/${notebookId}/notes`, json('POST', body)),
  deleteNote: (id: string) => request<Ok>(`/notes/${id}`, json('DELETE')),
  generateStudio: (notebookId: string, kind: StudioKind, source_ids: string[] | null) =>
    request<Note>(`/notebooks/${notebookId}/studio`, json('POST', { kind, source_ids })),

  // 观测后台
  adminOverview: (days: number) => request<Overview>(`/admin/overview?days=${days}`),
  adminRuns: (q: { kind?: RunKind | ''; status?: RunStatus | ''; limit: number; offset: number }) => {
    const p = new URLSearchParams({ kind: q.kind || '', status: q.status || '', limit: String(q.limit), offset: String(q.offset) })
    return request<{ items: Run[]; total: number }>(`/admin/runs?${p.toString()}`)
  },
  adminRun: (id: string) => request<RunDetail>(`/admin/runs/${id}`),

  // RAG 流转演示
  adminFlows: (kind: FlowKind) => request<FlowListItem[]>(`/admin/flows?kind=${kind}`),
  adminFlow: (runId: string) => request<FlowDetail>(`/admin/flows/${runId}`),
  demoInfo: () => request<DemoInfo>('/admin/demo'),
  demoSetup: () => request<DemoInfo>('/admin/demo/setup', json('POST')),
}

// ───────────────────────── 5.3 问答 SSE ─────────────────────────

export type ChatHandlers = {
  onUserMessage?: (m: Message) => void
  onStep?: (s: StepEvent) => void
  onToken?: (text: string) => void
  onDone?: (m: Message) => void
  onError?: (message: string) => void
}

/**
 * 发起流式问答。返回 Promise 在流结束时 resolve。
 * 网络/HTTP 错误与 SSE error 事件统一走 onError。
 */
export async function streamChat(
  notebookId: string,
  /** force_rag：资料少也强制走检索（演示用） */
  body: { question: string; source_ids: string[] | null; force_rag?: boolean },
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let finished = false
  try {
    await streamSSE(`${API_BASE}/notebooks/${notebookId}/chat`, {
      body,
      signal,
      onEvent: (event, data) => {
        switch (event) {
          case 'user_message':
            handlers.onUserMessage?.(data as Message)
            break
          case 'step':
            handlers.onStep?.(data as StepEvent)
            break
          case 'token':
            handlers.onToken?.((data as { text: string }).text ?? '')
            break
          case 'done':
            finished = true
            handlers.onDone?.(data as Message)
            break
          case 'error':
            finished = true
            handlers.onError?.((data as { message?: string })?.message || '生成失败')
            break
        }
      },
    })
    if (!finished && !signal?.aborted) handlers.onError?.('连接意外中断，回答未完成')
  } catch (e) {
    if (signal?.aborted) return
    handlers.onError?.(e instanceof Error ? e.message : '生成失败')
  }
}
