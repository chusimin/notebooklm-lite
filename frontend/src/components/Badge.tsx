/**
 * Badge：小标签，用于状态 / 类型 / 模式。
 * tone：neutral（灰描边）/ solid（柔黑实底）/ soft（浅灰底）/ success / danger / warning
 * 彩色仅用于状态反馈，符合“无彩色强调”的规范。
 */
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

type Tone = 'neutral' | 'solid' | 'soft' | 'success' | 'danger' | 'warning'

const TONE: Record<Tone, string> = {
  neutral: 'border border-line text-ink-600 bg-white',
  solid: 'border border-ink bg-ink text-white',
  soft: 'border border-transparent bg-surface-active text-ink-700',
  success: 'border border-transparent bg-ok-soft text-ok',
  danger: 'border border-transparent bg-danger-soft text-danger',
  warning: 'border border-transparent bg-amber-50 text-amber-700',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11px] font-medium leading-none',
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
