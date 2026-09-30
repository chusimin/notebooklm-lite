/**
 * 添加资料弹窗：三个 tab
 * - 上传文件：.pdf .txt .md，支持拖拽与点击选择，可一次多选（逐个上传），前端预校验类型与 20MB 上限
 * - 网页链接：校验 http(s) 格式
 * - 粘贴文本：标题 + 正文
 * 提交成功后资料以 processing 状态加入列表，由父组件轮询状态。
 */
import { useRef, useState, type DragEvent } from 'react'
import { FileUp, Globe, Type, UploadCloud, X } from 'lucide-react'
import { api, type Source } from '../../lib/api'
import { cn } from '../../lib/cn'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/Button'
import { Segmented } from '../../components/Segmented'
import { useToast } from '../../components/Toast'

type Tab = 'file' | 'url' | 'text'
const ACCEPT = ['.pdf', '.txt', '.md', '.markdown']
const MAX_BYTES = 20 * 1024 * 1024

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function AddSourceModal({
  open,
  notebookId,
  onClose,
  onAdded,
}: {
  open: boolean
  notebookId: string
  onClose: () => void
  onAdded: (s: Source) => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('file')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [drag, setDrag] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFiles([])
    setUrl('')
    setTitle('')
    setContent('')
    setError(null)
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  /** 选择 / 拖入文件：过滤不支持的类型和超大文件 */
  const pickFiles = (list: FileList | null) => {
    if (!list) return
    const ok: File[] = []
    const bad: string[] = []
    for (const f of Array.from(list)) {
      const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
      if (!ACCEPT.includes(ext)) bad.push(`${f.name}（不支持的格式）`)
      else if (f.size > MAX_BYTES) bad.push(`${f.name}（超过 20MB）`)
      else ok.push(f)
    }
    setError(bad.length ? `已忽略：${bad.join('、')}` : null)
    setFiles((prev) => [...prev, ...ok.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    pickFiles(e.dataTransfer.files)
  }

  const urlValid = isHttpUrl(url)
  const canSubmit =
    !busy && (tab === 'file' ? files.length > 0 : tab === 'url' ? urlValid : content.trim() !== '')

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (tab === 'file') {
        // 逐个上传，失败的文件保留在列表中便于重试
        const failed: File[] = []
        const msgs: string[] = []
        for (const f of files) {
          try {
            onAdded(await api.uploadSourceFile(notebookId, f))
          } catch (e) {
            failed.push(f)
            msgs.push(`${f.name}：${e instanceof Error ? e.message : '上传失败'}`)
          }
        }
        if (failed.length) {
          setFiles(failed)
          setError(msgs.join('；'))
          if (failed.length < files.length) toast.success(`已添加 ${files.length - failed.length} 个资料`)
          return
        }
        toast.success(`已添加 ${files.length} 个资料，正在后台处理`)
      } else if (tab === 'url') {
        onAdded(await api.addSourceUrl(notebookId, url.trim()))
        toast.success('网页已添加，正在抓取正文')
      } else {
        onAdded(await api.addSourceText(notebookId, title.trim(), content))
        toast.success('文本已添加，正在处理')
      }
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="添加资料"
      description="资料会被切分并向量化，完成后可用于问答与生成。"
      width={560}
      dismissable={!busy}
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={submit}>
            {tab === 'file' && files.length > 1 ? `添加 ${files.length} 个文件` : '添加'}
          </Button>
        </>
      }
    >
      <Segmented<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t)
          setError(null)
        }}
        className="mb-4"
        options={[
          { value: 'file', label: <><FileUp size={13} />上传文件</> },
          { value: 'url', label: <><Globe size={13} />网页链接</> },
          { value: 'text', label: <><Type size={13} />粘贴文本</> },
        ]}
      />

      {tab === 'file' && (
        <div>
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center rounded-panel border border-dashed px-6 py-10 text-center transition-colors',
              drag ? 'border-ink bg-surface-muted' : 'border-line-strong hover:border-ink-450 hover:bg-surface-soft',
            )}
          >
            <UploadCloud size={22} className="text-ink-600" />
            <div className="mt-3 text-sm font-medium text-ink">拖拽文件到此处，或点击选择</div>
            <div className="mt-1 text-xs text-ink-450">支持 PDF、TXT、Markdown，单个文件不超过 20MB</div>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT.join(',')}
              className="hidden"
              onChange={(e) => {
                pickFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          {files.length > 0 && (
            <ul className="mt-3 divide-y divide-line-divider rounded-card border border-line">
              {files.map((f) => (
                <li key={f.name + f.size} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <span className="truncate text-ink-900">{f.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-ink-450">
                    {(f.size / 1024 / 1024).toFixed(f.size < 1024 * 1024 ? 2 : 1)} MB
                    <button
                      disabled={busy}
                      onClick={() => setFiles((l) => l.filter((x) => x !== f))}
                      className="rounded p-0.5 hover:bg-surface-hover hover:text-ink"
                      aria-label="移除"
                    >
                      <X size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'url' && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ink-600">网页地址</label>
          <input
            autoFocus
            className="input"
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
          />
          <p className="mt-2 text-xs text-ink-450">将自动提取网页正文，需要登录或由脚本渲染的页面可能无法抓取。</p>
          {url.trim() && !urlValid && <p className="mt-1 text-xs text-danger">请输入以 http:// 或 https:// 开头的有效链接</p>}
        </div>
      )}

      {tab === 'text' && (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ink-600">
              标题 <span className="font-normal text-ink-450">选填，空着会用正文第一行</span>
            </label>
            <input
              autoFocus
              className="input"
              placeholder="例如：会议纪要 9 月 30 日"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1.5 flex items-center justify-between text-xs font-medium text-ink-600">
              <span>正文</span>
              <span className="font-normal text-ink-450">{content.length.toLocaleString()} 字</span>
            </label>
            <textarea
              className="input thin-scroll h-56 resize-none leading-6"
              placeholder="粘贴文本内容…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && <div className="mt-3 rounded-card bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">{error}</div>}
    </Modal>
  )
}
