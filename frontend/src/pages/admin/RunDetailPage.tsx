/**
 * 观测后台 · 调用详情（/admin/runs/:id）
 * - 头部摘要：状态、类型、模型、耗时、token、成本、反馈、错误
 * - 瀑布图（左）+ span 详情面板（右，点击瀑布图行切换）
 * - 底部：run 的完整 input / output
 * 进行中的 run 每 2 秒自动刷新，直到结束。
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Dog, ExternalLink, MousePointerClick } from 'lucide-react'
import { api, type RunDetail, type Span } from '../../lib/api'
import { errMsg } from '../../lib/http'
import { fmtCost, fmtDateTime, fmtMs, fmtNum } from '../../lib/format'
import { MODE_LABEL } from '../../lib/labels'
import { LoadingBlock } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { JsonView } from '../../components/JsonView'
import { Card } from './AdminLayout'
import { FeedbackIcon, KindBadge, StatusBadge } from './RunBadges'
import { Waterfall } from './Waterfall'
import { SpanPanel } from './SpanPanel'

export default function RunDetailPage() {
  const { id = '' } = useParams()
  const [run, setRun] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    const load = () =>
      api
        .adminRun(id)
        .then((r) => {
          if (!alive) return
          setRun(r)
          // 默认选中第一个出错的 span，否则第一个 llm span，便于直接定位问题
          setSelectedId((cur) => cur ?? (r.spans.find((s) => s.status === 'error') ?? r.spans.find((s) => s.type === 'llm') ?? r.spans[0])?.id ?? null)
          if (r.status === 'running') timer = window.setTimeout(load, 2000)
        })
        .catch((e) => alive && setError(errMsg(e, '调用详情加载失败')))
    setRun(null)
    setError(null)
    setSelectedId(null)
    load()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [id])

  const selected: Span | undefined = run?.spans.find((s) => s.id === selectedId)

  return (
    <div className="mx-auto max-w-[1400px] px-8 py-8">
      <Link to="/admin/runs" className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-ink-600 hover:text-ink">
        <ArrowLeft size={13} /> 调用记录
      </Link>

      {error && <EmptyState icon={<AlertCircle size={18} />} title="无法加载调用详情" description={error} />}
      {!run && !error && <LoadingBlock />}

      {run && (
        <div className="space-y-4">
          {/* 头部摘要 */}
          <div className="rounded-panel border border-line">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-divider px-5 py-4">
              <KindBadge kind={run.kind} />
              <StatusBadge status={run.status} />
              {run.mode && <span className="text-xs text-ink-600">{MODE_LABEL[run.mode]}</span>}
              <h1 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink" title={run.input_preview}>
                {run.input_preview || '（无输入）'}
              </h1>
              {run.kind !== 'studio' && run.status === 'success' && (
                <Link
                  to={`/admin/flow?run=${run.id}`}
                  className="inline-flex items-center gap-1 text-xs text-ink-600 hover:text-ink"
                  title="用动画回放这次调用的数据流转"
                >
                  <Dog size={12} /> 看流转演示
                </Link>
              )}
              {run.notebook_id && (
                <Link
                  to={`/notebooks/${run.notebook_id}`}
                  className="inline-flex items-center gap-1 text-xs text-ink-600 hover:text-ink"
                  title="打开笔记本"
                >
                  {run.notebook_title ?? '笔记本'} <ExternalLink size={11} />
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-3 xl:grid-cols-6">
              <Summary label="模型" value={<span className="font-mono text-[12.5px]" title={run.model ?? ''}>{run.model ?? '—'}</span>} />
              <Summary label="总耗时" value={fmtMs(run.latency_ms)} />
              <Summary label="Token" value={fmtNum(run.prompt_tokens + run.completion_tokens)} sub={`输入 ${fmtNum(run.prompt_tokens)} / 输出 ${fmtNum(run.completion_tokens)}`} />
              <Summary label="成本" value={fmtCost(run.cost_usd)} />
              <Summary label="用户反馈" value={<FeedbackIcon value={run.feedback} />} sub={run.feedback === 1 ? '好评' : run.feedback === -1 ? '差评' : '未反馈'} />
              <Summary label="开始时间" value={<span className="text-[13px]">{fmtDateTime(run.started_at, true)}</span>} sub={`${run.spans.length} 个 span`} />
            </div>
            {run.error && (
              <div className="flex gap-2 border-t border-line-divider bg-danger-soft px-5 py-3 text-[13px] text-danger">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                <pre className="whitespace-pre-wrap break-words font-sans">{run.error}</pre>
              </div>
            )}
          </div>

          {/* 瀑布图 + span 详情 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Card title="调用链路" extra={<span className="text-[11px] text-ink-450">点击行查看详情</span>}>
              <Waterfall run={run} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} />
            </Card>
            <Card title="Span 详情" className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto">
              {selected ? (
                <SpanPanel key={selected.id} span={selected} />
              ) : (
                <EmptyState compact icon={<MousePointerClick size={16} />} title="选择一个 span" description="在左侧瀑布图中点击任意一行。" />
              )}
            </Card>
          </div>

          {/* 完整输入 / 输出 */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Run 输入">
              <JsonView value={run.input ?? null} defaultDepth={3} />
            </Card>
            <Card title="Run 输出">
              <JsonView value={run.output ?? null} defaultDepth={3} />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function Summary({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white px-5 py-3">
      <div className="text-[11px] text-ink-450">{label}</div>
      <div className="mt-1 truncate text-[16px] font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-ink-450">{sub}</div>}
    </div>
  )
}
