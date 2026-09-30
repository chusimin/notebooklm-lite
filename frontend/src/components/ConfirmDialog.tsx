/**
 * ConfirmDialog：危险操作二次确认（删除笔记本 / 资料 / 笔记、清空对话）。
 * onConfirm 可返回 Promise，执行期间按钮 loading 且不可关闭。
 */
import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { useToast } from './Toast'

export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmText = '删除',
  danger = true,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  confirmText?: string
  danger?: boolean
  onConfirm: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const run = async () => {
    setBusy(true)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      // 失败时提示并保持弹窗打开，便于重试
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={400}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={run}>
            {confirmText}
          </Button>
        </>
      }
    >
      {description && <div className="text-sm leading-6 text-ink-600">{description}</div>}
    </Modal>
  )
}
