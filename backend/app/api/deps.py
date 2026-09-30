"""路由共用的校验辅助函数。"""

from fastapi import HTTPException

from app import repo


def require_notebook(notebook_id: str) -> dict:
    nb = repo.get_notebook(notebook_id)
    if nb is None:
        raise HTTPException(status_code=404, detail="笔记本不存在")
    return nb


def model_error_text(exc: BaseException) -> str:
    """把模型/网络异常转换为面向用户的中文说明（不暴露密钥等敏感信息）。"""
    name = exc.__class__.__name__
    text = str(exc)[:200]
    if "Timeout" in name:
        return "模型响应超时，请稍后重试"
    if "Authentication" in name or "401" in text:
        return "模型服务鉴权失败，请检查 API Key 配置"
    if "RateLimit" in name or "429" in text:
        return "模型服务请求过于频繁，请稍后重试"
    if "Connection" in name:
        return "无法连接模型服务，请检查网络"
    return f"{name}: {text}"
