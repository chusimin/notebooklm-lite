/**
 * EmptyState：空状态占位（图标 + 标题 + 描述 + 可选操作）。
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-16', className)}>
      {icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-panel border border-line text-ink-450">
          {icon}
        </div>
      )}
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <div className="mt-1 max-w-xs text-xs leading-5 text-ink-450">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
