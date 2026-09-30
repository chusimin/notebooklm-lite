#!/usr/bin/env python3
"""把本机 Langfuse 的密钥写入 backend/.env（不打印已有 LLM 密钥）。"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / "backend" / ".env"

KV = {
    "LANGFUSE_PUBLIC_KEY": "pk-lf-local-notebooklm-lite",
    "LANGFUSE_SECRET_KEY": "sk-lf-local-notebooklm-lite-secret",
    "LANGFUSE_BASE_URL": "http://localhost:3100",
    "LANGFUSE_ENVIRONMENT": "development",
}


def main() -> None:
    text = ENV.read_text(encoding="utf-8") if ENV.exists() else ""
    lines = text.splitlines()
    seen = set()
    out = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line and not line.strip().startswith("#") else None
        if key in KV:
            out.append(f"{key}={KV[key]}")
            seen.add(key)
        else:
            out.append(line)
    for key, value in KV.items():
        if key not in seen:
            out.append(f"{key}={value}")
    ENV.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
    print("已写入 backend/.env：Langfuse -> http://localhost:3100")


if __name__ == "__main__":
    main()
