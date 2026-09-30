/**
 * ChunkDrawer：引用原文抽屉。
 * 点击回答中的引用角标后打开，请求 GET /api/chunks/{chunk_id} 展示完整片段，
 * 头部高亮来源标题、页码与片段序号；原文中与 snippet 开头一致的部分做淡高亮，方便定位。
 */
import { useEffect, useState } from 'react'
import { AlertCircle, FileText } from 'lucide-react'
import { api, type Chunk, type Citation } from '../lib/api'
import { errMsg } from '../lib/http'
import { Drawer } from './Drawer'
import { LoadingBlock } from './Spinner'
import { Badge } from './Badge'

export function ChunkDrawer({ citation, onClose }: { citation: Citation | null; onClose: () => void }) {
  const [chunk, setChunk] = useState<Chunk | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!citation) return
    let alive = true
    setChunk(null)
    setError(null)
    api
      .getChunk(citation.chunk_id)
      .then((c) => alive && setChunk(c))
      .catch((e) => alive && setError(errMsg(e, '原文加载失败')))
    return () => {
      alive = false
    }
  }, [citation])

  return (
    <Drawer open={!!citation} onClose={onClose} title="引用原文" subtitle={citation ? `引用 [${citation.index}]` : undefined}>
      {citation && (
        <div className="space-y-4">
          <div className="rounded-card border border-line bg-surface-soft p-3">
            <div className="flex items-start gap-2">
              <FileText size={16} className="mt-0.5 shrink-0 text-ink" />
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold text-ink">{chunk?.source_title ?? citation.source_title}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(chunk?.page ?? citation.page) != null && <Badge tone="solid">第 {chunk?.page ?? citation.page} 页</Badge>}
                  {chunk && <Badge tone="neutral">片段 #{chunk.idx + 1}</Badge>}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-card border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                {error}
                <div className="mt-2 text-xs text-ink-600">摘录：{citation.snippet}</div>
              </div>
            </div>
          )}
          {!chunk && !error && <LoadingBlock text="正在加载原文…" />}
          {chunk && <HighlightedText text={chunk.text} snippet={citation.snippet} />}
        </div>
      )}
    </Drawer>
  )
}

/** 把 snippet 在原文中的位置做淡灰高亮（snippet 为片段前 200 字，通常位于开头） */
function HighlightedText({ text, snippet }: { text: string; snippet: string }) {
  const key = snippet.replace(/…$/, '').slice(0, 200).trim()
  const i = key ? text.indexOf(key) : -1
  const cls = 'whitespace-pre-wrap break-words text-[13.5px] leading-7 text-ink-900'
  if (i < 0) return <div className={cls}>{text}</div>
  return (
    <div className={cls}>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-black/[0.07] px-0.5 underline decoration-ink-400 underline-offset-4 text-ink-900">{text.slice(i, i + key.length)}</mark>
      {text.slice(i + key.length)}
    </div>
  )
}
