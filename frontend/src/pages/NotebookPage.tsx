/**
 * 笔记本工作台（/notebooks/:id）——三栏：资料 | 对话 | 工作室。
 * 本组件只负责：加载笔记本 / 资料 / 笔记数据、资料轮询、问答范围（勾选资料）状态，
 * 具体交互交给三个面板组件。
 *
 * 问答范围约定：
 * - 记录“被取消勾选”的资料 id（而不是已勾选），这样新导入完成的资料默认自动纳入范围；
 * - 全部就绪资料都勾选时向后端传 source_ids = null（代表全部），否则传具体 id 数组。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Activity, ArrowLeft, Check, Pencil } from 'lucide-react'
import { api, type Note, type Notebook, type Source } from '../lib/api'
import { errMsg } from '../lib/http'
import { LogoMark } from '../components/Logo'
import { LoadingBlock } from '../components/Spinner'
import { EmptyState } from '../components/EmptyState'
import { Button } from '../components/Button'
import { useToast } from '../components/Toast'
import { SourcesPanel } from './notebook/SourcesPanel'
import { ChatPanel } from './notebook/ChatPanel'
import { StudioPanel } from './notebook/StudioPanel'

/** 问答范围（传给对话与工作室） */
export type Scope = {
  /** 当前勾选且就绪的资料 */
  selected: Source[]
  /** 全部就绪资料 */
  ready: Source[]
  /** 传给后端的 source_ids */
  sourceIds: string[] | null
}

const POLL_MS = 2000

export default function NotebookPage() {
  const { id = '' } = useParams()
  const toast = useToast()
  const navigate = useNavigate()
  const [notebook, setNotebook] = useState<Notebook | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sources, setSources] = useState<Source[] | null>(null)
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [deselected, setDeselected] = useState<Set<string>>(new Set())

  // ───── 初始加载 ─────
  useEffect(() => {
    let alive = true
    setNotebook(null)
    setLoadError(null)
    api
      .getNotebook(id)
      .then((nb) => alive && setNotebook(nb))
      .catch((e) => alive && setLoadError(errMsg(e, '笔记本加载失败')))
    api
      .listSources(id)
      .then((s) => alive && setSources(s))
      .catch((e) => alive && (setSources([]), toast.error(e, '资料加载失败')))
    api
      .listNotes(id)
      .then((n) => alive && setNotes(n))
      .catch((e) => alive && (setNotes([]), toast.error(e, '笔记加载失败')))
    return () => {
      alive = false
    }
  }, [id, toast])

  // ───── 有 processing 资料时每 2 秒轮询 ─────
  const hasProcessing = !!sources?.some((s) => s.status === 'processing')
  const prevStatus = useRef<Map<string, Source['status']>>(new Map())
  useEffect(() => {
    if (!hasProcessing) return
    const t = window.setInterval(() => {
      api
        .listSources(id)
        .then(setSources)
        .catch(() => {
          /* 轮询失败静默，下一轮继续 */
        })
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [hasProcessing, id])

  // 资料状态从 processing 变为 ready / failed 时提示用户
  useEffect(() => {
    if (!sources) return
    for (const s of sources) {
      const before = prevStatus.current.get(s.id)
      if (before === 'processing' && s.status === 'ready') toast.success(`「${s.title}」已就绪`)
      if (before === 'processing' && s.status === 'failed') toast.error(`「${s.title}」导入失败${s.error ? `：${s.error}` : ''}`)
    }
    prevStatus.current = new Map(sources.map((s) => [s.id, s.status]))
  }, [sources, toast])

  // ───── 问答范围 ─────
  const scope = useMemo<Scope>(() => {
    const ready = (sources ?? []).filter((s) => s.status === 'ready')
    const selected = ready.filter((s) => !deselected.has(s.id))
    const sourceIds = selected.length === ready.length ? null : selected.map((s) => s.id)
    return { ready, selected, sourceIds }
  }, [sources, deselected])

  const toggleSource = useCallback((sid: string, on: boolean) => {
    setDeselected((d) => {
      const n = new Set(d)
      if (on) n.delete(sid)
      else n.add(sid)
      return n
    })
  }, [])
  const toggleAll = useCallback(
    (on: boolean) => setDeselected(on ? new Set() : new Set((sources ?? []).map((s) => s.id))),
    [sources],
  )

  const addSource = useCallback((s: Source) => setSources((l) => [s, ...(l ?? []).filter((x) => x.id !== s.id)]), [])
  const removeSource = useCallback((sid: string) => setSources((l) => (l ?? []).filter((x) => x.id !== sid)), [])
  const addNote = useCallback((n: Note) => setNotes((l) => [n, ...(l ?? [])]), [])
  const removeNote = useCallback((nid: string) => setNotes((l) => (l ?? []).filter((x) => x.id !== nid)), [])

  if (loadError)
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          title="无法打开笔记本"
          description={loadError}
          action={
            <Button onClick={() => navigate('/')} icon={<ArrowLeft size={14} />}>
              返回列表
            </Button>
          }
        />
      </div>
    )

  return (
    <div className="flex h-screen flex-col bg-white">
      <Header notebook={notebook} onRenamed={setNotebook} />
      {!notebook || sources === null ? (
        <LoadingBlock className="flex-1" />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[300px] shrink-0 flex-col border-r border-line">
            <SourcesPanel
              notebookId={id}
              sources={sources}
              scope={scope}
              deselected={deselected}
              onToggle={toggleSource}
              onToggleAll={toggleAll}
              onAdded={addSource}
              onRemoved={removeSource}
            />
          </aside>
          <main className="flex min-w-0 flex-1 flex-col">
            <ChatPanel notebookId={id} sources={sources} scope={scope} onNoteCreated={addNote} />
          </main>
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-line">
            <StudioPanel notebookId={id} notes={notes} scope={scope} onCreated={addNote} onRemoved={removeNote} />
          </aside>
        </div>
      )}
    </div>
  )
}

/** 顶栏：返回、笔记本标题（可行内重命名）、观测后台入口 */
function Header({ notebook, onRenamed }: { notebook: Notebook | null; onRenamed: (nb: Notebook) => void }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const save = async () => {
    const t = value.trim()
    setEditing(false)
    if (!notebook || !t || t === notebook.title) return
    try {
      onRenamed(await api.renameNotebook(notebook.id, t))
    } catch (e) {
      toast.error(e, '重命名失败')
    }
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/"
          className="flex h-8 w-8 items-center justify-center rounded-card text-ink-450 transition-colors hover:bg-surface-hover hover:text-ink"
          aria-label="返回笔记本列表"
        >
          <ArrowLeft size={16} />
        </Link>
        <Link to="/" aria-label="首页">
          <LogoMark size={22} />
        </Link>
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={value}
              maxLength={100}
              onChange={(e) => setValue(e.target.value)}
              onBlur={save}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setEditing(false)
              }}
              className="input h-8 w-[320px] py-1 text-[15px] font-medium"
            />
            <Button size="icon-sm" variant="ghost" onMouseDown={save} aria-label="保存">
              <Check size={14} />
            </Button>
          </div>
        ) : (
          <button
            className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-surface-hover"
            onClick={() => {
              if (!notebook) return
              setValue(notebook.title)
              setEditing(true)
            }}
            title="点击重命名"
          >
            <span className="truncate text-[15px] font-semibold text-ink">{notebook?.title ?? '加载中…'}</span>
            <Pencil size={12} className="shrink-0 text-ink-400 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
      </div>
      <Link
        to="/admin"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-card border border-line px-3 text-[13px] font-medium text-ink-700 transition-colors hover:border-line-strong hover:text-ink"
      >
        <Activity size={14} />
        观测后台
      </Link>
    </header>
  )
}
