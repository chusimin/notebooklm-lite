/**
 * Button：全站按钮。
 * variant：primary（柔黑实底，页面主 CTA）/ secondary（白底描边）/ ghost（无边框，工具按钮）/ danger（危险操作）
 * loading 时显示转圈并禁用，避免重复提交。
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'icon' | 'icon-sm'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-ink text-white hover:bg-black/85 border border-ink',
  secondary: 'bg-white text-ink-900 border border-line hover:border-line-strong hover:bg-surface-soft',
  ghost: 'bg-transparent text-ink-600 border border-transparent hover:bg-surface-hover hover:text-ink-900',
  danger: 'bg-danger text-white border border-danger hover:opacity-90',
}

const SIZE: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  icon: 'h-9 w-9 justify-center',
  'icon-sm': 'h-7 w-7 justify-center',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 select-none items-center rounded-card font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' || size === 'icon-sm' ? 12 : 14} /> : icon}
      {children}
    </button>
  )
})
