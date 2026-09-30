/**
 * Spinner：加载转圈。继承当前文字颜色。
 */
import { Loader2 } from 'lucide-react'
import { cn } from '../lib/cn'

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('shrink-0 animate-spin', className)} aria-label="加载中" />
}

/** 整块区域居中加载 */
export function LoadingBlock({ text = '加载中…', className }: { text?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-16 text-sm text-ink-450', className)}>
      <Spinner />
      {text}
    </div>
  )
}
