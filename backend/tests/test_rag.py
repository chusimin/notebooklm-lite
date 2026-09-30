"""RAG 基础能力：切分（页码保留）、PDF 加载、RRF 融合、BM25、引用解析与规范化。"""

import pytest

from app.rag.citations import build_citations, normalize_citations, strip_citations
from app.rag.loaders import LoadError, decode_text, load_pdf, load_text, strip_footnote_marks
from app.rag.retriever import bm25_search, rrf_fuse, vector_search
from app.rag.splitter import CHUNK_SIZE, split_pages


def make_pdf(pages: list[str]) -> bytes:
    """手写一个最小的多页 PDF（ASCII 文本），用于验证按页提取。"""
    objs: list[bytes] = []
    n = len(pages)
    # 1: catalog, 2: pages, 3: font, 之后每页 2 个对象（page + content）
    kids = " ".join(f"{4 + 2 * i} 0 R" for i in range(n))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, text in enumerate(pages):
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {5 + 2 * i} 0 R "
            f"/Resources << /Font << /F1 3 0 R >> >> >>".encode()
        )
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for idx, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{idx} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return bytes(out)


def test_split_keeps_page_numbers_and_idx():
    long_page = "这是第二页的句子。" * 300  # 约 2700 字，必然被切成多段
    pages = [{"page": 1, "text": "第一页内容。很短。"}, {"page": 2, "text": long_page}]
    chunks = split_pages(pages)
    assert chunks[0]["page"] == 1
    assert len(chunks) >= 4
    assert all(c["page"] == 2 for c in chunks[1:])
    assert [c["idx"] for c in chunks] == list(range(len(chunks)))
    assert all(len(c["text"]) <= CHUNK_SIZE for c in chunks)
    # 中文句号优先切分：片段应以句号结尾
    assert chunks[1]["text"].endswith("。")


def test_split_overlap():
    text = "".join(f"第{i}句话的内容比较长一些。" for i in range(200))
    chunks = split_pages([{"page": None, "text": text}])
    # 相邻片段存在重叠文本
    tail = chunks[0]["text"][-30:]
    assert tail[-10:] in chunks[1]["text"]


def test_load_pdf_by_page():
    pages = load_pdf(make_pdf(["Hello page one", "Second page text"]))
    assert [p["page"] for p in pages] == [1, 2]
    assert "Hello page one" in pages[0]["text"]
    assert "Second page" in pages[1]["text"]


def test_load_pdf_invalid():
    with pytest.raises(LoadError):
        load_pdf(b"not a pdf")


def test_text_loaders():
    assert decode_text("中文".encode("gb18030")) == "中文"
    assert load_text("  你好\r\n世界  ")[0] == {"page": None, "text": "你好\n世界"}
    with pytest.raises(LoadError):
        load_text("   ")


def test_strip_footnote_marks():
    assert strip_footnote_marks("神经网络[14]被应用于语言[注 2]建模[来源请求]。") == "神经网络被应用于语言建模。"


def test_rrf_fuse():
    vec = ["a", "b", "c"]
    bm25 = ["c", "a", "d"]
    fused = rrf_fuse([vec, bm25], k=60, top_n=8)
    ids = [i for i, _ in fused]
    # a: 1/61 + 1/62；c: 1/63 + 1/61；b: 1/62；d: 1/63
    assert ids == ["a", "c", "b", "d"]
    assert fused[0][1] == pytest.approx(1 / 61 + 1 / 62)
    assert len(rrf_fuse([vec, bm25], top_n=2)) == 2


def test_vector_and_bm25_search():
    import numpy as np

    chunks = [
        {"id": "x", "text": "猫喜欢吃鱼", "embedding": np.array([1, 0], dtype=np.float32)},
        {"id": "y", "text": "狗喜欢骨头", "embedding": np.array([0, 1], dtype=np.float32)},
    ]
    assert vector_search(np.array([0.9, 0.1], dtype=np.float32), chunks)[0][0] == "x"
    hits = bm25_search("狗和骨头", chunks)
    assert hits and hits[0][0] == "y"
    assert all(h[0] != "x" for h in hits)  # 无词项命中的片段不返回


def test_normalize_citations_formats():
    text = "事实甲 [1, 2]。事实乙[3][1]。事实丙 [2，4]。越界 [9]。顿号[1、2]。"
    normalized, used = normalize_citations(text, max_index=4)
    assert normalized == "事实甲 [1][2]。事实乙[3][1]。事实丙 [2][4]。越界。顿号[1][2]。"
    assert used == [1, 2, 3, 4]


def test_normalize_keeps_markdown_links_and_dedups():
    text = "见 [1](http://a.com) 与 [2][2] 以及 [2, 2]"
    normalized, used = normalize_citations(text, max_index=3)
    assert "[1](http://a.com)" in normalized
    assert normalized.endswith("[2] 以及 [2]")
    assert used == [2]


def test_build_citations_only_used_indices():
    contexts = [
        {"id": f"c{i}", "source_id": "s", "source_title": "资料", "page": i, "text": f"片段{i}" * 100}
        for i in range(1, 6)
    ]
    content, cits = build_citations("甲 [3]。乙 [1, 7]。", contexts)
    assert content == "甲 [3]。乙 [1]。"
    assert [c["index"] for c in cits] == [1, 3]
    assert cits[1]["chunk_id"] == "c3" and cits[1]["page"] == 3
    assert len(cits[0]["snippet"]) == 200


def test_strip_citations():
    assert strip_citations("甲[1][2]，乙 [3, 4]") == "甲，乙 "
