/**
 * Composer：问答输入框
 * - Enter 发送、Shift+Enter 换行（兼容中文输入法组字，组字中不发送）
 * - 生成中禁用
 * - 底部显示当前问答范围：“基于全部 N 个资料” / “基于 N 个资料”
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Files } from 'lucide-react'
import { cn } from '../../lib/cn'
import type { Scope } from '../NotebookPage'

export function Composer({ disabled, scope, onSend }: { disabled: boolean; scope: Scope; onSend: (q: string) => void }) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)

  const noSource = scope.selected.length === 0
  const canSend = !disabled && !noSource && value.trim() !== ''

  // 自适应高度（最多约 8 行）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const submit = () => {
    if (!canSend) return
    onSend(value)
    setValue('')
  }

  const scopeText =
    scope.ready.length === 0
      ? '暂无可用资料，请先在左侧添加资料'
      : noSource
        ? '未勾选任何资料，请在左侧勾选'
        : scope.sourceIds === null
          ? `基于全部 ${scope.ready.length} 个资料`
          : `基于 ${scope.selected.length} 个资料`

  return (
    <div className="shrink-0 px-6 pb-5 pt-2">
      <div className="mx-auto w-full max-w-[760px]">
        <div
          className={cn(
            'flex items-end gap-2 rounded-[14px] border bg-white px-3 py-2.5 transition-colors',
            disabled ? 'border-line bg-surface-soft' : 'border-line-strong focus-within:border-ink',
          )}
        >
          <textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(e) => setValue(e.target.value)}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder={disabled ? '正在生成回答…' : noSource ? '请先勾选资料' : '基于资料提问，Enter 发送，Shift + Enter 换行'}
            className="thin-scroll max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-0.5 text-[14px] leading-6 text-ink-900 outline-none placeholder:text-ink-450 disabled:cursor-not-allowed"
          />
          <button
            onClick={submit}
            disabled={!canSend}
            aria-label="发送"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-opacity disabled:opacity-25"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <div className={cn('mt-2 flex items-center gap-1.5 px-1 text-xs', noSource ? 'text-danger' : 'text-ink-450')}>
          <Files size={12} />
          {scopeText}
          <span className="ml-auto text-ink-400">回答仅依据资料生成，请以原文为准</span>
        </div>
      </div>
    </div>
  )
}
