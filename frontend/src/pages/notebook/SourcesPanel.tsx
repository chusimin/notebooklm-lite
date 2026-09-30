/**
 * 左栏「资料」面板
 * - 列表：类型图标、标题、状态（processing 转圈 / failed 错误信息）
 * - 复选框限定问答范围，顶部“全选 / 取消”
 * - 点击资料展开概要（summary）与元信息
 * - 添加资料（弹窗）/ 删除资料（二次确认）
 */
import { useState } from 'react'
import { AlertCircle, ChevronDown, ExternalLink, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { api, type Source } from '../../lib/api'
import { cn } from '../../lib/cn'
import { fmtChars } from '../../lib/format'
import { SOURCE_TYPE_LABEL } from '../../lib/labels'
import { Button } from '../../components/Button'
import { Checkbox } from '../../components/Checkbox'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { useToast } from '../../components/Toast'
import { AddSourceModal } from './AddSourceModal'
import { SourceIcon } from './SourceIcon'
import type { Scope } from '../NotebookPage'

export function SourcesPanel({
  notebookId,
  sources,
  scope,
  deselected,
  onToggle,
  onToggleAll,
  onAdded,
  onRemoved,
}: {
  notebookId: string
  sources: Source[]
  scope: Scope
  deselected: Set<string>
  onToggle: (id: string, on: boolean) => void
  onToggleAll: (on: boolean) => void
  onAdded: (s: Source) => void
  onRemoved: (id: string) => void
}) {
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Source | null>(null)

  const readyCount = scope.ready.length
  const selCount = scope.selected.length
  const allOn = readyCount > 0 && selCount === readyCount
  const someOn = selCount > 0 && selCount < readyCount

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="text-[13px] font-semibold text-ink">资料</div>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
          添加资料
        </Button>
      </div>

      {sources.length > 0 && (
        <div className="flex h-9 shrink-0 items-center justify-between border-y border-line-divider px-4 text-xs">
          <label className="flex cursor-pointer items-center gap-2 text-ink-600">
            <Checkbox
              checked={allOn}
              indeterminate={someOn}
              disabled={readyCount === 0}
              onChange={() => onToggleAll(!allOn)}
              label="全选资料"
            />
            {allOn ? '取消全选' : '全选'}
          </label>
          <span className="text-ink-450">
            已选 {selCount} / {readyCount}
          </span>
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {sources.length === 0 ? (
          <EmptyState
            compact
            icon={<FolderOpen size={18} />}
            title="还没有资料"
            description="上传 PDF / TXT / Markdown，或添加网页链接、粘贴文本。"
            action={
              <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
                添加资料
              </Button>
            }
          />
        ) : (
          <ul className="space-y-0.5">
            {sources.map((s) => (
              <SourceItem
                key={s.id}
                source={s}
                checked={s.status === 'ready' && !deselected.has(s.id)}
                expanded={expanded === s.id}
                onToggleExpand={() => setExpanded(expanded === s.id ? null : s.id)}
                onCheck={(v) => onToggle(s.id, v)}
                onDelete={() => setDeleting(s)}
              />
            ))}
          </ul>
        )}
      </div>

      <AddSourceModal open={adding} notebookId={notebookId} onClose={() => setAdding(false)} onAdded={onAdded} />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除资料？"
        description={
          <>
            将删除「<span className="font-medium text-ink">{deleting?.title}</span>」及其全部片段，历史回答中的相关引用将无法再查看原文。
          </>
        }
        onConfirm={async () => {
          await api.deleteSource(deleting!.id)
          onRemoved(deleting!.id)
          toast.success('资料已删除')
        }}
      />
    </>
  )
}

function SourceItem({
  source: s,
  checked,
  expanded,
  onToggleExpand,
  onCheck,
  onDelete,
}: {
  source: Source
  checked: boolean
  expanded: boolean
  onToggleExpand: () => void
  onCheck: (v: boolean) => void
  onDelete: () => void
}) {
  const ready = s.status === 'ready'
  return (
    <li className={cn('group rounded-card transition-colors', expanded ? 'bg-surface-soft' : 'hover:bg-surface-soft')}>
      <div className="flex cursor-pointer items-center gap-2.5 px-2 py-2" onClick={onToggleExpand}>
        <SourceIcon type={s.type} />
        <div className="min-w-0 flex-1">
          <div className={cn('truncate text-[13px] leading-5', ready ? 'text-ink-900' : 'text-ink-600')} title={s.title}>
            {s.title}
          </div>
          {s.status === 'processing' && (
            <div className="flex items-center gap-1 text-[11px] text-ink-450">
              <Spinner size={10} /> 正在解析与向量化…
            </div>
          )}
          {s.status === 'failed' && (
            <div className="flex items-center gap-1 truncate text-[11px] text-danger" title={s.error ?? ''}>
              <AlertCircle size={10} className="shrink-0" /> {s.error || '导入失败'}
            </div>
          )}
          {ready && (
            <div className="text-[11px] text-ink-450">
              {SOURCE_TYPE_LABEL[s.type]} · {fmtChars(s.char_count)}
            </div>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-450 hover:bg-surface-active hover:text-danger group-hover:flex"
          aria-label="删除资料"
          title="删除资料"
        >
          <Trash2 size={13} />
        </button>
        {s.status === 'processing' ? (
          <span className="flex h-4 w-4 items-center justify-center text-ink-450">
            <Spinner size={13} />
          </span>
        ) : (
          <Checkbox checked={checked} disabled={!ready} onChange={onCheck} label={`纳入问答：${s.title}`} />
        )}
      </div>

      {expanded && (
        <div className="animate-fade-in px-3 pb-3 pl-[46px]">
          {s.status === 'failed' && (
            <div className="mb-2 rounded-card border border-danger/20 bg-danger-soft p-2 text-xs leading-5 text-danger">
              {s.error || '导入失败，请删除后重试'}
            </div>
          )}
          {s.status === 'processing' && <div className="text-xs text-ink-450">资料处理中，完成后将生成概要。</div>}
          {ready && (
            <>
              <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-ink-450">
                <ChevronDown size={11} /> 资料概要
              </div>
              <p className="text-xs leading-5 text-ink-700">{s.summary || '暂无概要'}</p>
              <div className="mt-2 text-[11px] text-ink-450">
                {s.chunk_count} 个片段 · {fmtChars(s.char_count)}
              </div>
            </>
          )}
          {s.uri && s.type === 'url' && (
            <a
              href={s.uri}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex max-w-full items-center gap-1 text-[11px] text-ink-600 underline decoration-ink-400 underline-offset-2 hover:text-ink"
            >
              <ExternalLink size={10} className="shrink-0" />
              <span className="truncate">{s.uri}</span>
            </a>
          )}
        </div>
      )}
    </li>
  )
}
