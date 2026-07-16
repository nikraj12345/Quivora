# Quivora

Hospital queue ETA engine — Python FastAPI + Postgres + Redis/Celery + Next.js.

## Prerequisites

- Docker (Postgres on **localhost:5434**, Redis on **6379** — may already exist on your machine)
- Python 3.9+
- Node 18+

## Database setup (if `quivora` DB does not exist on :5434)

```bash
docker exec -it <your-postgres-container> psql -U <admin> -d <admin_db> -c \
  "CREATE ROLE quivora LOGIN PASSWORD 'quivora'; CREATE DATABASE quivora OWNER quivora;"
```

Or use dedicated containers: `docker compose --profile full up -d` (when ports are free).

## Backend

```bash
cd quivora-backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PYTHONPATH=.
export QUIVORA_DATABASE_URL=postgresql+psycopg2://quivora:quivora@localhost:5434/quivora
export QUIVORA_REDIS_URL=redis://localhost:6379/0

# Terminal 1 — API
uvicorn app.main:app --host 127.0.0.1 --port 8100

# Terminal 2 — Celery worker
celery -A app.worker.celery_app.celery_app worker --loglevel=info --concurrency=1
```

## Frontend

```bash
cd quivora-frontend
npm install
npm run dev
```

Open http://localhost:3000

## E2E tests

```bash
# API + worker must be running
cd quivora-backend
source .venv/bin/activate
export QUIVORA_API_BASE=http://127.0.0.1:8100
pytest tests/e2e -v
```

Training in e2e uses `?fast=true` (~seconds). UI demo uses paced ~2 minutes.

## API highlights

| Endpoint | Description |
|---|---|
| `POST /v1/admin/seed` | 10 doctors + 1000 patients |
| `POST /v1/train/bootstrap?fast=false` | Enqueue 100×10 training job |
| `GET /v1/train/status/{job_id}` | Training progress |
| `POST /v1/appointments` | Create token |
| `POST /v1/events` | check-in / start / end / no_show |
| `GET /v1/appointments/{id}/eta` | Live ETA |

Header: `X-API-Key: quivora-dev-key`
