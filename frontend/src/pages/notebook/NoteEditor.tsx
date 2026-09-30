/**
 * NoteEditor：手动新建笔记（标题 + Markdown 正文，可切换预览）。
 */
import { useState } from 'react'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { Markdown } from '../../components/Markdown'
import { Segmented } from '../../components/Segmented'
import { useToast } from '../../components/Toast'

export function NoteEditor({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (title: string, content: string) => Promise<void>
}) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (busy) return
    setTitle('')
    setContent('')
    setView('edit')
    onClose()
  }

  const save = async () => {
    setBusy(true)
    try {
      await onSubmit(title.trim() || '未命名笔记', content)
      setBusy(false)
      setTitle('')
      setContent('')
      setView('edit')
      onClose()
    } catch (e) {
      toast.error(e, '保存失败')
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="新建笔记"
      width={640}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={!content.trim() && !title.trim()} onClick={save}>
            保存
          </Button>
        </>
      }
    >
      <input
        autoFocus
        className="input mb-3 text-[15px] font-medium"
        placeholder="笔记标题"
        maxLength={200}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="mb-2 flex items-center justify-between">
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'edit', label: '编辑' },
            { value: 'preview', label: '预览' },
          ]}
        />
        <span className="text-[11px] text-ink-450">支持 Markdown</span>
      </div>
      {view === 'edit' ? (
        <textarea
          className="input thin-scroll h-72 resize-none font-mono text-[13px] leading-6"
          placeholder="记录你的想法、摘录或总结…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      ) : (
        <div className="thin-scroll h-72 overflow-y-auto rounded-card border border-line p-3">
          {content.trim() ? <Markdown>{content}</Markdown> : <div className="text-sm text-ink-450">暂无内容</div>}
        </div>
      )}
    </Modal>
  )
}
