/**
 * 展示格式化工具：时间、耗时、token、成本、百分比等。
 * 后端时间为 UTC ISO 8601（带 Z），统一转本地时区展示。
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** 绝对时间：2026-09-30 16:00 */
export function fmtDateTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base
}

/** 相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前，超过 30 天显示日期 */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return iso
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`
  return fmtDateTime(iso).slice(0, 10)
}

/** 耗时：850ms / 1.24s / 1m 05s */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || isNaN(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return `${m}m ${pad(s)}s`
}

/** 数字千分位 */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  return n.toLocaleString('en-US')
}

/** 紧凑数字：1.2k / 3.4M */
export function fmtCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '—'
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`
  return fmtNum(n)
}

/** 成本：$0.0012，按量级保留精度 */
export function fmtCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || isNaN(usd)) return '—'
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** 百分比：0.123 → 12.3% */
export function fmtPct(r: number | null | undefined, digits = 1): string {
  if (r === null || r === undefined || isNaN(r)) return '—'
  return `${(r * 100).toFixed(digits)}%`
}

/** 字数：12,345 字 / 1.2 万字 */
export function fmtChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`
  return `${fmtNum(n)} 字`
}
