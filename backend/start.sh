#!/bin/sh
set -eu

POT_PORT="${POT_PROVIDER_PORT:-4416}"
POT_URL="${POT_PROVIDER_URL:-http://127.0.0.1:${POT_PORT}}"
export POT_PROVIDER_URL="$POT_URL"

cleanup() {
  if [ -n "${POT_PID:-}" ]; then
    kill "$POT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

node /opt/bgutil/server/build/main.js --port "$POT_PORT" &
POT_PID=$!

python - <<'PY'
import os
import socket
import sys
import time
from urllib.parse import urlparse

url = urlparse(os.environ.get("POT_PROVIDER_URL", "http://127.0.0.1:4416"))
host = url.hostname or "127.0.0.1"
port = url.port or 4416

for _ in range(60):
    with socket.socket() as sock:
        sock.settimeout(0.5)
        if sock.connect_ex((host, port)) == 0:
            print(f"[WAVE] PO Token Provider prêt sur {host}:{port}", flush=True)
            sys.exit(0)
    time.sleep(0.5)

print("[WAVE] Le PO Token Provider n'a pas démarré.", file=sys.stderr, flush=True)
sys.exit(1)
PY

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-10000}" --workers 1
