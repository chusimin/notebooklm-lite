/**
 * 未配置模型密钥时的顶栏提示。导入、问答、工作室都依赖 LLM / Embedding Key。
 */
import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { api, type Health } from '../lib/api'

export function KeyBanner() {
  const [health, setHealth] = useState<Health | null>(null)
  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])
  if (!health) return null
  if (health.llm_configured && health.embedding_configured) return null
  return (
    <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-950">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>
        尚未配置模型密钥。请在 <code className="rounded bg-white/80 px-1">backend/.env</code> 填入{' '}
        <code className="rounded bg-white/80 px-1">LLM_API_KEY</code> 与{' '}
        <code className="rounded bg-white/80 px-1">EMBEDDING_API_KEY</code>
        （OpenRouter），否则无法导入资料与问答。改完后重启后端。
      </span>
    </div>
  )
}
