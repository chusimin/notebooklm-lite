/**
 * CitationMarkdown：带引用角标的 Markdown 渲染。
 * - 通过 remark 插件把正文中的 [n]（及 [1,2] / [1][2]）转换为特殊链接 #cite-n，
 *   再在 a 组件里渲染为圆角编号角标。代码块 / 行内代码不受影响（它们不是 text 节点）。
 * - 悬停角标：浮层展示 citation 的 source_title + snippet
 * - 点击角标：回调 onOpen(citation)，由上层打开原文抽屉
 * - 流式生成中 citations 尚未返回时，角标仍显示编号，但不可交互
 */
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText } from 'lucide-react'
import type { Components } from 'react-markdown'
import type { Citation } from '../lib/api'
import { Markdown } from './Markdown'
import { cn } from '../lib/cn'

// ───────── remark 插件：text 节点中的 [n] → link(#cite-n) ─────────

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }

const CITE_RE = /\[(\d{1,3}(?:\s*[,，、]\s*\d{1,3})*)\]/g

function splitText(value: string): MdNode[] | null {
  CITE_RE.lastIndex = 0
  if (!CITE_RE.test(value)) return null
  CITE_RE.lastIndex = 0
  const out: MdNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = CITE_RE.exec(value))) {
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) })
    for (const n of m[1].split(/[,，、]/).map((s) => s.trim())) {
      out.push({ type: 'link', url: `#cite-${n}`, children: [{ type: 'text', value: n }] })
    }
    last = m.index + m[0].length
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function walk(node: MdNode) {
  if (!node.children) return
  // 已是链接的内部不再处理，避免嵌套链接
  if (node.type === 'link' || node.type === 'linkReference') return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && child.value) {
      const parts = splitText(child.value)
      if (parts) {
        next.push(...parts)
        continue
      }
    }
    walk(child)
    next.push(child)
  }
  node.children = next
}

function remarkCitations() {
  return (tree: MdNode) => walk(tree)
}

// ───────── 角标组件 ─────────

function CitationBadge({
  index,
  citation,
  onOpen,
}: {
  index: number
  citation?: Citation
  onOpen?: (c: Citation) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; above: boolean } | null>(null)

  const show = () => {
    if (!citation || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const above = r.top > 220
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170), y: above ? r.top - 6 : r.bottom + 6, above })
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        onClick={() => citation && onOpen?.(citation)}
        disabled={!citation}
        className={cn(
          'mx-[1px] inline-flex h-[17px] min-w-[17px] -translate-y-[1px] items-center justify-center rounded-[5px] px-1 align-middle text-[10.5px] font-semibold leading-none transition-colors',
          citation
            ? 'cursor-pointer bg-surface-active text-ink-700 hover:bg-ink hover:text-white'
            : 'cursor-default bg-surface-hover text-ink-450',
        )}
        aria-label={`引用 ${index}`}
      >
        {index}
      </button>
      {pos &&
        citation &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[70] w-[320px] animate-fade-in rounded-card border border-line bg-white p-3 text-left"
            style={{
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? '-100%' : '0'})`,
            }}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
              <FileText size={12} className="shrink-0 text-ink-450" />
              <span className="truncate">{citation.source_title}</span>
              {citation.page != null && <span className="shrink-0 text-ink-450">· 第 {citation.page} 页</span>}
            </div>
            <div className="mt-1.5 line-clamp-6 text-xs leading-5 text-ink-600">{citation.snippet}</div>
            <div className="mt-2 text-[11px] text-ink-450">点击查看完整原文</div>
          </div>,
          document.body,
        )}
    </>
  )
}

export function CitationMarkdown({
  content,
  citations,
  onOpenCitation,
  className,
  streaming,
}: {
  content: string
  citations: Citation[]
  onOpenCitation?: (c: Citation) => void
  className?: string
  /** 流式输出中：追加打字光标 */
  streaming?: boolean
}) {
  const byIndex = new Map(citations.map((c) => [c.index, c]))
  const components: Components = {
    a: ({ href, children }) => {
      if (href?.startsWith('#cite-')) {
        const n = Number(href.slice(6))
        return <CitationBadge index={n} citation={byIndex.get(n)} onOpen={onOpenCitation} />
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className="underline decoration-ink-400 underline-offset-2">
          {children}
        </a>
      )
    },
  }
  return (
    <Markdown
      className={cn(streaming && '[&>*:last-child]:typing-caret', className)}
      components={components}
      remarkPlugins={[remarkCitations]}
    >
      {content}
    </Markdown>
  )
}
