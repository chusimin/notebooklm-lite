/**
 * Segmented：分段选择器（时间范围、弹窗 tab、筛选等）。
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div className={cn('inline-flex rounded-card border border-line bg-surface-soft p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[6px] font-medium transition-colors',
            size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-3 text-[13px]',
            value === o.value ? 'border border-line bg-white text-ink' : 'border border-transparent text-ink-450 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
