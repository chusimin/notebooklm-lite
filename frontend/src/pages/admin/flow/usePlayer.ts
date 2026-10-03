/**
 * 分镜播放器：管理当前步骤、步内进度 t（0–1）与自动播放。
 *
 * - 无论是否在播放，当前步骤的动画都会播完（手动点"下一步"也能看到动画）
 * - 自动播放时，动画播完停留 HOLD_MS 再进入下一步；最后一步播完自动暂停
 * - prefers-reduced-motion：t 恒为 1，只切换画面不做位移动画
 * - clock 是持续走的毫秒时钟，给小金摇尾巴、跑步摆腿这类循环动作用
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { HOLD_MS, type Step } from './shared'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function usePlayer(steps: Step[], resetKey: string) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [, setFrame] = useState(0)
  const elapsed = useRef(0)
  const clock = useRef(0)
  const live = useRef({ index, playing, steps })
  live.current = { index, playing, steps }

  // 换一次调用（resetKey 变化）就从头开始自动播放
  useEffect(() => {
    elapsed.current = 0
    setIndex(0)
    setPlaying(steps.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(64, now - last) // 切到后台再回来时不要一下跳完
      last = now
      clock.current += dt
      const { index: i, playing: p, steps: s } = live.current
      const dur = s[i]?.duration ?? 0
      elapsed.current += dt
      if (p && elapsed.current >= dur + HOLD_MS) {
        if (i < s.length - 1) {
          elapsed.current = 0
          setIndex(i + 1)
        } else {
          elapsed.current = dur
          setPlaying(false)
        }
      }
      setFrame((f) => (f + 1) % 1_000_000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const goto = useCallback((i: number) => {
    const n = live.current.steps.length
    if (!n) return
    elapsed.current = 0
    setIndex(Math.max(0, Math.min(n - 1, i)))
  }, [])

  const toggle = useCallback(() => {
    const { index: i, playing: p, steps: s } = live.current
    // 已经播到最后：点播放就从头来
    if (!p && i === s.length - 1 && elapsed.current >= (s[i]?.duration ?? 0)) {
      elapsed.current = 0
      setIndex(0)
    }
    setPlaying(!p)
  }, [])

  const dur = steps[index]?.duration || 1
  const t = reducedMotion() ? 1 : Math.min(1, elapsed.current / dur)
  return { index, t, playing, clock: clock.current, goto, toggle, next: () => goto(index + 1), prev: () => goto(index - 1) }
}
