/**
 * 中栏「对话」面板：负责消息加载、SSE 流式问答状态机、滚动跟随。
 *
 * 流式状态机（pending）：
 *   发送 → 本地乐观插入用户消息 → user_message（替换为服务端消息）
 *   → step*（节点进度） → token*（增量文本） → done（替换为最终助手消息，含 citations）
 *   任一环节出错 → error（在对话尾部展示错误与“重试”）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, Square } from 'lucide-react'
import { api, streamChat, type Citation, type Message, type Note, type Source, type StepEvent } from '../../lib/api'
import { errMsg } from '../../lib/http'
import { Button } from '../../components/Button'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { ChunkDrawer } from '../../components/ChunkDrawer'
import { LoadingBlock } from '../../components/Spinner'
import { useToast } from '../../components/Toast'
import type { Scope } from '../NotebookPage'
import { AssistantMessage, PendingAssistant, UserMessage } from './MessageItem'
import { Composer } from './Composer'
import { ChatEmpty } from './ChatEmpty'

/** 进行中的一次问答 */
export type Pending = {
  question: string
  steps: StepEvent[]
  text: string
  error: string | null
}

export function ChatPanel({
  notebookId,
  sources,
  scope,
  onNoteCreated,
}: {
  notebookId: string
  sources: Source[]
  scope: Scope
  onNoteCreated: (n: Note) => void
}) {
  const toast = useToast()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [citation, setCitation] = useState<Citation | null>(null)
  const [clearing, setClearing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const streaming = !!pending && !pending.error

  // ───── 加载历史消息 ─────
  useEffect(() => {
    let alive = true
    setMessages(null)
    setLoadError(null)
    api
      .listMessages(notebookId)
      .then((m) => alive && setMessages(m))
      .catch((e) => alive && setLoadError(errMsg(e, '对话加载失败')))
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [notebookId])

  // ───── 滚动跟随：用户停留在底部附近时自动滚到底 ─────
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 空状态（资料概要 + 推荐问题）从顶部开始阅读，不跟随到底部
    if (!messages?.length && !pending) el.scrollTop = 0
    else if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  // ───── 发送问题 ─────
  const send = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q || streaming) return
      if (scope.selected.length === 0) {
        toast.error(scope.ready.length ? '请至少勾选一个资料' : '请先添加资料并等待处理完成')
        return
      }
      stickRef.current = true
      const tempId = `local-${Date.now()}`
      const optimistic: Message = {
        id: tempId,
        notebook_id: notebookId,
        role: 'user',
        content: q,
        citations: [],
        run_id: null,
        mode: null,
        feedback: 0,
        created_at: new Date().toISOString(),
      }
      // 若上一次失败，清掉失败的本地提问，避免重复
      setMessages((l) => [...(l ?? []).filter((m) => !m.id.startsWith('local-')), optimistic])
      setPending({ question: q, steps: [], text: '', error: null })

      const ac = new AbortController()
      abortRef.current = ac
      await streamChat(
        notebookId,
        { question: q, source_ids: scope.sourceIds },
        {
          onUserMessage: (m) => setMessages((l) => (l ?? []).map((x) => (x.id === tempId ? m : x))),
          onStep: (s) =>
            setPending((p) => {
              if (!p) return p
              const i = p.steps.findIndex((x) => x.node === s.node)
              const steps = i >= 0 ? p.steps.map((x, j) => (j === i ? { ...x, ...s, label: s.label || x.label } : x)) : [...p.steps, s]
              return { ...p, steps }
            }),
          onToken: (t) => setPending((p) => (p ? { ...p, text: p.text + t } : p)),
          onDone: (m) => {
            setMessages((l) => [...(l ?? []), m])
            setPending(null)
          },
          onError: (msg) => setPending((p) => (p ? { ...p, error: msg } : { question: q, steps: [], text: '', error: msg })),
        },
        ac.signal,
      )
      abortRef.current = null
    },
    [notebookId, scope, streaming, toast],
  )

  /** 停止生成：中断流，保留已生成的部分作为提示 */
  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setPending((p) => (p ? { ...p, error: '已停止生成' } : p))
  }

  /** 重试：重新发送上一次失败的问题 */
  const retry = () => {
    if (!pending) return
    const q = pending.question
    // 移除尾部失败的那条提问，重新发送后会由新的 user_message 补回
    setMessages((l) => {
      const list = l ?? []
      const last = list[list.length - 1]
      return last && last.role === 'user' && last.content === q ? list.slice(0, -1) : list
    })
    setPending(null)
    send(q)
  }

  const replaceMessage = (m: Message) => setMessages((l) => (l ?? []).map((x) => (x.id === m.id ? m : x)))

  const hasMessages = (messages?.length ?? 0) > 0 || !!pending

  return (
    <>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-divider px-5">
        <div className="text-[13px] font-semibold text-ink">对话</div>
        <div className="flex items-center gap-1">
          {streaming && (
            <Button size="sm" variant="ghost" icon={<Square size={11} />} onClick={stop}>
              停止
            </Button>
          )}
          {(messages?.length ?? 0) > 0 && (
            <Button size="sm" variant="ghost" icon={<Eraser size={13} />} disabled={streaming} onClick={() => setClearing(true)}>
              清空对话
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 py-6">
          {loadError && (
            <div className="rounded-card border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">{loadError}</div>
          )}
          {!loadError && messages === null && <LoadingBlock />}
          {messages && !hasMessages && <ChatEmpty sources={sources} scope={scope} onAsk={send} />}
          {messages && hasMessages && (
            <div className="space-y-6">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <UserMessage key={m.id} message={m} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    question={findQuestion(messages, i)}
                    notebookId={notebookId}
                    onOpenCitation={setCitation}
                    onUpdated={replaceMessage}
                    onNoteCreated={onNoteCreated}
                  />
                ),
              )}
              {pending && <PendingAssistant pending={pending} onRetry={retry} />}
            </div>
          )}
        </div>
      </div>

      <Composer disabled={streaming} scope={scope} onSend={send} />

      <ChunkDrawer citation={citation} onClose={() => setCitation(null)} />
      <ConfirmDialog
        open={clearing}
        onClose={() => setClearing(false)}
        title="清空对话？"
        description="将删除本笔记本的全部对话记录（已保存的笔记不受影响）。"
        confirmText="清空"
        onConfirm={async () => {
          await api.clearMessages(notebookId)
          setMessages([])
          setPending(null)
          toast.success('对话已清空')
        }}
      />
    </>
  )
}

/** 找到助手消息对应的上一条用户提问，用于“存为笔记”的标题 */
function findQuestion(list: Message[], i: number): string {
  for (let j = i - 1; j >= 0; j--) if (list[j].role === 'user') return list[j].content
  return ''
}
