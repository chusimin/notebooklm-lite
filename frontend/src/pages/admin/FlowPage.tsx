/**
 * 观测后台 · RAG 演示（/admin/flow?run=<run_id>）
 *
 * 给讲课 / 演示用：跟着寻回犬小金，回放一次真实的导入或问答，看资料怎么存进去、问题怎么找到答案。
 * - 顶部：一键导入「喵记咖啡」演示资料 + 预设问题 + 强制检索开关（默认开，资料少也走检索）
 * - 中部：tab 切换两条流；下拉选择要回放的调用（任何笔记本的调用都能回放）
 * - 主体：左舞台 + 右讲解面板；进入页面或问完问题自动播放
 * 只回放真实发生过的调用，保证演示的就是系统真实做的。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Dog as DogIcon, ExternalLink, Sparkles } from 'lucide-react'
import {
  api,
  streamChat,
  type DemoInfo,
  type FlowDetail,
  type FlowKind,
  type FlowListItem,
} from '../../lib/api'
import { errMsg } from '../../lib/http'
import { fmtRelative } from '../../lib/format'
import { cn } from '../../lib/cn'
import { Button } from '../../components/Button'
import { Segmented } from '../../components/Segmented'
import { LoadingBlock, Spinner } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { AdminHeader, Card } from './AdminLayout'
import { usePlayer } from './flow/usePlayer'
import { NarrationPanel } from './flow/NarrationPanel'
import { buildChatSteps, ChatFlowView } from './flow/ChatFlow'
import { buildIngestSteps, IngestFlowView } from './flow/IngestFlow'

export default function FlowPage() {
  const [params, setParams] = useSearchParams()
  const runId = params.get('run')
  const [tab, setTab] = useState<FlowKind>('chat')
  const [flows, setFlows] = useState<FlowListItem[] | null>(null)
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  const selectRun = useCallback((id: string) => setParams({ run: id }, { replace: true }), [setParams])

  const loadFlows = useCallback((kind: FlowKind) => api.adminFlows(kind).then(setFlows).catch(() => setFlows([])), [])

  useEffect(() => {
    setFlows(null)
    loadFlows(tab)
  }, [tab, loadFlows])

  // 没有指定 run 时默认回放当前 tab 的最近一次
  useEffect(() => {
    if (!runId && flows && flows.length) selectRun(flows[0].run_id)
  }, [runId, flows, selectRun])

  useEffect(() => {
    if (!runId) {
      setDetail(null)
      return
    }
    let alive = true
    setDetailError(null)
    api
      .adminFlow(runId)
      .then((d) => {
        if (!alive) return
        setDetail(d)
        setTab(d.kind) // 从调用详情页跳过来时自动切到对应 tab
      })
      .catch((e) => alive && (setDetail(null), setDetailError(errMsg(e, '回放数据加载失败'))))
    return () => {
      alive = false
    }
  }, [runId])

  const switchTab = (k: FlowKind) => {
    if (k === tab) return
    setTab(k)
    setDetail(null)
    setParams({}, { replace: true })
  }

  const onAsked = (id: string) => {
    if (tab !== 'chat') setTab('chat')
    loadFlows('chat')
    selectRun(id)
  }

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-8">
      <AdminHeader
        title="RAG 演示"
        desc="跟着寻回犬小金，看资料是怎么被存进去的、问题是怎么找到答案的。每一帧都来自一次真实调用。"
      />
      <DemoCard onAsked={onAsked} onImported={() => tab === 'ingest' && loadFlows('ingest')} />

      <div className="mb-4 mt-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'chat', label: '问题怎么流转' },
            { value: 'ingest', label: '资料怎么流转' },
          ]}
        />
        <select
          className="input h-8 w-auto max-w-[420px] py-0 text-[13px]"
          value={runId ?? ''}
          onChange={(e) => selectRun(e.target.value)}
          disabled={!flows?.length}
          aria-label="选择要回放的调用"
        >
          {!flows?.length && <option value="">暂无可回放的调用</option>}
          {runId && flows && !flows.some((f) => f.run_id === runId) && <option value={runId}>当前调用</option>}
          {flows?.map((f) => (
            <option key={f.run_id} value={f.run_id}>
              {f.label || '（无标题）'} · {f.kind === 'chat' ? (f.mode === 'rag' ? '检索' : '全文') : f.notebook_title} · {fmtRelative(f.started_at)}
            </option>
          ))}
        </select>
        {runId && (
          <Link to={`/admin/runs/${runId}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-600 hover:text-ink">
            <ExternalLink size={12} /> 看技术细节
          </Link>
        )}
      </div>

      {detailError ? (
        <Card>
          <EmptyState icon={<DogIcon size={18} />} title="这次调用没法回放" description={detailError} />
        </Card>
      ) : !runId && flows && !flows.length ? (
        <Card>
          <EmptyState
            icon={<DogIcon size={18} />}
            title={tab === 'chat' ? '还没有可回放的问答' : '还没有可回放的导入'}
            description="先在上面导入演示资料，再点一个预设问题，小金就会出发。"
          />
        </Card>
      ) : detail && detail.run.id === runId ? (
        <FlowPlayer key={detail.run.id} detail={detail} />
      ) : (
        <LoadingBlock className="h-64" />
      )}
    </div>
  )
}

/** 舞台 + 讲解面板。key 绑定 run_id，换调用时整体重置并自动播放 */
function FlowPlayer({ detail }: { detail: FlowDetail }) {
  const steps = useMemo(() => (detail.kind === 'chat' ? buildChatSteps(detail) : buildIngestSteps(detail)), [detail])
  const player = usePlayer(steps, detail.run.id)
  const step = steps[player.index]
  if (!step) return null
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {detail.kind === 'chat' ? (
          <ChatFlowView detail={detail} step={step} t={player.t} clock={player.clock} />
        ) : (
          <IngestFlowView detail={detail} step={step} t={player.t} clock={player.clock} />
        )}
      </div>
      <NarrationPanel steps={steps} index={player.index} t={player.t} playing={player.playing} onGoto={player.goto} onToggle={player.toggle} />
    </div>
  )
}

/** 演示资料 + 预设问题。资料导入中每秒刷新一次状态 */
function DemoCard({ onAsked, onImported }: { onAsked: (runId: string) => void; onImported: () => void }) {
  const [info, setInfo] = useState<DemoInfo | null>(null)
  const [setting, setSetting] = useState(false)
  const [force, setForce] = useState(true)
  const [custom, setCustom] = useState('')
  const [asking, setAsking] = useState<{ question: string; label: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const processing = info?.sources.some((s) => s.status === 'processing') ?? false
  const ready = info?.sources.filter((s) => s.status === 'ready').length ?? 0
  const failed = info?.sources.filter((s) => s.status === 'failed').length ?? 0

  useEffect(() => {
    api.demoInfo().then(setInfo).catch((e) => setError(errMsg(e, '演示信息加载失败')))
  }, [])

  useEffect(() => {
    if (!processing) return
    const timer = window.setTimeout(() => api.demoInfo().then((d) => {
      setInfo(d)
      if (!d.sources.some((s) => s.status === 'processing')) onImported()
    }), 1000)
    return () => window.clearTimeout(timer)
  }, [info, processing, onImported])

  const setup = async () => {
    setSetting(true)
    setError(null)
    try {
      setInfo(await api.demoSetup())
    } catch (e) {
      setError(errMsg(e, '导入失败'))
    } finally {
      setSetting(false)
    }
  }

  /** preset=true 时先清空演示笔记本的对话，让每个预设问题独立、不被当成追问改写 */
  const ask = async (question: string, preset = false) => {
    const nb = info?.notebook
    if (!nb || !question.trim() || asking) return
    setError(null)
    setAsking({ question, label: '小金准备出发…' })
    if (preset) await api.clearMessages(nb.id).catch(() => undefined)
    let runId: string | null = null
    await streamChat(
      nb.id,
      { question: question.trim(), source_ids: null, force_rag: force },
      {
        onStep: (s) => s.status === 'start' && setAsking({ question, label: s.label }),
        onDone: (m) => (runId = m.run_id),
        onError: (msg) => setError(msg),
      },
    )
    setAsking(null)
    if (runId) onAsked(runId)
  }

  const canAsk = !!info?.notebook && ready > 0 && !processing && !asking

  return (
    <Card
      title={
        <span className="inline-flex items-center gap-1.5">
          <Sparkles size={14} /> 演示案例：{info?.title ?? '喵记咖啡'}
        </span>
      }
      extra={
        info?.notebook ? (
          <Link to={`/notebooks/${info.notebook.id}`} className="text-[12px] text-ink-600 hover:text-ink">
            打开笔记本
          </Link>
        ) : null
      }
    >
      {!info ? (
        error ? <div className="text-[13px] text-danger">{error}</div> : <LoadingBlock className="h-16" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-600">
            {info.notebook ? (
              <span>
                {processing ? <Spinner size={12} className="mr-1.5 inline" /> : null}
                资料 {ready} / {info.sources.length} 份就绪
                {processing && '，正在导入（可以切到「资料怎么流转」看过程）'}
                {failed > 0 && <span className="text-danger">，{failed} 份失败</span>}
              </span>
            ) : (
              <span>一家虚构咖啡店的会员、售后、新品、支付等资料，故意埋了能看出两种找法差别的内容。</span>
            )}
            {(!info.notebook || failed > 0 || info.sources.length === 0) && (
              <Button variant="primary" size="sm" loading={setting} onClick={setup}>
                {info.notebook ? '补齐演示资料' : '一键导入演示资料'}
              </Button>
            )}
            <span className="text-[12px] text-ink-450">
              演示资料按每张 {info.chunking.size} 字切分（平时 800 字），卡片多一些，方便看清"挑选"
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            {info.questions.map((q) => (
              <button
                key={q.question}
                type="button"
                disabled={!canAsk}
                onClick={() => ask(q.question, true)}
                title={q.hint}
                className={cn(
                  'rounded-card border border-line p-3 text-left transition-colors',
                  canAsk ? 'hover:border-ink hover:bg-surface-soft' : 'cursor-not-allowed opacity-50',
                  asking?.question === q.question && 'border-ink',
                )}
              >
                <div className="text-[11.5px] font-medium text-ink-450">{q.lesson}</div>
                <div className="mt-0.5 text-[13.5px] font-medium text-ink">{q.question}</div>
                <div className="mt-1 line-clamp-2 text-[11.5px] leading-[18px] text-ink-450">{q.hint}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <form
              className="flex min-w-[280px] flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                ask(custom).then(() => setCustom(''))
              }}
            >
              <input className="input h-8 py-0 text-[13px]" placeholder="自己问一个（会接着上一个问题，比如问完金卡再问「那黑卡呢？」可以看到改写）" value={custom} onChange={(e) => setCustom(e.target.value)} disabled={!info.notebook} />
              <Button type="submit" size="sm" variant="secondary" disabled={!canAsk || !custom.trim()}>
                提问
              </Button>
            </form>
            <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[13px] text-ink-700" title="资料少于全文门槛时，系统默认整份交给模型、不检索。演示时打开它，才能看到检索过程">
              <input type="checkbox" className="h-3.5 w-3.5 accent-[#191919]" checked={force} onChange={(e) => setForce(e.target.checked)} />
              强制检索
              <span className="text-[12px] text-ink-450">（关掉可以看"全文模式"）</span>
            </label>
          </div>

          {asking && (
            <div className="flex items-center gap-2 text-[13px] text-ink-700">
              <Spinner size={13} /> 「{asking.question}」：{asking.label}
            </div>
          )}
          {error && <div className="text-[13px] text-danger">{error}</div>}
        </div>
      )}
    </Card>
  )
}
