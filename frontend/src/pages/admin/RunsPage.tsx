/**
 * 观测后台 · 调用记录
 * 表格：时间、类型、笔记本、状态、模式、输入预览、耗时、token、成本、反馈
 * 支持按类型 / 状态筛选、分页；筛选与页码同步到 URL（便于分享与返回时保留位置）。
 * 点击行进入 /admin/runs/:id。
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ListTree, RefreshCw } from 'lucide-react'
import { api, type Run, type RunKind, type RunStatus } from '../../lib/api'
import { errMsg } from '../../lib/http'
import { cn } from '../../lib/cn'
import { fmtCost, fmtDateTime, fmtMs, fmtNum } from '../../lib/format'
import { MODE_LABEL } from '../../lib/labels'
import { Segmented } from '../../components/Segmented'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import { AdminHeader } from './AdminLayout'
import { FeedbackIcon, KindBadge, StatusBadge } from './RunBadges'

const PAGE_SIZE = 50

export default function RunsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') ?? '') as RunKind | ''
  const status = (params.get('status') ?? '') as RunStatus | ''
  const page = Math.max(1, Number(params.get('page') ?? 1))

  const [data, setData] = useState<{ items: Run[]; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const setFilter = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    if (k !== 'page') p.delete('page')
    setParams(p, { replace: true })
  }

  const load = () => {
    setLoading(true)
    setError(null)
    api
      .adminRuns({ kind, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then(setData)
      .catch((e) => setError(errMsg(e, '调用记录加载失败')))
      .finally(() => setLoading(false))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [kind, status, page])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <div className="mx-auto max-w-[1280px] px-8 py-8">
      <AdminHeader
        title="调用记录"
        desc="每一次问答、资料导入、内容生成的完整链路"
        right={<Button size="icon" onClick={load} loading={loading} aria-label="刷新" icon={!loading && <RefreshCw size={14} />} />}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented
          size="sm"
          value={kind}
          onChange={(v) => setFilter('kind', v)}
          options={[
            { value: '', label: '全部类型' },
            { value: 'chat', label: '问答' },
            { value: 'ingest', label: '导入' },
            { value: 'studio', label: '生成' },
          ]}
        />
        <Segmented
          size="sm"
          value={status}
          onChange={(v) => setFilter('status', v)}
          options={[
            { value: '', label: '全部状态' },
            { value: 'success', label: '成功' },
            { value: 'error', label: '失败' },
            { value: 'running', label: '进行中' },
          ]}
        />
        {data && <span className="ml-auto text-xs text-ink-450">共 {fmtNum(data.total)} 条</span>}
      </div>

      {error && (
        <div className="mb-3 flex items-center justify-between rounded-panel border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
          <Button size="sm" onClick={load}>
            重试
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-panel border border-line">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead className="bg-surface-soft">
              <tr className="text-left text-[11.5px] text-ink-450">
                <th className="px-4 py-2.5 font-normal">时间</th>
                <th className="px-2 py-2.5 font-normal">类型</th>
                <th className="px-2 py-2.5 font-normal">笔记本</th>
                <th className="px-2 py-2.5 font-normal">状态</th>
                <th className="px-2 py-2.5 font-normal">模式</th>
                <th className="px-2 py-2.5 font-normal">输入</th>
                <th className="px-2 py-2.5 text-right font-normal">耗时</th>
                <th className="px-2 py-2.5 text-right font-normal">Token</th>
                <th className="px-2 py-2.5 text-right font-normal">成本</th>
                <th className="px-4 py-2.5 text-center font-normal">反馈</th>
              </tr>
            </thead>
            <tbody className={cn(loading && data && 'opacity-60')}>
              {data?.items.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => navigate(`/admin/runs/${r.id}`)}
                  className="cursor-pointer border-t border-line-divider transition-colors hover:bg-surface-soft"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-600">{fmtDateTime(r.started_at, true)}</td>
                  <td className="px-2 py-2.5">
                    <KindBadge kind={r.kind} />
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-2.5 text-ink-900" title={r.notebook_title ?? ''}>
                    {r.notebook_title ?? <span className="text-ink-400">—</span>}
                  </td>
                  <td className="px-2 py-2.5">
                    <span title={r.error ?? ''}>
                      <StatusBadge status={r.status} />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-ink-600">{r.mode ? MODE_LABEL[r.mode] : <span className="text-ink-400">—</span>}</td>
                  <td className="max-w-[320px] truncate px-2 py-2.5 text-ink-900" title={r.input_preview}>
                    {r.input_preview || <span className="text-ink-400">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink">{fmtMs(r.latency_ms)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink-600">
                    {fmtNum(r.prompt_tokens + r.completion_tokens)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-ink-600">{fmtCost(r.cost_usd)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-center">
                      <FeedbackIcon value={r.feedback} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data && !error && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-450">
            <Spinner /> 加载中…
          </div>
        )}
        {data && data.items.length === 0 && (
          <EmptyState
            icon={<ListTree size={18} />}
            title={kind || status ? '没有符合条件的记录' : '暂无调用记录'}
            description={kind || status ? '换个筛选条件试试。' : '在笔记本中导入资料或提问后，这里会记录每次调用。'}
          />
        )}
      </div>

      {data && data.total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-ink-600">
          <span>
            第 {page} / {totalPages} 页
          </span>
          <Button size="icon-sm" disabled={page <= 1} onClick={() => setFilter('page', String(page - 1))} aria-label="上一页">
            <ChevronLeft size={14} />
          </Button>
          <Button size="icon-sm" disabled={page >= totalPages} onClick={() => setFilter('page', String(page + 1))} aria-label="下一页">
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}
