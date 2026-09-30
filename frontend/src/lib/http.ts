/**
 * HTTP 基础工具：统一错误类型与后端错误信息提取。
 * 后端错误约定：{"detail": "中文错误信息"} + 4xx/5xx。
 */

/** 统一的接口错误：message 为后端 detail 中文信息 */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** 从失败响应中提取 detail；FastAPI 校验错误 detail 可能是数组 */
export async function readError(res: Response): Promise<ApiError> {
  let msg = `请求失败（${res.status}）`
  try {
    const data = await res.json()
    if (typeof data?.detail === 'string') msg = data.detail
    else if (Array.isArray(data?.detail) && data.detail[0]?.msg) msg = String(data.detail[0].msg)
  } catch {
    if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 500)
      msg = '无法连接后端服务，请确认后端已在 8765 端口启动'
  }
  return new ApiError(msg, res.status)
}

/** 把任意异常转成可展示的中文文案 */
export function errMsg(e: unknown, fallback = '操作失败'): string {
  if (e instanceof Error && e.message) return e.message
  return fallback
}
