/**
 * Menu：更多操作下拉菜单（重命名 / 删除等）。点击外部或 Esc 关闭。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '../lib/cn'

export type MenuItem = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }

export function Menu({ items, className, align = 'right' }: { items: MenuItem[]; className?: string; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn('relative', className)} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="更多操作"
        onClick={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md text-ink-450 transition-colors hover:bg-surface-hover hover:text-ink',
          open && 'bg-surface-hover text-ink',
        )}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div
          className={cn(
            'absolute top-8 z-30 min-w-[132px] animate-pop-in rounded-card border border-line bg-white p-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                setOpen(false)
                it.onClick()
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-hover',
                it.danger ? 'text-danger' : 'text-ink-900',
              )}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
