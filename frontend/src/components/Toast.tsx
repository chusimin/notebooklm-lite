/**
 * Toast：全局轻提示。
 * 用法：const toast = useToast(); toast.success('已保存') / toast.error(e)
 * error 可直接传入异常对象，自动提取中文错误信息。
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { errMsg } from '../lib/http'

type ToastType = 'success' | 'error' | 'info'
type ToastItem = { id: number; type: ToastType; text: string }

type ToastApi = {
  success: (text: string) => void
  info: (text: string) => void
  error: (e: unknown, fallback?: string) => void
}

const Ctx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const remove = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (type: ToastType, text: string) => {
      const id = ++seq.current
      setItems((l) => [...l.slice(-3), { id, type, text }])
      window.setTimeout(() => remove(id), type === 'error' ? 5000 : 2600)
    },
    [remove],
  )

  const api = useMemo<ToastApi>(
    () => ({
      success: (t) => push('success', t),
      info: (t) => push('info', t),
      error: (e, fb) => push('error', typeof e === 'string' ? e : errMsg(e, fb)),
    }),
    [push],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
          {items.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex max-w-md animate-pop-in items-start gap-2 rounded-card border border-line bg-white px-3 py-2 text-sm text-ink-900"
            >
              {t.type === 'success' && <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" />}
              {t.type === 'error' && <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />}
              {t.type === 'info' && <Info size={16} className="mt-0.5 shrink-0 text-ink-450" />}
              <span className="leading-5">{t.text}</span>
              <button onClick={() => remove(t.id)} className="ml-1 mt-0.5 text-ink-400 hover:text-ink" aria-label="关闭">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast 必须在 ToastProvider 内使用')
  return v
}
