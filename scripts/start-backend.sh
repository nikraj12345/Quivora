#!/usr/bin/env bash
# Starts API + Celery as detached processes using a persistent helper shell.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/quivora-backend"
source .venv/bin/activate

export PYTHONPATH=.
export QUIVORA_DATABASE_URL="${QUIVORA_DATABASE_URL:-postgresql+psycopg2://quivora:quivora@localhost:5434/quivora}"
export QUIVORA_REDIS_URL="${QUIVORA_REDIS_URL:-redis://localhost:6379/0}"

pkill -f 'uvicorn app.main:app' 2>/dev/null || true
pkill -f 'celery -A app.worker.celery_app' 2>/dev/null || true
sleep 1

# Start under a persistent subshell that won't die with this script
(PYTHONPATH=. uvicorn app.main:app --host 127.0.0.1 --port 8100 --log-level warning \
  >> /tmp/quivora-api.log 2>&1) &
echo $! > /tmp/quivora-api.pid

(PYTHONPATH=. celery -A app.worker.celery_app.celery_app worker \
  --loglevel=warning --concurrency=1 \
  >> /tmp/quivora-celery.log 2>&1) &
echo $! > /tmp/quivora-celery.pid

sleep 3
curl -sf http://127.0.0.1:8100/health && echo " — API :8100 up"
echo "PIDs: API=$(cat /tmp/quivora-api.pid) Celery=$(cat /tmp/quivora-celery.pid)"
echo "Logs: /tmp/quivora-api.log  /tmp/quivora-celery.log"
