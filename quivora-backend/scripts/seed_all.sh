#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH=.
export QUIVORA_DATABASE_URL="${QUIVORA_DATABASE_URL:-postgresql+psycopg2://quivora:quivora@localhost:5434/quivora}"
export QUIVORA_REDIS_URL="${QUIVORA_REDIS_URL:-redis://localhost:6379/0}"

if [ -d .venv ]; then
  source .venv/bin/activate
fi

python scripts/seed_all.py "$@"
