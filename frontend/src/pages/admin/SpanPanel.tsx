/**
 * SpanPanel：选中 span 的详情面板
 * - 头部：名称、类型、状态、模型、耗时、token、成本、错误
 * - 输入 / 输出按 span 类型智能展示：
 *   · llm：messages 按 role 分块（system / user / assistant），输出为文本
 *   · retriever：查询语句 + 命中片段列表（来源、分数、预览）
 *   · 其他：可折叠 JSON
 * - 任意类型都可切换查看“原始 JSON”
 */
import { useState, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import type { Span } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtCost, fmtDateTime, fmtMs, fmtNum } from '../../lib/format'
import { SPAN_TYPE_LABEL } from '../../lib/labels'
import { JsonView } from '../../components/JsonView'
import { Segmented } from '../../components/Segmented'
import { StatusBadge } from './RunBadges'
import { SPAN_STYLE } from './Waterfall'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export function SpanPanel({ span }: { span: Span }) {
  const st = SPAN_STYLE[span.type] ?? SPAN_STYLE.node
  const Icon = st.icon
  const tokens = span.prompt_tokens + span.completion_tokens
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Icon size={15} className="shrink-0 text-ink" />
          <span className="truncate font-mono text-[13.5px] font-semibold text-ink">{span.name}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={span.status} />
          <span className="inline-flex h-5 items-center rounded-[5px] border border-line px-1.5 text-[11px] text-ink-600">
            {SPAN_TYPE_LABEL[span.type] ?? span.type}
          </span>
          {span.model && (
            <span className="inline-flex h-5 items-center rounded-[5px] bg-surface-active px-1.5 font-mono text-[11px] text-ink-700">
              {span.model}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line text-center">
        <Stat label="耗时" value={fmtMs(span.latency_ms)} />
        <Stat label="Token" value={tokens ? fmtNum(tokens) : '—'} sub={tokens ? `${fmtNum(span.prompt_tokens)} / ${fmtNum(span.completion_tokens)}` : undefined} />
        <Stat label="成本" value={span.cost_usd ? fmtCost(span.cost_usd) : '—'} />
      </div>
      <div className="text-[11px] tabular-nums text-ink-450">
        开始 {fmtDateTime(span.started_at, true)} · 结束 {span.ended_at ? fmtDateTime(span.ended_at, true) : '—'}
      </div>

      {span.error && (
        <div className="flex gap-2 rounded-card border border-danger/20 bg-danger-soft p-3 text-[12.5px] leading-5 text-danger">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <pre className="whitespace-pre-wrap break-words font-sans">{span.error}</pre>
        </div>
      )}

      <IOSection title="输入" value={span.input} smart={renderInput(span)} />
      <IOSection title="输出" value={span.output} smart={renderOutput(span)} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white px-2 py-2">
      <div className="text-[11px] text-ink-450">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[10.5px] tabular-nums text-ink-450">{sub}</div>}
    </div>
  )
}

/** 输入/输出区块：智能视图 与 原始 JSON 可切换 */
function IOSection({ title, value, smart }: { title: string; value: Any; smart: ReactNode | null }) {
  const [view, setView] = useState<'smart' | 'raw'>('smart')
  const empty = value === null || value === undefined || (typeof value === 'object' && Object.keys(value).length === 0)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-ink">{title}</div>
        {smart && !empty && (
          <Segmented
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'smart', label: '格式化' },
              { value: 'raw', label: 'JSON' },
            ]}
          />
        )}
      </div>
      {empty ? (
        <div className="rounded-card border border-dashed border-line px-3 py-3 text-xs text-ink-450">无</div>
      ) : smart && view === 'smart' ? (
        smart
      ) : (
        <JsonView value={value} />
      )}
    </section>
  )
}

// ───────── 智能渲染：兼容多种常见结构，识别失败则回退 JSON ─────────

/** 从 llm span 输入中提取 messages */
function extractMessages(input: Any): { role: string; content: string }[] | null {
  const list = Array.isArray(input) ? input : Array.isArray(input?.messages) ? input.messages : null
  if (!list || !list.length) return null
  // 兼容嵌套一层（LangChain 批量输入 [[...]]）
  const flat = Array.isArray(list[0]) ? list.flat() : list
  if (!flat.every((m: Any) => m && typeof m === 'object' && ('content' in m || 'role' in m || 'type' in m))) return null
  return flat.map((m: Any) => ({
    role: String(m.role ?? m.type ?? 'unknown'),
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2),
  }))
}

const ROLE_LABEL: Record<string, string> = { system: 'System', user: 'User', human: 'User', assistant: 'Assistant', ai: 'Assistant', tool: 'Tool' }

function MessagesView({ messages }: { messages: { role: string; content: string }[] }) {
  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <RoleBlock key={i} role={m.role} content={m.content} />
      ))}
    </div>
  )
}

function RoleBlock({ role, content }: { role: string; content: string }) {
  const [open, setOpen] = useState(content.length < 1200)
  const r = role.toLowerCase()
  return (
    <div className={cn('overflow-hidden rounded-card border', r === 'system' ? 'border-line bg-surface-soft' : 'border-line bg-white')}>
      <div className="flex items-center justify-between border-b border-line-divider px-3 py-1.5">
        <span
          className={cn(
            'rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide',
            r === 'assistant' || r === 'ai' ? 'bg-ink text-white' : r === 'system' ? 'bg-surface-active text-ink-700' : 'border border-line text-ink-700',
          )}
        >
          {ROLE_LABEL[r] ?? role}
        </span>
        <span className="text-[10.5px] tabular-nums text-ink-450">{content.length.toLocaleString()} 字</span>
      </div>
      <pre className={cn('whitespace-pre-wrap break-words px-3 py-2 font-sans text-[12.5px] leading-5 text-ink-900', !open && 'max-h-40 overflow-hidden')}>
        {content}
      </pre>
      {!open && (
        <button onClick={() => setOpen(true)} className="w-full border-t border-line-divider py-1 text-[11px] text-ink-450 hover:bg-surface-hover hover:text-ink">
          展开全文
        </button>
      )}
    </div>
  )
}

/** 从输出中提取文本（字符串 / {text} / {content} / {output}） */
function extractText(out: Any): string | null {
  if (typeof out === 'string') return out
  if (out && typeof out === 'object') {
    for (const k of ['text', 'content', 'output', 'answer']) if (typeof out[k] === 'string') return out[k]
  }
  return null
}

/** 已知命中列表字段的中文名与展示顺序（fused 为 RRF 融合后的最终结果，放在最前） */
const HIT_GROUP_LABEL: Record<string, string> = {
  fused: 'RRF 融合结果',
  hits: '命中结果',
  results: '命中结果',
  vector_hits: '向量检索',
  bm25_hits: 'BM25 关键词',
}

/** 从 retriever 输出中提取命中列表分组：数组直接视为一组；对象则收集所有“元素为对象的数组”字段 */
function extractHitGroups(out: Any): { key: string; label: string; hits: Any[] }[] | null {
  const isHitList = (v: Any) => Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null
  if (isHitList(out)) return [{ key: 'hits', label: '命中结果', hits: out }]
  if (!out || typeof out !== 'object') return null
  const keys = Object.keys(out).filter((k) => isHitList(out[k]))
  if (!keys.length) return null
  const order = Object.keys(HIT_GROUP_LABEL)
  keys.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
  return keys.map((k) => ({ key: k, label: HIT_GROUP_LABEL[k] ?? k, hits: out[k] }))
}

function HitGroupsView({ groups }: { groups: { key: string; label: string; hits: Any[] }[] }) {
  const [active, setActive] = useState(groups[0].key)
  const cur = groups.find((g) => g.key === active) ?? groups[0]
  return (
    <div>
      {groups.length > 1 && (
        <Segmented
          size="sm"
          className="mb-2"
          value={cur.key}
          onChange={setActive}
          options={groups.map((g) => ({ value: g.key, label: `${g.label} ${g.hits.length}` }))}
        />
      )}
      <HitsView hits={cur.hits} />
    </div>
  )
}

function HitsView({ hits }: { hits: Any[] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-ink-450">共 {hits.length} 个片段</div>
      {hits.map((h, i) => {
        const title = h.source_title ?? h.source ?? h.title ?? h.source_id ?? '未知来源'
        const text = h.preview ?? h.text ?? h.snippet ?? h.content ?? ''
        const score = h.score ?? h.rrf_score ?? h.similarity
        return (
          <div key={h.id ?? h.chunk_id ?? i} className="rounded-card border border-line px-3 py-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-surface-active px-1 text-[10px] font-semibold text-ink-700">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-ink" title={String(title)}>
                {String(title)}
                {h.page != null && <span className="ml-1 font-normal text-ink-450">p.{h.page}</span>}
              </span>
              {typeof score === 'number' && <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-600">{score.toFixed(4)}</span>}
            </div>
            {text && <div className="mt-1 line-clamp-3 text-[12px] leading-5 text-ink-600">{String(text)}</div>}
            {(h.id ?? h.chunk_id) && <div className="mt-1 truncate font-mono text-[10.5px] text-ink-400">{h.id ?? h.chunk_id}</div>}
          </div>
        )
      })}
    </div>
  )
}

function renderInput(span: Span): ReactNode | null {
  const input = span.input
  if (span.type === 'llm') {
    const msgs = extractMessages(input)
    if (msgs) return <MessagesView messages={msgs} />
  }
  if (span.type === 'retriever') {
    const q = typeof input === 'string' ? input : (input?.query ?? input?.question)
    if (typeof q === 'string')
      return (
        <div className="rounded-card border border-line bg-surface-soft px-3 py-2">
          <div className="text-[11px] text-ink-450">查询语句</div>
          <div className="mt-0.5 text-[13px] text-ink-900">{q}</div>
        </div>
      )
  }
  return null
}

function renderOutput(span: Span): ReactNode | null {
  const out = span.output
  if (span.type === 'retriever') {
    const groups = extractHitGroups(out)
    if (groups) return <HitGroupsView groups={groups} />
  }
  if (span.type === 'llm') {
    const text = extractText(out)
    if (text != null) return <RoleBlock role="assistant" content={text} />
  }
  return null
}
