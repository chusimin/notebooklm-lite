/**
 * 笔记本列表页（/）
 * 场景：用户进入产品的第一站——找到已有笔记本继续工作，或新建一个开始整理资料。
 * 功能：卡片网格（标题、资料数、更新时间）、新建、重命名、删除（二次确认）。
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Activity, BookOpen, Files, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { api, type Notebook } from '../lib/api'
import { errMsg } from '../lib/http'
import { fmtRelative } from '../lib/format'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState } from '../components/EmptyState'
import { Menu } from '../components/Menu'
import { Logo } from '../components/Logo'
import { useToast } from '../components/Toast'

export default function NotebooksPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [list, setList] = useState<Notebook[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Notebook | null>(null)
  const [deleting, setDeleting] = useState<Notebook | null>(null)

  const load = () => {
    setError(null)
    api
      .listNotebooks()
      .then(setList)
      .catch((e) => setError(errMsg(e, '笔记本加载失败')))
  }
  useEffect(load, [])

  return (
    <div className="min-h-full bg-white">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <Link
            to="/admin"
            className="inline-flex h-8 items-center gap-1.5 rounded-card border border-line px-3 text-[13px] font-medium text-ink-700 transition-colors hover:border-line-strong hover:text-ink"
          >
            <Activity size={14} />
            观测后台
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20 pt-12">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight text-ink">我的笔记本</h1>
            <p className="mt-1.5 text-sm text-ink-600">把 PDF、网页和文本变成可对话、可溯源的知识笔记本。</p>
          </div>
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
            新建笔记本
          </Button>
        </div>

        {error && (
          <div className="flex items-center justify-between rounded-panel border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
            <span>{error}</span>
            <Button size="sm" icon={<RefreshCw size={12} />} onClick={load}>
              重试
            </Button>
          </div>
        )}

        {!error && list === null && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[148px] animate-pulse rounded-panel border border-line bg-surface-soft" />
            ))}
          </div>
        )}

        {list && list.length === 0 && (
          <div className="rounded-panel border border-dashed border-line-strong">
            <EmptyState
              icon={<BookOpen size={18} />}
              title="还没有笔记本"
              description="新建一个笔记本，添加资料后即可开始带引用的问答。"
              action={
                <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                  新建笔记本
                </Button>
              }
            />
          </div>
        )}

        {list && list.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <button
              onClick={() => setCreating(true)}
              className="group flex h-[148px] flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line-strong text-ink-450 transition-colors hover:border-ink hover:text-ink"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-current">
                <Plus size={16} />
              </span>
              <span className="text-[13px] font-medium">新建笔记本</span>
            </button>
            {list.map((nb) => (
              <Link
                key={nb.id}
                to={`/notebooks/${nb.id}`}
                className="group relative flex h-[148px] flex-col justify-between rounded-panel border border-line bg-white p-5 transition-colors hover:border-line-strong hover:bg-surface-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-card border border-line bg-white text-ink">
                    <BookOpen size={15} />
                  </div>
                  <Menu
                    className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                    items={[
                      { label: '重命名', icon: <Pencil size={13} />, onClick: () => setRenaming(nb) },
                      { label: '删除', icon: <Trash2 size={13} />, danger: true, onClick: () => setDeleting(nb) },
                    ]}
                  />
                </div>
                <div>
                  <div className="line-clamp-2 text-[15px] font-medium leading-6 text-ink">{nb.title}</div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-450">
                    <Files size={12} />
                    <span>{nb.source_count} 个资料</span>
                    <span className="text-ink-400">·</span>
                    <span title={nb.updated_at}>{fmtRelative(nb.updated_at)}更新</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      <TitleModal
        open={creating}
        title="新建笔记本"
        confirmText="创建"
        initial=""
        onClose={() => setCreating(false)}
        onSubmit={async (title) => {
          const nb = await api.createNotebook(title)
          toast.success('笔记本已创建')
          navigate(`/notebooks/${nb.id}`)
        }}
      />
      <TitleModal
        open={!!renaming}
        title="重命名笔记本"
        confirmText="保存"
        initial={renaming?.title ?? ''}
        onClose={() => setRenaming(null)}
        onSubmit={async (title) => {
          const nb = await api.renameNotebook(renaming!.id, title)
          setList((l) => l && l.map((x) => (x.id === nb.id ? nb : x)))
          toast.success('已重命名')
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除笔记本？"
        description={
          <>
            将永久删除「<span className="font-medium text-ink">{deleting?.title}</span>」及其全部资料、对话与笔记，此操作不可撤销。
          </>
        }
        onConfirm={async () => {
          await api.deleteNotebook(deleting!.id)
          setList((l) => l && l.filter((x) => x.id !== deleting!.id))
          toast.success('笔记本已删除')
        }}
      />
    </div>
  )
}

/** 标题输入弹窗：新建 / 重命名共用 */
function TitleModal({
  open,
  title,
  confirmText,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean
  title: string
  confirmText: string
  initial: string
  onClose: () => void
  onSubmit: (title: string) => Promise<void>
}) {
  const toast = useToast()
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setValue(initial)
  }, [open, initial])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = value.trim()
    if (!t) return
    setBusy(true)
    try {
      await onSubmit(t)
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width={420} dismissable={!busy}>
      <form onSubmit={submit}>
        <input
          autoFocus
          className="input"
          placeholder="例如：产品经理面试准备"
          maxLength={100}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!value.trim()}>
            {confirmText}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
