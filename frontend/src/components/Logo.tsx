/**
 * Logo：产品标识（柔黑方块 + 书页图形 + 产品名）。
 */
import { Link } from 'react-router-dom'

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#191919" />
      <path d="M10 9h9a3 3 0 0 1 3 3v11H13a3 3 0 0 1-3-3V9z" fill="none" stroke="#fff" strokeWidth="2" />
      <path d="M14 14h4M14 18h4" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ suffix }: { suffix?: string }) {
  return (
    <Link to="/" className="flex items-center gap-2 text-ink">
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">NotebookLM Lite</span>
      {suffix && (
        <>
          <span className="text-ink-400">/</span>
          <span className="text-[14px] font-medium text-ink-600">{suffix}</span>
        </>
      )}
    </Link>
  )
}
