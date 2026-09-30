/**
 * 对话消息组件
 * - UserMessage：用户提问气泡（右对齐，浅灰底）
 * - AssistantMessage：助手回答（Markdown + 引用角标）+ 引用来源列表 + 操作栏
 *   （模式标签、点赞/点踩可切换、存为笔记、复制）
 * - PendingAssistant：生成中的回答（节点进度 + 流式打字效果 + 错误重试）
 */
import { useState } from 'react'
import { AlertCircle, BookmarkPlus, Check, CheckCircle2, Copy, RotateCcw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api, type Citation, type FeedbackValue, type Message, type Note } from '../../lib/api'
import { cn } from '../../lib/cn'
import { MODE_LABEL } from '../../lib/labels'
import { CitationMarkdown } from '../../components/CitationMarkdown'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'
import { useToast } from '../../components/Toast'
import type { Pending } from './ChatPanel'

export function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[14px] rounded-br-[4px] bg-surface-active px-4 py-2.5 text-[14px] leading-6 text-ink-900">
        {message.content}
      </div>
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink">
      <Sparkles size={13} />
    </div>
  )
}

/** 引用来源去重：同一 chunk 只列一次，按编号排序 */
function uniqueCitations(list: Citation[]): Citation[] {
  const seen = new Set<string>()
  return [...list]
    .sort((a, b) => a.index - b.index)
    .filter((c) => (seen.has(c.chunk_id) ? false : (seen.add(c.chunk_id), true)))
}

/** 存为笔记时把引用来源附在正文末尾，便于脱离对话后仍可溯源 */
function toNoteContent(m: Message): string {
  const cites = uniqueCitations(m.citations)
  if (!cites.length) return m.content
  const lines = cites.map((c) => `- [${c.index}] ${c.source_title}${c.page != null ? `（第 ${c.page} 页）` : ''}`)
  return `${m.content}\n\n---\n\n**引用来源**\n\n${lines.join('\n')}`
}

export function AssistantMessage({
  message: m,
  question,
  notebookId,
  onOpenCitation,
  onUpdated,
  onNoteCreated,
}: {
  message: Message
  question: string
  notebookId: string
  onOpenCitation: (c: Citation) => void
  onUpdated: (m: Message) => void
  onNoteCreated: (n: Note) => void
}) {
  const toast = useToast()
  const [fbBusy, setFbBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const cites = uniqueCitations(m.citations)

  /** 点赞/点踩：再次点击同一按钮取消（回到 0） */
  const feedback = async (v: FeedbackValue) => {
    const next: FeedbackValue = m.feedback === v ? 0 : v
    setFbBusy(true)
    onUpdated({ ...m, feedback: next }) // 乐观更新
    try {
      onUpdated(await api.setFeedback(m.id, next))
      if (next !== 0) toast.success(next === 1 ? '感谢反馈，已记录为好评' : '已记录，可在观测后台追溯该回答链路')
    } catch (e) {
      onUpdated(m)
      toast.error(e, '反馈提交失败')
    } finally {
      setFbBusy(false)
    }
  }

  const saveNote = async () => {
    setSaving(true)
    try {
      const title = (question || m.content).replace(/\s+/g, ' ').slice(0, 40) || '问答笔记'
      onNoteCreated(await api.createNote(notebookId, { kind: 'answer', title, content: toNoteContent(m) }))
      setSaved(true)
      toast.success('已存为笔记')
    } catch (e) {
      toast.error(e, '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败，请检查浏览器剪贴板权限')
    }
  }

  const actionCls =
    'inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-ink-450 transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-40'

  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <CitationMarkdown content={m.content} citations={m.citations} onOpenCitation={onOpenCitation} />

        {cites.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {cites.map((c) => (
              <button
                key={c.chunk_id}
                onClick={() => onOpenCitation(c)}
                title={c.snippet}
                className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-line bg-white px-2 py-1 text-[11.5px] text-ink-600 transition-colors hover:border-line-strong hover:text-ink"
              >
                <span className="flex h-4 min-w-4 items-center justify-center rounded-[4px] bg-surface-active px-1 text-[10px] font-semibold text-ink-700">
                  {c.index}
                </span>
                <span className="truncate">{c.source_title}</span>
                {c.page != null && <span className="shrink-0 text-ink-450">p.{c.page}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-0.5">
          {m.mode && (
            <Badge tone="soft" className="mr-1.5" title={m.mode === 'full' ? '资料较少，全部内容放入上下文' : '资料较多，先检索相关片段再回答'}>
              {MODE_LABEL[m.mode]}
            </Badge>
          )}
          <button
            className={cn(actionCls, m.feedback === 1 && 'bg-surface-active text-ink')}
            disabled={fbBusy}
            onClick={() => feedback(1)}
            aria-label="有帮助"
            title="有帮助"
          >
            <ThumbsUp size={13} className={cn(m.feedback === 1 && 'fill-ink')} />
          </button>
          <button
            className={cn(actionCls, m.feedback === -1 && 'bg-surface-active text-ink')}
            disabled={fbBusy}
            onClick={() => feedback(-1)}
            aria-label="没帮助"
            title="没帮助"
          >
            <ThumbsDown size={13} className={cn(m.feedback === -1 && 'fill-ink')} />
          </button>
          <span className="mx-1 h-3 w-px bg-line" />
          <button className={actionCls} disabled={saving || saved} onClick={saveNote}>
            {saving ? <Spinner size={12} /> : saved ? <Check size={13} /> : <BookmarkPlus size={13} />}
            {saved ? '已存为笔记' : '存为笔记'}
          </button>
          <button className={actionCls} onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PendingAssistant({ pending, onRetry }: { pending: Pending; onRetry: () => void }) {
  const { steps, text, error } = pending
  const current = [...steps].reverse().find((s) => s.status === 'start')
  const showSteps = !text && !error

  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        {/* 节点进度：未出 token 前展开显示每一步，出 token 后收起为一行 */}
        {showSteps && (
          <div className="space-y-1.5 py-1">
            {steps.length === 0 && (
              <div className="flex items-center gap-2 text-[13px] text-ink-600">
                <Spinner size={13} /> 正在准备…
              </div>
            )}
            {steps.map((s) => (
              <div
                key={s.node}
                className={cn('flex items-center gap-2 text-[13px]', s.status === 'start' ? 'text-ink-900' : 'text-ink-450')}
              >
                {s.status === 'start' ? <Spinner size={13} /> : <CheckCircle2 size={13} className="text-ink-450" />}
                {s.label || s.node}
                {s.status === 'start' && '…'}
              </div>
            ))}
          </div>
        )}

        {text && <CitationMarkdown content={text} citations={[]} streaming={!error} />}

        {text && !error && current && current.node !== 'generate' && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-450">
            <Spinner size={11} /> {current.label}…
          </div>
        )}

        {error && (
          <div className="mt-2 flex items-center gap-3 rounded-card border border-danger/20 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            <AlertCircle size={14} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink hover:underline">
              <RotateCcw size={12} /> 重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
