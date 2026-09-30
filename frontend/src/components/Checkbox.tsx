/**
 * Checkbox：自绘复选框，支持半选（indeterminate，用于“全选”）。
 */
import { Check, Minus } from 'lucide-react'
import { cn } from '../lib/cn'

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  const on = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        on ? 'border-ink bg-ink text-white' : 'border-line-strong bg-white hover:border-ink-450',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} /> : checked ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  )
}
