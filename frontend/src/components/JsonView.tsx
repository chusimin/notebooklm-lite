/**
 * JsonView：可折叠的 JSON 树查看器（观测后台用）。
 * - 对象 / 数组可逐层展开，默认展开到 defaultDepth 层
 * - 长字符串默认截断，点击展开全文
 * - 右上角可复制整体 JSON
 */
import { useState } from 'react'
import { ChevronRight, Copy } from 'lucide-react'
import { cn } from '../lib/cn'
import { useToast } from './Toast'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

function Primitive({ value }: { value: Json }) {
  const [full, setFull] = useState(false)
  if (value === null) return <span className="text-ink-400">null</span>
  if (value === undefined) return <span className="text-ink-400">undefined</span>
  if (typeof value === 'number') return <span className="font-semibold text-ink">{value}</span>
  if (typeof value === 'boolean') return <span className="italic text-ink">{String(value)}</span>
  const s = String(value)
  const long = s.length > 240
  return (
    <span className="whitespace-pre-wrap break-words text-ink-900">
      "{long && !full ? s.slice(0, 240) : s}"
      {long && (
        <button onClick={() => setFull(!full)} className="ml-1 text-[11px] text-ink-450 underline hover:text-ink">
          {full ? '收起' : `展开（${s.length} 字）`}
        </button>
      )}
    </span>
  )
}

function Node({ name, value, depth, defaultDepth }: { name?: string; value: Json; depth: number; defaultDepth: number }) {
  const isObj = value !== null && typeof value === 'object'
  const [open, setOpen] = useState(depth < defaultDepth)
  const label = name !== undefined && <span className="text-ink-600">{name}: </span>

  if (!isObj)
    return (
      <div className="py-[1px] pl-4">
        {label}
        <Primitive value={value} />
      </div>
    )

  const entries: [string, Json][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)
  const brackets = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return (
    <div className="py-[1px]">
      <button onClick={() => setOpen(!open)} className="flex items-center text-left hover:bg-surface-hover">
        <ChevronRight size={12} className={cn('mr-1 shrink-0 text-ink-450 transition-transform', open && 'rotate-90')} />
        {label}
        <span className="text-ink-450">
          {brackets[0]}
          {!open && <span className="px-1">{Array.isArray(value) ? `${entries.length} 项` : `${entries.length} 个字段`}</span>}
          {!open && brackets[1]}
        </span>
      </button>
      {open && (
        <div className="ml-[5px] border-l border-line-divider pl-2">
          {entries.length === 0 && <div className="pl-4 text-ink-400">空</div>}
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} defaultDepth={defaultDepth} />
          ))}
        </div>
      )}
      {open && <div className="pl-4 text-ink-450">{brackets[1]}</div>}
    </div>
  )
}

export function JsonView({ value, defaultDepth = 2, className }: { value: Json; defaultDepth?: number; className?: string }) {
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
      toast.success('已复制')
    } catch {
      toast.error('复制失败')
    }
  }
  return (
    <div className={cn('group relative rounded-card border border-line bg-surface-soft p-3 font-mono text-[12px] leading-5', className)}>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded p-1 text-ink-450 opacity-0 transition-opacity hover:bg-surface-hover hover:text-ink group-hover:opacity-100"
        aria-label="复制 JSON"
      >
        <Copy size={12} />
      </button>
      {value === null || typeof value !== 'object' ? (
        <div className="pl-0">
          <Primitive value={value} />
        </div>
      ) : (
        <div className="-ml-0">
          <Node value={value} depth={0} defaultDepth={defaultDepth} />
        </div>
      )}
    </div>
  )
}
