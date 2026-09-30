/**
 * ChatEmpty：对话空状态
 * - 无资料：引导添加资料
 * - 仅处理中：提示等待
 * - 有已就绪资料：展示问答范围内资料的概要，以及推荐问题（点击直接提问）
 */
import { ArrowUpRight, MessageSquareText } from 'lucide-react'
import type { Source } from '../../lib/api'
import { EmptyState } from '../../components/EmptyState'
import { Spinner } from '../../components/Spinner'
import type { Scope } from '../NotebookPage'
import { SourceIcon } from './SourceIcon'

export function ChatEmpty({ sources, scope, onAsk }: { sources: Source[]; scope: Scope; onAsk: (q: string) => void }) {
  if (sources.length === 0)
    return (
      <EmptyState
        icon={<MessageSquareText size={18} />}
        title="先添加一些资料"
        description="在左侧上传 PDF、添加网页或粘贴文本。资料就绪后，就可以基于它们提问，回答会标注引用来源。"
      />
    )

  if (scope.ready.length === 0)
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <Spinner size={18} className="text-ink-450" />
        <div className="mt-3 text-sm font-medium text-ink">资料处理中</div>
        <div className="mt-1 text-xs text-ink-450">正在解析、切分并生成概要，通常需要几秒到一分钟。</div>
      </div>
    )

  const list = scope.selected.length ? scope.selected : scope.ready
  // 推荐问题：每个资料取前 3 个，最多展示 6 个
  const questions = list.flatMap((s) => s.suggested_questions.slice(0, 3)).slice(0, 6)

  return (
    <div className="py-4">
      <h2 className="text-[22px] font-semibold tracking-tight text-ink">从资料开始提问</h2>
      <p className="mt-1 text-sm text-ink-600">回答只依据你的资料，并用编号标注来源，点击编号即可查看原文。</p>

      <div className="mt-6 space-y-2">
        {list.slice(0, 4).map((s) => (
          <div key={s.id} className="flex gap-3 rounded-panel border border-line p-4">
            <SourceIcon type={s.type} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-ink">{s.title}</div>
              <p className="mt-1 text-[13px] leading-6 text-ink-600">{s.summary || '暂无概要'}</p>
            </div>
          </div>
        ))}
        {list.length > 4 && <div className="px-1 text-xs text-ink-450">以及另外 {list.length - 4} 个资料</div>}
      </div>

      {questions.length > 0 && (
        <div className="mt-8">
          <div className="mb-2 text-xs font-medium text-ink-450">推荐问题</div>
          <div className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <button
                key={i}
                onClick={() => onAsk(q)}
                className="group flex items-center justify-between gap-3 rounded-card border border-line bg-white px-3.5 py-2.5 text-left text-[13.5px] text-ink-900 transition-colors hover:border-line-strong hover:bg-surface-soft"
              >
                <span>{q}</span>
                <ArrowUpRight size={14} className="shrink-0 text-ink-400 transition-colors group-hover:text-ink" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
