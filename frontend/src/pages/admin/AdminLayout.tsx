/**
 * 观测后台布局：左侧导航（总览 / 调用记录）+ 右侧内容区。
 * 底部显示后端健康状态（模型、向量模型），便于排查“为什么没数据”。
 */
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ArrowLeft, LayoutDashboard, ListTree } from 'lucide-react'
import { api, type Health } from '../../lib/api'
import { cn } from '../../lib/cn'
import { LogoMark } from '../../components/Logo'

const NAV = [
  { to: '/admin', label: '总览', icon: LayoutDashboard, end: true },
  { to: '/admin/runs', label: '调用记录', icon: ListTree, end: false },
]

export default function AdminLayout() {
  const [health, setHealth] = useState<Health | null | 'error'>(null)
  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth('error'))
  }, [])

  return (
    <div className="flex h-screen bg-white">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-surface-soft">
        <Link to="/admin" className="flex h-14 items-center gap-2 border-b border-line px-4">
          <LogoMark size={20} />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-ink">NotebookLM Lite</div>
            <div className="text-[11px] text-ink-450">观测后台</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-8 items-center gap-2 rounded-[6px] px-2.5 text-[13px] transition-colors',
                  isActive ? 'border border-line bg-white font-medium text-ink' : 'border border-transparent text-ink-600 hover:bg-surface-hover hover:text-ink',
                )
              }
            >
              <Icon size={14} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-3 border-t border-line p-3">
          <div className="text-[11px] leading-5 text-ink-450">
            {health === null && '正在检查后端…'}
            {health === 'error' && (
              <span className="flex items-center gap-1.5 text-danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" /> 后端未连接
              </span>
            )}
            {health && health !== 'error' && (
              <>
                <span className="flex items-center gap-1.5 text-ink-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-ok" /> 后端运行中
                </span>
                {(!health.llm_configured || !health.embedding_configured) && (
                  <div className="mt-1 text-danger">未配置 API Key，导入/问答不可用</div>
                )}
                <div className="mt-1 truncate" title={health.model}>
                  模型 {health.model}
                </div>
                <div className="truncate" title={health.embedding_model}>
                  向量 {health.embedding_model}
                </div>
              </>
            )}
          </div>
          <Link to="/" className="flex items-center gap-1.5 text-[12px] text-ink-600 hover:text-ink">
            <ArrowLeft size={12} /> 返回产品
          </Link>
        </div>
      </aside>
      <main className="thin-scroll min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

/** 后台页面通用头部 */
export function AdminHeader({ title, desc, right }: { title: React.ReactNode; desc?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {desc && <div className="mt-1 text-[13px] text-ink-600">{desc}</div>}
      </div>
      {right}
    </div>
  )
}

/** 后台卡片容器 */
export function Card({ title, extra, children, className }: { title?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-panel border border-line bg-white', className)}>
      {title && (
        <div className="flex h-11 items-center justify-between border-b border-line-divider px-4">
          <div className="text-[13px] font-semibold text-ink">{title}</div>
          {extra}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}
