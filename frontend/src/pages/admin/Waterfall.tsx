/**
 * Waterfall：调用链路瀑布图
 * - 横轴：相对 run 开始时间；每个 span 按 started_at 偏移、耗时为长度画横条
 * - 纵向：按 parent_id 构建树，深度缩进，可折叠子节点
 * - type 用不同灰度 + 图标区分：node（柔黑）/ llm（深灰）/ retriever（中灰）/ embedding（浅灰）
 */
import { useMemo, useState } from 'react'
import { Binary, Bot, ChevronRight, Search, Workflow } from 'lucide-react'
import type { RunDetail, Span, SpanType } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtMs } from '../../lib/format'
import { SPAN_TYPE_LABEL } from '../../lib/labels'

export const SPAN_STYLE: Record<SpanType, { bar: string; icon: typeof Workflow }> = {
  node: { bar: 'bg-ink', icon: Workflow },
  llm: { bar: 'bg-[#5C5C5C]', icon: Bot },
  retriever: { bar: 'bg-[#9E9E9E]', icon: Search },
  embedding: { bar: 'bg-[#CFCFCF]', icon: Binary },
}

type Row = { span: Span; depth: number; start: number; dur: number; hasChildren: boolean }

const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)

/** 计算 span 耗时：优先 latency_ms，其次 ended_at - started_at，运行中则到当前时刻 */
function spanDuration(s: Span, now: number): number {
  if (s.latency_ms != null) return s.latency_ms
  const e = ms(s.ended_at)
  return (isNaN(e) ? now : e) - ms(s.started_at)
}

export function Waterfall({ run, selectedId, onSelect }: { run: RunDetail; selectedId: string | null; onSelect: (s: Span) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const { rows, total } = useMemo(() => {
    const now = Date.now()
    const spans = run.spans
    const ids = new Set(spans.map((s) => s.id))
    const t0 = Math.min(ms(run.started_at), ...spans.map((s) => ms(s.started_at)).filter((v) => !isNaN(v)))
    // 时间轴总长：run 耗时与所有 span 结束时间取最大
    let end = t0 + (run.latency_ms ?? 0)
    for (const s of spans) end = Math.max(end, ms(s.started_at) + spanDuration(s, now))
    const total = Math.max(end - t0, 1)

    const children = new Map<string | null, Span[]>()
    for (const s of spans) {
      const p = s.parent_id && ids.has(s.parent_id) ? s.parent_id : null
      if (!children.has(p)) children.set(p, [])
      children.get(p)!.push(s)
    }
    for (const list of children.values()) list.sort((a, b) => ms(a.started_at) - ms(b.started_at))

    const rows: Row[] = []
    const visit = (parent: string | null, depth: number) => {
      for (const s of children.get(parent) ?? []) {
        const kids = children.get(s.id) ?? []
        rows.push({ span: s, depth, start: ms(s.started_at) - t0, dur: spanDuration(s, now), hasChildren: kids.length > 0 })
        if (!collapsed.has(s.id)) visit(s.id, depth + 1)
      }
    }
    visit(null, 0)
    return { rows, total }
  }, [run, collapsed])

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  if (run.spans.length === 0) return <div className="py-10 text-center text-sm text-ink-450">该调用没有记录 span</div>

  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="text-[12.5px]">
      {/* 图例 + 时间刻度 */}
      <div className="flex items-end border-b border-line-divider pb-2">
        <div className="flex w-[260px] shrink-0 flex-wrap gap-x-3 gap-y-1 pr-3 text-[11px] text-ink-450">
          {(Object.keys(SPAN_STYLE) as SpanType[]).map((t) => (
            <span key={t} className="flex items-center gap-1">
              <span className={cn('h-2 w-2 rounded-[2px]', SPAN_STYLE[t].bar)} />
              {SPAN_TYPE_LABEL[t]}
            </span>
          ))}
        </div>
        <div className="relative h-4 flex-1 text-[10.5px] tabular-nums text-ink-450">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute bottom-0"
              style={{ left: `${t * 100}%`, transform: t === 0 ? 'none' : t === 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}
            >
              {fmtMs(total * t)}
            </span>
          ))}
        </div>
        <div className="w-[64px] shrink-0" />
      </div>

      <div className="relative">
        {/* 背景刻度线 */}
        <div className="pointer-events-none absolute inset-y-0 left-[260px] right-[64px]">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-y-0 w-px bg-line-divider" style={{ left: `${t * 100}%` }} />
          ))}
        </div>

        {rows.map(({ span: s, depth, start, dur, hasChildren }) => {
          const st = SPAN_STYLE[s.type] ?? SPAN_STYLE.node
          const Icon = st.icon
          const left = (start / total) * 100
          const width = Math.max((dur / total) * 100, 0.4)
          const selected = s.id === selectedId
          return (
            <div
              key={s.id}
              onClick={() => onSelect(s)}
              className={cn(
                'relative flex h-8 cursor-pointer items-center rounded-[5px] transition-colors',
                selected ? 'bg-surface-active' : 'hover:bg-surface-hover',
              )}
            >
              <div className="flex w-[260px] shrink-0 items-center gap-1 pr-3" style={{ paddingLeft: depth * 14 + 4 }}>
                {hasChildren ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      toggle(s.id)
                    }}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-450 hover:text-ink"
                    aria-label="折叠/展开"
                  >
                    <ChevronRight size={12} className={cn('transition-transform', !collapsed.has(s.id) && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <Icon size={13} className={cn('shrink-0', s.type === 'node' ? 'text-ink' : 'text-ink-450')} />
                <span className={cn('truncate', s.type === 'node' ? 'font-medium text-ink' : 'text-ink-700')} title={s.name}>
                  {s.name}
                </span>
                {s.status === 'error' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" title="出错" />}
              </div>
              <div className="relative h-full flex-1">
                <div
                  className={cn(
                    'absolute top-1/2 h-3 -translate-y-1/2 rounded-[3px]',
                    st.bar,
                    s.status === 'error' && 'ring-1 ring-danger ring-offset-1',
                    s.status === 'running' && 'animate-pulse',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
              <div
                className={cn('w-[64px] shrink-0 pr-2 text-right tabular-nums', s.status === 'error' ? 'text-danger' : 'text-ink-600')}
              >
                {s.status === 'running' && s.latency_ms == null ? '进行中' : fmtMs(dur)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
