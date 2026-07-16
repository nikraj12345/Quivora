#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PYTHONPATH=.
export QUIVORA_TRAIN_FAST="${QUIVORA_TRAIN_FAST:-0}"
export QUIVORA_DATABASE_URL="${QUIVORA_DATABASE_URL:-postgresql+psycopg2://quivora:quivora@localhost:5434/quivora}"
export QUIVORA_REDIS_URL="${QUIVORA_REDIS_URL:-redis://localhost:6379/0}"

if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
python scripts/generate_seed.py
