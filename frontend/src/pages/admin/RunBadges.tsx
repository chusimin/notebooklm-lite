/**
 * 观测后台共用的小标签：调用状态、调用类型、反馈图标。
 */
import { CircleDot, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { FeedbackValue, RunKind, RunStatus } from '../../lib/api'
import { RUN_KIND_LABEL, RUN_STATUS_LABEL } from '../../lib/labels'
import { Badge } from '../../components/Badge'
import { Spinner } from '../../components/Spinner'

export function StatusBadge({ status }: { status: RunStatus }) {
  if (status === 'running')
    return (
      <Badge tone="neutral" icon={<Spinner size={10} />}>
        {RUN_STATUS_LABEL.running}
      </Badge>
    )
  return (
    <Badge tone={status === 'success' ? 'success' : 'danger'} icon={<CircleDot size={9} />}>
      {RUN_STATUS_LABEL[status]}
    </Badge>
  )
}

export function KindBadge({ kind }: { kind: RunKind }) {
  return <Badge tone={kind === 'chat' ? 'solid' : kind === 'studio' ? 'soft' : 'neutral'}>{RUN_KIND_LABEL[kind]}</Badge>
}

export function FeedbackIcon({ value }: { value: FeedbackValue }) {
  if (value === 1) return <ThumbsUp size={13} className="fill-ink text-ink" aria-label="好评" />
  if (value === -1) return <ThumbsDown size={13} className="fill-danger text-danger" aria-label="差评" />
  return <span className="text-ink-400">—</span>
}
