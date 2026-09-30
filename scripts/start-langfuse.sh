#!/usr/bin/env bash
# 启动本机 Langfuse（http://localhost:3100），并把密钥写入 backend/.env
# 走 Colima 时自动设 DOCKER_HOST，并避开 Docker Desktop 的 credential helper。
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 避开 ~/.docker/config.json 里的 credsStore=desktop（本机没有 docker-credential-desktop）
DOCKER_CFG="$(mktemp -d)"
printf '%s\n' '{"auths":{}}' > "$DOCKER_CFG/config.json"
export DOCKER_CONFIG="$DOCKER_CFG"
cleanup() { rm -rf "$DOCKER_CFG"; }
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker CLI，请先: brew install colima docker docker-compose"
  exit 1
fi

# Colima socket（default profile 或旧路径）
if [[ -S "$HOME/.colima/default/docker.sock" ]]; then
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
elif [[ -S "$HOME/.colima/docker.sock" ]]; then
  export DOCKER_HOST="unix://$HOME/.colima/docker.sock"
fi

if ! docker info >/dev/null 2>&1; then
  if ! command -v colima >/dev/null 2>&1; then
    echo "Docker 未运行。请启动 Docker Desktop，或: brew install colima docker docker-compose"
    exit 1
  fi
  echo "正在启动 Colima（第一次会下载虚拟机镜像，可能要几分钟）…"
  colima start --cpu 2 --memory 4
  if [[ -S "$HOME/.colima/default/docker.sock" ]]; then
    export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  elif [[ -S "$HOME/.colima/docker.sock" ]]; then
    export DOCKER_HOST="unix://$HOME/.colima/docker.sock"
  fi
fi

# Colima VM 的 /etc/resolv.conf 偶发指向失效的 systemd stub，导致拉镜像失败
if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
  colima ssh -- bash -lc '
    if ! getent hosts registry-1.docker.io >/dev/null 2>&1; then
      sudo rm -f /etc/resolv.conf
      printf "nameserver 223.5.5.5\nnameserver 8.8.8.8\n" | sudo tee /etc/resolv.conf >/dev/null
      sudo systemctl reset-failed docker 2>/dev/null || true
      sudo systemctl restart docker 2>/dev/null || true
    fi
  ' || true
fi

if docker compose version >/dev/null 2>&1; then
  docker compose -f docker-compose.langfuse.yml up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f docker-compose.langfuse.yml up -d
else
  echo "未找到 docker compose / docker-compose"
  exit 1
fi

echo "等待 Langfuse 就绪…"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3100; then
    break
  fi
  sleep 1
done

python3 "$ROOT/scripts/write_langfuse_env.py"
echo "Langfuse 界面: http://localhost:3100"
echo "登录邮箱: local@notebooklm.lite"
echo "登录密码: notebooklm-local"
echo "然后重启后端：cd backend && uv run uvicorn app.main:app --port 8765 --reload --reload-dir app"
