/**
 * 右栏「工作室」面板
 * - 三个生成按钮：简报 / 学习指南 / 常见问题（POST studio，同步返回 Note，可能 10–60 秒）
 *   生成范围与对话一致（左栏勾选的资料）；生成中按钮 loading，完成后自动打开阅读
 * - 笔记列表：kind 标签、标题、时间；点击阅读，悬停删除
 * - 手动新建笔记
 */
import { useEffect, useRef, useState } from 'react'
import { BookOpenCheck, FileText, HelpCircle, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { api, type Note, type NoteKind, type StudioKind } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtRelative } from '../../lib/format'
import { NOTE_KIND_LABEL, STUDIO_KIND_LABEL } from '../../lib/labels'
import { Badge } from '../../components/Badge'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { useToast } from '../../components/Toast'
import type { Scope } from '../NotebookPage'
import { NoteReader } from './NoteReader'
import { NoteEditor } from './NoteEditor'

const STUDIO: { kind: StudioKind; desc: string; icon: typeof FileText }[] = [
  { kind: 'briefing', desc: '核心观点与关键结论', icon: FileText },
  { kind: 'study_guide', desc: '知识点、术语与自测题', icon: BookOpenCheck },
  { kind: 'faq', desc: '高频问题与解答', icon: HelpCircle },
]

export function StudioPanel({
  notebookId,
  notes,
  scope,
  onCreated,
  onRemoved,
}: {
  notebookId: string
  notes: Note[] | null
  scope: Scope
  onCreated: (n: Note) => void
  onRemoved: (id: string) => void
}) {
  const toast = useToast()
  const [generating, setGenerating] = useState<Set<StudioKind>>(new Set())
  const [elapsed, setElapsed] = useState(0)
  const [reading, setReading] = useState<Note | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  // 生成计时，让用户感知进度（长耗时操作的心理预期管理）
  const busy = generating.size > 0
  useEffect(() => {
    if (!busy) return setElapsed(0)
    const start = Date.now()
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => window.clearInterval(t)
  }, [busy])

  const generate = async (kind: StudioKind) => {
    if (scope.selected.length === 0) {
      toast.error(scope.ready.length ? '请至少勾选一个资料' : '请先添加资料并等待处理完成')
      return
    }
    setGenerating((s) => new Set(s).add(kind))
    try {
      const note = await api.generateStudio(notebookId, kind, scope.sourceIds)
      if (!alive.current) return
      onCreated(note)
      setReading(note)
      toast.success(`${STUDIO_KIND_LABEL[kind]}已生成`)
    } catch (e) {
      if (alive.current) toast.error(e, `${STUDIO_KIND_LABEL[kind]}生成失败`)
    } finally {
      if (alive.current)
        setGenerating((s) => {
          const n = new Set(s)
          n.delete(kind)
          return n
        })
    }
  }

  return (
    <>
      <div className="flex h-12 shrink-0 items-center px-4">
        <div className="text-[13px] font-semibold text-ink">工作室</div>
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {/* 生成区 */}
        <div className="space-y-2">
          {STUDIO.map(({ kind, desc, icon: Icon }) => {
            const on = generating.has(kind)
            return (
              <button
                key={kind}
                disabled={on || scope.ready.length === 0}
                onClick={() => generate(kind)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-panel border border-line bg-white px-3 py-3 text-left transition-colors',
                  'hover:border-line-strong hover:bg-surface-soft disabled:cursor-not-allowed',
                  !on && scope.ready.length === 0 && 'opacity-50',
                  on && 'border-ink-400 bg-surface-soft',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-card border border-line bg-white text-ink">
                  {on ? <Spinner size={14} /> : <Icon size={15} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">{STUDIO_KIND_LABEL[kind]}</span>
                  <span className="block text-[11.5px] text-ink-450">
                    {on ? `正在生成… 已用时 ${elapsed}s，通常需 10–60 秒` : desc}
                  </span>
                </span>
              </button>
            )
          })}
          <div className="px-1 text-[11px] text-ink-450">
            {scope.ready.length === 0
              ? '资料就绪后可生成'
              : scope.sourceIds === null
                ? `基于全部 ${scope.ready.length} 个资料生成`
                : `基于已勾选的 ${scope.selected.length} 个资料生成`}
          </div>
        </div>

        {/* 笔记列表 */}
        <div className="mb-2 mt-6 flex items-center justify-between border-t border-line-divider pt-4">
          <div className="text-[13px] font-semibold text-ink">
            笔记{notes && notes.length > 0 && <span className="ml-1.5 font-normal text-ink-450">{notes.length}</span>}
          </div>
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => setEditing(true)}>
            新建笔记
          </Button>
        </div>

        {notes === null && (
          <div className="flex justify-center py-6 text-ink-450">
            <Spinner />
          </div>
        )}
        {notes && notes.length === 0 && (
          <EmptyState
            compact
            icon={<NotebookPen size={16} />}
            title="暂无笔记"
            description="生成的简报、存下的回答和手写笔记都会出现在这里。"
          />
        )}
        {notes && notes.length > 0 && (
          <ul className="space-y-1">
            {notes.map((n) => (
              <li key={n.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setReading(n)}
                  onKeyDown={(e) => e.key === 'Enter' && setReading(n)}
                  className="group flex cursor-pointer items-start gap-2 rounded-card px-2.5 py-2 transition-colors hover:bg-surface-soft"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <KindBadge kind={n.kind} />
                      <span className="text-[11px] text-ink-450">{fmtRelative(n.created_at)}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-ink-900">{n.title || '未命名笔记'}</div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(n)
                    }}
                    className="mt-0.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-450 hover:bg-surface-active hover:text-danger group-hover:flex"
                    aria-label="删除笔记"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NoteReader note={reading} onClose={() => setReading(null)} onDelete={(n) => setDeleting(n)} />
      <NoteEditor
        open={editing}
        onClose={() => setEditing(false)}
        onSubmit={async (title, content) => {
          const n = await api.createNote(notebookId, { kind: 'manual', title, content })
          onCreated(n)
          toast.success('笔记已保存')
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除笔记？"
        description={
          <>
            将删除「<span className="font-medium text-ink">{deleting?.title || '未命名笔记'}</span>」，此操作不可撤销。
          </>
        }
        onConfirm={async () => {
          await api.deleteNote(deleting!.id)
          onRemoved(deleting!.id)
          if (reading?.id === deleting!.id) setReading(null)
          toast.success('笔记已删除')
        }}
      />
    </>
  )
}

/** 笔记类型标签：生成类用实底强调，其余用描边 */
export function KindBadge({ kind }: { kind: NoteKind }) {
  const solid = kind === 'briefing' || kind === 'study_guide' || kind === 'faq'
  return <Badge tone={solid ? 'solid' : kind === 'answer' ? 'soft' : 'neutral'}>{NOTE_KIND_LABEL[kind] ?? kind}</Badge>
}
