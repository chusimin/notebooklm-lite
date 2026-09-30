/**
 * Drawer：右侧抽屉，用于查看引用原文等“不打断主流程”的详情。
 */
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useEscClose } from './Modal'

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 440,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  width?: number
}) {
  useEscClose(open, onClose)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 animate-fade-in bg-black/10" onClick={onClose} />
      <aside
        className="absolute right-0 top-0 flex h-full w-full animate-slide-in flex-col border-l border-line bg-white"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-divider px-5 py-4">
          <div className="min-w-0">
            {title && <div className="truncate text-[15px] font-semibold text-ink">{title}</div>}
            {subtitle && <div className="mt-0.5 text-xs text-ink-450">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-ink-450 transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  )
}
