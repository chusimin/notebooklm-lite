"""资料加载器：把 PDF / 文本 / 网页统一转换为「页」列表 `[{page, text}]`。

PDF 按页保留页码（从 1 开始），文本和网页没有页码（page=None）。
加载失败统一抛 LoadError（中文信息），由 ingest_graph 写入 sources.error。
"""

from __future__ import annotations

import io
import re
from html import unescape

import httpx

PageList = list[dict]  # [{"page": int | None, "text": str}]


class LoadError(RuntimeError):
    """资料加载失败，message 为面向用户的中文说明。"""


def _clean(text: str) -> str:
    # 统一换行、去掉 NUL 与行尾空白、压缩过多空行
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def load_pdf(data: bytes) -> PageList:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:
                raise LoadError("PDF 已加密，无法读取") from exc
        pages = []
        for i, page in enumerate(reader.pages, start=1):
            text = _clean(page.extract_text() or "")
            if text:
                pages.append({"page": i, "text": text})
    except LoadError:
        raise
    except (PdfReadError, ValueError, KeyError) as exc:
        raise LoadError(f"PDF 解析失败：{exc}") from exc
    if not pages:
        raise LoadError("PDF 中未能提取到文字（可能是扫描件或图片 PDF）")
    return pages


def decode_text(data: bytes) -> str:
    """优先 UTF-8（含 BOM），失败再尝试 GB18030，兼容常见中文文本文件。"""
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise LoadError("文本编码无法识别，请使用 UTF-8 编码保存后重试")


def load_text(text: str) -> PageList:
    text = _clean(text)
    if not text:
        raise LoadError("资料内容为空")
    return [{"page": None, "text": text}]


_FOOTNOTE_RE = re.compile(r"\[(?:\d{1,3}|注\s*\d{1,3}|note\s*\d{1,3}|来源请求)\]", re.I)


def strip_footnote_marks(text: str) -> str:
    """去掉网页（如维基百科）正文里的脚注角标 [14]，避免模型照抄后与回答引用编号 [n] 混淆。"""
    return _FOOTNOTE_RE.sub("", text)


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 NotebookLM-Lite/0.1"
)


async def fetch_url(url: str) -> tuple[str, PageList]:
    """抓取网页并提取正文，返回 (标题, 页列表)。"""
    import trafilatura

    try:
        async with httpx.AsyncClient(
            timeout=30, follow_redirects=True, headers={"User-Agent": _UA, "Accept-Language": "zh-CN,zh;q=0.9"}
        ) as client:
            resp = await client.get(url)
    except httpx.TimeoutException as exc:
        raise LoadError("网页抓取超时，请检查链接或网络") from exc
    except httpx.HTTPError as exc:
        raise LoadError(f"网页抓取失败：{exc.__class__.__name__}") from exc
    if resp.status_code >= 400:
        raise LoadError(f"网页返回错误状态码 {resp.status_code}")
    ctype = resp.headers.get("content-type", "")
    if "pdf" in ctype:
        pages = load_pdf(resp.content)
        return url.rstrip("/").rsplit("/", 1)[-1] or url, pages
    html = resp.text
    text = trafilatura.extract(html, url=str(resp.url), include_comments=False, include_tables=True) or ""
    text = _clean(strip_footnote_marks(text))
    if len(text) < 20:
        raise LoadError("未能从网页中提取到正文（可能需要登录或由脚本动态渲染）")
    title = ""
    m = _TITLE_RE.search(html)
    if m:
        title = re.sub(r"\s+", " ", unescape(m.group(1))).strip()
    return title or url, [{"page": None, "text": text}]
