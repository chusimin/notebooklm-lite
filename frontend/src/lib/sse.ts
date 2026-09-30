/**
 * 通用 SSE 客户端：基于 fetch + ReadableStream 手动解析 text/event-stream。
 * 用途：POST 请求无法使用 EventSource，故手动实现。
 * 解析规则遵循 WHATWG SSE：以空行分隔事件，支持 event: / data:（多行拼接）/ 注释行（: 开头）。
 */
import { ApiError, readError } from './http'

export type SSEOptions = {
  /** JSON 请求体；存在时使用 POST */
  body?: unknown
  method?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 每解析出一个完整事件回调一次；data 尝试 JSON.parse，失败则为原始字符串 */
  onEvent: (event: string, data: unknown) => void
}

export async function streamSSE(url: string, opts: SSEOptions): Promise<void> {
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        Accept: 'text/event-stream',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if (opts.signal?.aborted) throw e
    throw new ApiError('网络异常，无法连接后端服务', 0)
  }
  if (!res.ok) throw await readError(res)
  if (!res.body) throw new ApiError('响应不支持流式读取', 0)

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let eventName = ''
  let dataLines: string[] = []

  /** 空行时派发当前累计的事件 */
  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = ''
      return
    }
    const raw = dataLines.join('\n')
    let data: unknown = raw
    try {
      data = JSON.parse(raw)
    } catch {
      /* 非 JSON 数据保持原样 */
    }
    opts.onEvent(eventName || 'message', data)
    eventName = ''
    dataLines = []
  }

  const handleLine = (line: string) => {
    if (line === '') return dispatch()
    if (line.startsWith(':')) return // 注释 / 心跳
    const idx = line.indexOf(':')
    const field = idx === -1 ? line : line.slice(0, idx)
    let value = idx === -1 ? '' : line.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 兼容 \r\n / \r / \n 三种换行
    const lines = buffer.split(/\r\n|\r|\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) handleLine(line)
  }
  buffer += decoder.decode()
  if (buffer) handleLine(buffer)
  dispatch()
}
