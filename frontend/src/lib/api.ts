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
  body: { question: string; source_ids: string[] | null },
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
