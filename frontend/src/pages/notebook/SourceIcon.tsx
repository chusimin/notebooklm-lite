/**
 * SourceIcon：按资料类型展示图标（pdf / url / text / markdown）。
 */
import { FileText, Globe, Hash, Type } from 'lucide-react'
import type { SourceType } from '../../lib/api'
import { cn } from '../../lib/cn'

export function SourceIcon({ type, className, size = 14 }: { type: SourceType; className?: string; size?: number }) {
  const Icon = type === 'pdf' ? FileText : type === 'url' ? Globe : type === 'markdown' ? Hash : Type
  return (
    <span
      className={cn(
        'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] border border-line bg-white text-ink-700',
        className,
      )}
    >
      <Icon size={size} />
      {type === 'pdf' && (
        <span className="absolute -bottom-1 -right-1 rounded-[3px] bg-ink px-[3px] text-[7px] font-semibold leading-[11px] text-white">
          PDF
        </span>
      )}
    </span>
  )
}
