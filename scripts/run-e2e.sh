#!/usr/bin/env bash
# Run API + Celery + e2e tests in a single shell session so background processes survive.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/quivora-backend"
source .venv/bin/activate

export PYTHONPATH=.
export QUIVORA_DATABASE_URL="${QUIVORA_DATABASE_URL:-postgresql+psycopg2://quivora:quivora@localhost:5434/quivora}"
export QUIVORA_REDIS_URL="${QUIVORA_REDIS_URL:-redis://localhost:6379/0}"
export QUIVORA_API_BASE=http://127.0.0.1:8100

pkill -f 'uvicorn app.main:app' 2>/dev/null || true
pkill -f 'celery -A app.worker.celery_app' 2>/dev/null || true
sleep 1

uvicorn app.main:app --host 127.0.0.1 --port 8100 --log-level warning &
API_PID=$!

celery -A app.worker.celery_app.celery_app worker --loglevel=warning --concurrency=1 &
CELERY_PID=$!

trap 'kill $API_PID $CELERY_PID 2>/dev/null || true' EXIT

echo "Waiting for API..."
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8100/health > /dev/null 2>&1 && echo "API up after ${i}s" && break
  sleep 1
done

python -m pytest tests/e2e/ -v "$@"
