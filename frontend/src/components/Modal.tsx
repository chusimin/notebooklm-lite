/**
 * Modal：居中对话框。
 * - 通过 Portal 渲染到 body，Esc / 点击遮罩关闭（dismissable=false 时禁用，用于提交中）
 * - 打开时锁定页面滚动
 * - 视觉：白底 + 描边，遮罩为浅灰半透明，不用漂浮阴影
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../lib/cn'

export function useEscClose(open: boolean, onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!open || !enabled) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, enabled])
}

export function useBodyLock(open: boolean) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 480,
  dismissable = true,
  bodyClassName,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  width?: number
  dismissable?: boolean
  bodyClassName?: string
}) {
  useEscClose(open, onClose, dismissable)
  useBodyLock(open)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-black/20 backdrop-blur-[1px]"
        onClick={() => dismissable && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[88vh] w-full animate-pop-in flex-col overflow-hidden rounded-panel border border-line bg-white"
        style={{ maxWidth: width }}
      >
        {(title || dismissable) && (
          <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
            <div className="min-w-0">
              {title && <div className="text-[15px] font-semibold text-ink">{title}</div>}
              {description && <div className="mt-0.5 text-xs text-ink-450">{description}</div>}
            </div>
            {dismissable && (
              <button
                onClick={onClose}
                className="-mr-1 rounded-md p-1 text-ink-450 transition-colors hover:bg-surface-hover hover:text-ink"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className={cn('thin-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-5', bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line-divider px-5 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
