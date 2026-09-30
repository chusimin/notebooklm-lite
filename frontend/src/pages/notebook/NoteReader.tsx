/**
 * NoteReader：笔记 Markdown 阅读弹层（支持复制全文、删除）。
 */
import { useState } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import type { Note } from '../../lib/api'
import { fmtDateTime } from '../../lib/format'
import { Modal } from '../../components/Modal'
import { Markdown } from '../../components/Markdown'
import { Button } from '../../components/Button'
import { useToast } from '../../components/Toast'
import { KindBadge } from './StudioPanel'

export function NoteReader({ note, onClose, onDelete }: { note: Note | null; onClose: () => void; onDelete: (n: Note) => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!note) return
    try {
      await navigator.clipboard.writeText(note.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败')
    }
  }
  return (
    <Modal
      open={!!note}
      onClose={onClose}
      width={760}
      title={
        note && (
          <div className="flex items-center gap-2">
            <KindBadge kind={note.kind} />
            <span className="truncate">{note.title || '未命名笔记'}</span>
          </div>
        )
      }
      description={note && fmtDateTime(note.created_at)}
      footer={
        note && (
          <>
            <Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => onDelete(note)} className="mr-auto hover:text-danger">
              删除
            </Button>
            <Button icon={copied ? <Check size={13} /> : <Copy size={13} />} onClick={copy}>
              {copied ? '已复制' : '复制 Markdown'}
            </Button>
            <Button variant="primary" onClick={onClose}>
              关闭
            </Button>
          </>
        )
      }
    >
      {note && <Markdown className="pt-1">{note.content || '*（空笔记）*'}</Markdown>}
    </Modal>
  )
}
