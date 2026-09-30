/**
 * 观测后台 · 总览
 * 场景：快速回答“最近用得怎么样、慢在哪、花了多少钱、回答质量如何”。
 * 模块：时间范围（1/7/30 天）→ 指标卡 → 调用/错误趋势 → token/成本趋势 → 节点耗时 → 模式占比 → 模型统计
 */
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { api, type Overview } from '../../lib/api'
import { errMsg } from '../../lib/http'
import { cn } from '../../lib/cn'
import { fmtCompact, fmtCost, fmtMs, fmtNum, fmtPct } from '../../lib/format'
import { Segmented } from '../../components/Segmented'
import { Button } from '../../components/Button'
import { LoadingBlock } from '../../components/Spinner'
import { EmptyState } from '../../components/EmptyState'
import { AdminHeader, Card } from './AdminLayout'

// 图表灰阶配色
const C = { ink: '#191919', mid: '#8C8C8C', light: '#D4D4D4', grid: '#F0F0F0', danger: '#F53F3F', axis: '#999' }

export default function OverviewPage() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = () => {
    setLoading(true)
    setError(null)
    api
      .adminOverview(days)
      .then(setData)
      .catch((e) => setError(errMsg(e, '总览加载失败')))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [days])

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-8">
      <AdminHeader
        title="总览"
        desc="问答、导入、生成三类调用的用量、性能、成本与反馈"
        right={
          <div className="flex items-center gap-2">
            <Segmented
              value={days}
              onChange={setDays}
              options={[
                { value: 1, label: '近 1 天' },
                { value: 7, label: '近 7 天' },
                { value: 30, label: '近 30 天' },
              ]}
            />
            <Button size="icon" variant="secondary" onClick={load} loading={loading} aria-label="刷新" icon={!loading && <RefreshCw size={14} />} />
          </div>
        }
      />

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-panel border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
          <Button size="sm" onClick={load}>
            重试
          </Button>
        </div>
      )}
      {!data && !error && <LoadingBlock />}
      {data && <OverviewBody data={data} />}
    </div>
  )
}

function OverviewBody({ data }: { data: Overview }) {
  const t = data.totals
  const totalTokens = t.prompt_tokens + t.completion_tokens
  const fbTotal = t.feedback_up + t.feedback_down
  const daily = data.daily.map((d) => ({ ...d, label: d.date.slice(5) }))

  return (
    <div className="space-y-4">
      {/* 指标卡 */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-3 xl:grid-cols-5">
        <Metric label="调用总数" value={fmtNum(t.runs)} sub="问答 + 导入 + 生成" />
        <Metric label="问答次数" value={fmtNum(t.chat_runs)} sub={t.runs ? `占比 ${fmtPct(t.chat_runs / t.runs, 0)}` : undefined} />
        <Metric label="导入次数" value={fmtNum(t.ingest_runs)} sub={t.runs ? `占比 ${fmtPct(t.ingest_runs / t.runs, 0)}` : undefined} />
        <Metric label="生成次数" value={fmtNum(t.studio_runs)} sub={t.runs ? `占比 ${fmtPct(t.studio_runs / t.runs, 0)}` : undefined} />
        <Metric label="错误率" value={fmtPct(t.error_rate)} sub={`约 ${Math.round(t.error_rate * t.runs)} 次失败`} alert={t.error_rate > 0.05} />
        <Metric label="问答平均耗时" value={fmtMs(t.avg_latency_ms)} sub="端到端，含检索与生成" />
        <Metric label="问答 P95 耗时" value={fmtMs(t.p95_latency_ms)} sub="95% 的问答快于此值" />
        <Metric label="总 Token" value={fmtCompact(totalTokens)} sub={`输入 ${fmtCompact(t.prompt_tokens)} / 输出 ${fmtCompact(t.completion_tokens)}`} />
        <Metric label="估算成本" value={fmtCost(t.cost_usd)} sub="按 .env 单价估算（USD）" />
        <Metric
          label="用户反馈"
          value={
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <ThumbsUp size={16} className="text-ink-450" />
                {t.feedback_up}
              </span>
              <span className="flex items-center gap-1.5">
                <ThumbsDown size={16} className="text-ink-450" />
                {t.feedback_down}
              </span>
            </span>
          }
          sub={fbTotal ? `好评率 ${fmtPct(t.feedback_up / fbTotal, 0)}` : '暂无反馈'}
        />
      </div>

      {/* 趋势图 */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="每日调用与错误">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barGap={2}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(25,25,25,0.04)' }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#666' }} />
                <Bar dataKey="runs" name="调用" fill={C.ink} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="errors" name="错误" fill={C.danger} fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="每日 token 与成本">
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 8, right: -10, left: -14, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis yAxisId="t" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCompact(v)} />
                <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 11, fill: C.axis }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCost(Number(v))} width={56} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(25,25,25,0.04)' }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#666' }} />
                <Bar yAxisId="t" dataKey="tokens" name="Token" fill={C.light} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Line yAxisId="c" dataKey="cost_usd" name="成本" stroke={C.ink} strokeWidth={1.5} dot={{ r: 2, fill: C.ink }} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="节点耗时" className="xl:col-span-2" extra={<span className="text-[11px] text-ink-450">条形长度 = 平均耗时，浅色延伸至 P95</span>}>
          <NodeTable rows={data.by_node} />
        </Card>
        <div className="space-y-4">
          <Card title="问答模式占比">
            <ModeSplit full={data.by_mode.full} rag={data.by_mode.rag} />
          </Card>
          <Card title="按模型统计">
            <ModelTable rows={data.by_model} />
          </Card>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, sub, alert }: { label: string; value: React.ReactNode; sub?: string; alert?: boolean }) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="text-xs text-ink-450">{label}</div>
      <div className={cn('mt-1.5 text-[24px] font-semibold tabular-nums tracking-tight', alert ? 'text-danger' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11.5px] text-ink-450" title={sub}>{sub}</div>}
    </div>
  )
}

/** 图表悬浮提示：白底描边，数值按字段格式化 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-xs">
      <div className="mb-1 font-medium text-ink">{label}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-6 text-ink-600">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums text-ink">{p.dataKey === 'cost_usd' ? fmtCost(p.value) : fmtNum(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function NodeTable({ rows }: { rows: Overview['by_node'] }) {
  if (!rows.length) return <EmptyState compact title="暂无节点数据" description="产生调用后这里会展示各节点耗时。" />
  const sorted = [...rows].sort((a, b) => b.avg_latency_ms - a.avg_latency_ms)
  const max = Math.max(...sorted.map((r) => r.p95_latency_ms || r.avg_latency_ms), 1)
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11.5px] text-ink-450">
          <th className="pb-2 font-normal">节点</th>
          <th className="pb-2 text-right font-normal">次数</th>
          <th className="pb-2 pl-4 text-right font-normal">平均</th>
          <th className="pb-2 pl-4 text-right font-normal">P95</th>
          <th className="pb-2 pl-4 text-right font-normal">错误</th>
          <th className="w-[34%] pb-2 pl-4 font-normal" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.name} className="border-t border-line-divider">
            <td className="py-2 font-mono text-[12px] text-ink-900">{r.name}</td>
            <td className="py-2 text-right tabular-nums text-ink-600">{fmtNum(r.count)}</td>
            <td className="py-2 pl-4 text-right tabular-nums text-ink">{fmtMs(r.avg_latency_ms)}</td>
            <td className="py-2 pl-4 text-right tabular-nums text-ink-600">{fmtMs(r.p95_latency_ms)}</td>
            <td className={cn('py-2 pl-4 text-right tabular-nums', r.error_count ? 'text-danger' : 'text-ink-400')}>{r.error_count}</td>
            <td className="py-2 pl-4">
              <div className="relative h-2 rounded-full bg-surface-muted">
                <div className="absolute inset-y-0 left-0 rounded-full bg-line-strong" style={{ width: `${((r.p95_latency_ms || r.avg_latency_ms) / max) * 100}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${(r.avg_latency_ms / max) * 100}%` }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ModeSplit({ full, rag }: { full: number; rag: number }) {
  const total = full + rag
  if (!total) return <EmptyState compact title="暂无问答" />
  const fp = full / total
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted">
        <div className="bg-ink" style={{ width: `${fp * 100}%` }} />
        <div className="bg-line-strong" style={{ width: `${(1 - fp) * 100}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-ink-450">
            <span className="h-2 w-2 rounded-[2px] bg-ink" />
            全文模式
          </div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink">
            {fmtNum(full)} <span className="text-xs font-normal text-ink-450">{fmtPct(fp, 0)}</span>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-xs text-ink-450">
            <span className="h-2 w-2 rounded-[2px] bg-line-strong" />
            检索模式
          </div>
          <div className="mt-0.5 font-semibold tabular-nums text-ink">
            {fmtNum(rag)} <span className="text-xs font-normal text-ink-450">{fmtPct(1 - fp, 0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelTable({ rows }: { rows: Overview['by_model'] }) {
  if (!rows.length) return <EmptyState compact title="暂无模型调用" />
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-[11.5px] text-ink-450">
          <th className="pb-2 font-normal">模型</th>
          <th className="pb-2 text-right font-normal">调用</th>
          <th className="pb-2 pl-3 text-right font-normal">Token</th>
          <th className="pb-2 pl-3 text-right font-normal">成本</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.model} className="border-t border-line-divider">
            <td className="max-w-[140px] truncate py-2 font-mono text-[11.5px] text-ink-900" title={r.model}>
              {r.model}
            </td>
            <td className="py-2 text-right tabular-nums text-ink-600">{fmtNum(r.calls)}</td>
            <td className="py-2 pl-3 text-right tabular-nums text-ink-600">{fmtCompact(r.tokens)}</td>
            <td className="py-2 pl-3 text-right tabular-nums text-ink">{fmtCost(r.cost_usd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
