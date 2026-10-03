/**
 * 右侧讲解面板（借鉴 TL;DR Crawler 的实时面板）：
 * 步骤计数 "5 / 8" + 分段进度条（可点击跳转）+ 本步标题 + 大白话讲解 + 真实数据 + 播放控制。
 */
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '../../../components/Button'
import { cn } from '../../../lib/cn'
import type { Step } from './shared'

export function NarrationPanel({
  steps,
  index,
  t,
  playing,
  onGoto,
  onToggle,
}: {
  steps: Step[]
  index: number
  t: number
  playing: boolean
  onGoto: (i: number) => void
  onToggle: () => void
}) {
  const step = steps[index]
  if (!step) return null
  return (
    <aside className="flex flex-col rounded-panel border border-line bg-white" aria-live="polite">
      <div className="border-b border-line-divider px-4 pb-3 pt-4">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-ink-450">小金讲解</span>
          <span className="font-mono text-[13px] font-semibold text-ink">
            {index + 1} / {steps.length}
          </span>
        </div>
        <div className="flex gap-1">
          {steps.map((s, i) => (
            <button
              key={s.key}
              type="button"
              title={s.title}
              aria-label={`跳到第 ${i + 1} 步：${s.title}`}
              onClick={() => onGoto(i)}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted"
            >
              <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: i < index ? '100%' : i === index ? `${t * 100}%` : '0%' }} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 py-4">
        <h3 key={step.key} className="animate-pop-in text-[17px] font-semibold text-ink">
          {step.title}
        </h3>
        <p className="mt-2 text-[14px] leading-7 text-ink-700">{step.say}</p>
        {step.facts.length > 0 && (
          <dl className="mt-4 space-y-2 rounded-card bg-surface-soft p-3">
            {step.facts.map((f) => (
              <div key={f.label} className="flex justify-between gap-3 text-[12.5px]">
                <dt className="shrink-0 text-ink-450">{f.label}</dt>
                <dd className="min-w-0 text-right text-ink">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line-divider px-3 py-2.5">
        <Button variant="ghost" size="icon-sm" aria-label="上一步" disabled={index === 0} onClick={() => onGoto(index - 1)}>
          <SkipBack size={14} />
        </Button>
        <Button variant="primary" size="sm" onClick={onToggle} icon={playing ? <Pause size={13} /> : <Play size={13} />}>
          {playing ? '暂停' : index === steps.length - 1 && t >= 1 ? '重播' : '播放'}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="下一步" disabled={index === steps.length - 1} onClick={() => onGoto(index + 1)}>
          <SkipForward size={14} />
        </Button>
      </div>
      <ol className="space-y-0.5 border-t border-line-divider px-3 py-2.5">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              onClick={() => onGoto(i)}
              className={cn(
                'flex w-full items-center gap-2 rounded-[6px] px-2 py-1 text-left text-[12.5px] transition-colors',
                i === index ? 'bg-surface-hover font-medium text-ink' : i < index ? 'text-ink-600 hover:bg-surface-hover' : 'text-ink-400 hover:bg-surface-hover',
              )}
            >
              <span className="w-4 font-mono text-[11px]">{i + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}
