# Quivora — Implementation Plan (Approve Before Coding)

**Product:** Hospital queue ETA engine (Uber-style wait prediction for OPD)  
**Pilot:** 1 hospital · **10 named doctors** · **named patients** · **100 training consults per doctor**  
**Repos:** `quivora/` → `quivora-backend/` (Python) + `quivora-frontend/` (Next.js)

---

## 1. Product positioning

Quivora does **not** replace the hospital HIS.

| Hospital HIS owns | Quivora owns |
|---|---|
| Patient registration + contact (phone/WhatsApp) | Queue ordering |
| Appointments & tokens | Event timestamps (start/end) |
| Full patient PII / EMR | Duration learning from timing data + ETA |
| Billing | Live wait status for HIS / UI |
| (Later) may supply phone for notify | (Later) send WhatsApp/SMS using that contact |

**Integration model:** Hospital backend calls Quivora APIs with opaque IDs + age/token. Quivora returns queue position + ETA.

### Engine vs notifications — what data is required

| Capability | Needs phone / WhatsApp? | What Quivora needs |
|---|---|---|
| **Queue + ETA engine** | **No** | External IDs, doctor, token, age/age_band, type, start/end timestamps |
| **WhatsApp / SMS (later)** | **Yes** | Contact at send time (from HIS or notify payload) |

- Engine never depends on phone/address.
- **Demo seed may include doctor + patient display names** so the hospital UI feels real (names are for UI only; training math uses timing + age band).
- This build: engine + training simulator + hospital UI. Notifications remain todo.

---

## 2. In scope (this build)

- Docker Postgres on host port **5434**
- Docker **Redis** + background **job worker** for paced training jobs (see §4)
- Seed in Postgres: **1 hospital**, **10 doctors (with names)**, **patients (with names + ages)**
- **Start Training** flow in frontend: simulate **100 consultations per doctor** (10 × 100 = **1000** samples)
- Training driven by a **JSON dataset** + API enqueues a Redis-backed job (looped progress for UI)
- **~2 minute** training animation so progress is visible per doctor
- Algorithmic ETA (weighted averages + age bands) — **no ML**
- Continuous learning after bootstrap (every real `ended` event keeps training)
- Full hospital-style Next.js UI (not a bare admin form)
- Live queue + ETA after training
- Backend design owned by implementer (FastAPI structure, services, etc.)
- When build is approved: **agent writes all code + e2e tests**, runs servers, stops/fixes/retests until green (§16)

## 3. Out of scope (todo later)

- WhatsApp / SMS (needs phone when built)
- Real ML models
- Real HIS vendor adapters (APIs shaped for future integration)
- Multi-hospital SaaS / SSO / deep compliance
- Scan multi-hop journeys (OPD-only v1)

---

## 4. Infrastructure — Docker stack (Postgres 5434 + Redis + worker)

Everything needed for training/runtime runs via Docker Compose. Agent may add containers as useful.

```yaml
# docker-compose.yml (quivora root) — conceptual
services:
  db:
    image: postgres:16
    ports:
      - "5434:5432"    # host 5434 → container 5432
    environment:
      POSTGRES_USER: quivora
      POSTGRES_PASSWORD: quivora
      POSTGRES_DB: quivora
    volumes:
      - quivora_pg:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"    # job broker + progress pub/sub
    volumes:
      - quivora_redis:/data

  # api + worker + web added at build time
  # api: FastAPI
  # worker: Celery/RQ (or equivalent) consuming training jobs from Redis
  # web: Next.js
```

**Connection strings (local):**

```
Postgres: postgresql://quivora:quivora@localhost:5434/quivora
Redis:    redis://localhost:6379/0
```

### Why Redis + a job queue (BullMQ-style)

Training is **long-running (~2 min)** and must not block the API process.

| Piece | Role |
|---|---|
| **Redis** | Broker for training jobs; store/publish live progress for the UI |
| **Worker** | Background process that reads `training_consults.json`, inserts samples at paced delay, updates progress |
| **API** | `POST /v1/train/bootstrap` → enqueue job → return `job_id`; `GET /v1/train/status/{id}` reads progress from Redis/DB |

**Queue library (agent choice — same idea as BullMQ):**

- Backend is **Python**, so prefer **Celery** or **RQ** or **arq** on Redis (Python-native BullMQ equivalent).
- If useful later, a Node **BullMQ** worker is allowed — not required for v1.
- Pattern is fixed: **enqueue → worker runs paced train → progress in Redis → UI polls**.

`docker compose up -d db redis` gets persistence + broker ready.  
`QUIVORA_TRAIN_FAST=1` makes the worker skip pacing delays for e2e.

---

## 5. Seed data (names in Postgres)

On first boot / `POST /v1/admin/seed`:

| Entity | Count | Contents |
|---|---|---|
| Hospital | 1 | e.g. “Quivora General Hospital” |
| Doctors | **10** | Full display names + department (Cardiology, Pediatrics, General Medicine, Orthopedics, etc.) |
| Patients | **≥ 200** (recommend **1000** pool or reuse) | Full display names + age + age_band |

### Why names now?

- Engine math still does **not** need names.
- Hospital UI and training screen need names so it looks like a real OPD (doctor cards, patient feed during training).
- Production later: HIS can send `external_id` only; names optional for display.

### Seed files (backend)

```
quivora-backend/app/seed/
  doctors.json          # 10 doctors with names, departments
  patients.json         # named patients with ages
  training_consults.json  # 100 consults × 10 doctors (see §6)
```

---

## 6. Bootstrap training — “Start Training” (core demo)

### Goal

Before live OPD use, click **Start Training** once. System ingests **100 historical consultations per doctor** using **timing + age context only**, so each doctor has a usable baseline. Training **does not stop forever** after this — live `ended` events continue learning — but this button builds the first ~100 samples/doctor.

### Training JSON

File: `quivora-backend/app/seed/training_consults.json`  
(also copied/served for frontend reference if needed)

Shape (example):

```json
{
  "version": 1,
  "hospital": "Quivora General Hospital",
  "consults_per_doctor": 100,
  "doctors": [
    {
      "doctor_external_id": "DOC-001",
      "doctor_name": "Dr. Ananya Sharma",
      "department": "General Medicine",
      "consultations": [
        {
          "seq": 1,
          "patient_external_id": "PAT-0142",
          "patient_name": "Kabir Mehta",
          "age": 4,
          "age_band": "child_0_5",
          "appointment_type": "new",
          "duration_sec": 240,
          "hour_of_day": 9,
          "day_of_week": 1
        }
      ]
    }
  ]
}
```

- **10 doctors × 100 consultations** = **1000** records in JSON.
- Durations vary by age band and doctor “persona” (fast pediatrics vs slow complex adult clinic) so learning is visible.
- Names in JSON are for UI animation labels only; API persists timing fields into `duration_samples`.

### API for training

| Method | Path | Role |
|---|---|---|
| `POST /v1/train/bootstrap` | Accepts batch or loads server-side JSON; processes consults; returns job id | Start training |
| `GET /v1/train/status/{job_id}` | Progress: doctor index, consult index, %, current patient/doctor names, running avg | Drive UI |
| `POST /v1/train/bootstrap/stream` (optional) | Same work; SSE progress events | Smoother animation |

**Preferred UX flow:**

1. Frontend button **Start Training**
2. Frontend loads / uses training plan (or just calls bootstrap)
3. Either:
   - **A (recommended):** Backend runs the full job; frontend polls status every ~500ms–1s for **~2 minutes**, or  
   - **B:** Frontend loops 100×10 and `POST`s each consult (slower, more chatty)

**Plan decision: Option A + Redis worker** — `POST /v1/train/bootstrap` enqueues a job on Redis; a background worker processes 1000 samples at a paced rate (~2 minutes). Frontend polls status (from Redis/DB) and animates. API stays responsive.

Pacing example (inside worker):

```
total_duration_ms = 120_000
per_sample_delay_ms = 120_000 / 1000  # ~120ms
for each doctor:
  for each of 100 consults:
    insert duration_sample
    update rolling stats
    publish progress → Redis
    sleep(per_sample_delay_ms)  # skipped when QUIVORA_TRAIN_FAST=1
```

### What training writes

Each consult → one `duration_samples` row (+ optional synthetic `events` for audit).  
After each doctor’s 100 samples (or continuously), ETA predictor uses updated stats.

### Continuous learning after bootstrap

Live OPD `ended` events keep appending samples. Bootstrap is only the first bulk train.

---

## 7. How prediction works (algorithm only)

### 7.0 Continuous training

| Stage | What happens |
|---|---|
| Cold start | Defaults per age band until samples exist |
| Bootstrap | **Start Training** → ~100 consults/doctor from JSON |
| Ongoing | Every live `ended` consult keeps training — **never stops** |

Inputs: doctor, age_band, appointment_type, hour, weekday, duration_sec.  
Not used in math: phone, WhatsApp. Names optional for display.

### 7.1 Age bands

| Band | Ages |
|---|---|
| `child_0_5` | 0–5 |
| `child_6_12` | 6–12 |
| `teen_13_17` | 13–17 |
| `adult_18_40` | 18–40 |
| `adult_41_60` | 41–60 |
| `senior_60_plus` | 60+ |

Children often shorter routine visits; seniors often longer — **learned from data**, not permanently hardcoded (cold-start defaults only).

### 7.2 Duration estimate (weighted)

1. Doctor + age band — last hour  
2. Doctor + age band — today  
3. Doctor + age band — last 7 days  
4. Doctor baseline  
5. Department + age band default  

```
pred = 0.45 * last_hour + 0.25 * today + 0.20 * week_same_age + 0.10 * doctor_baseline
```

(renormalize if buckets missing)

### 7.3 Queue ETA

```
ETA = remaining(current) + sum(pred(each patient ahead))
```

Long consult → on end, everyone behind recalculates.

### 7.4 Confidence

Recent variance → `± X min` on UI.

---

## 8. Data model

| Entity | Key fields |
|---|---|
| `hospitals` | id, name |
| `doctors` | id, hospital_id, **name**, department, external_id |
| `patients` | id, external_id, **name**, age, age_band |
| `appointments` | external_id, doctor_id, patient_id, token, type, status, scheduled_at |
| `queue_entries` | appointment_id, status, position |
| `events` | type, appointment_id, timestamp |
| `duration_samples` | doctor_id, age_band, type, duration_sec, hour, weekday — **grows forever** |
| `predictions` | appointment_id, eta_at, confidence_min, algorithm_version |
| `train_jobs` | id, status, progress_pct, current_doctor, current_seq, started_at, finished_at |

**Engine** uses timing + age. **Names** are for hospital UI + training animation.

---

## 9. API surface

### Core (HIS-friendly)

- `POST /v1/appointments` — upsert appointment + token + age + doctor  
- `POST /v1/events` — `checked_in` \| `started` \| `ended` \| `no_show` \| `emergency_insert`  
- `GET /v1/doctors` — list doctors  
- `GET /v1/doctors/{id}/queue` — live queue  
- `GET /v1/appointments/{id}/eta` — ETA + confidence + patients ahead  

### Training / admin

- `POST /v1/admin/seed` — load doctors + patients (names) into Postgres  
- `POST /v1/train/bootstrap` — **enqueue** paced 100×10 training job on Redis; return `job_id`  
- `GET /v1/train/status/{job_id}` — progress from Redis/DB for UI  
- `GET /v1/train/stats` — per-doctor sample counts + avg duration by age band  
- `GET /health` — includes Postgres + Redis reachability when useful  

Auth (pilot): `X-API-Key` header.

---

## 10. Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12+, FastAPI (structure up to implementer) |
| ORM / migrations | SQLAlchemy + Alembic |
| DB | PostgreSQL 16 via Docker **host port 5434** |
| Job broker | **Redis 7** via Docker (port **6379**) |
| Training worker | **Celery or RQ or arq** on Redis (BullMQ-style jobs; agent picks) |
| Frontend | Next.js (App Router) + TypeScript |
| UI motion | CSS / Framer Motion for training + hospital polish |
| Compose | `db` (5434), `redis` (6379), `api`, `worker`, `web` |
| Tests | pytest e2e (ETA + train ingest); `QUIVORA_TRAIN_FAST=1` |

Agent may add any other Docker services if needed (e.g. Mailhog later) — free choice as long as Postgres stays on **5434**.

---

## 11. Repo layout

```
quivora/
  plan.md
  docker-compose.yml          # postgres:5434, redis:6379, api, worker, web
  quivora-backend/
    app/
      main.py
      api/
      models/
      schemas/
      services/               # queue, eta, learning, train_job
      worker/                 # Celery/RQ tasks (bootstrap training)
      seed/
        doctors.json
        patients.json
        training_consults.json  # 100 × 10 doctors
    alembic/
    tests/
      e2e/
    Dockerfile
    requirements.txt
  quivora-frontend/
    app/
    components/
    lib/api.ts
    Dockerfile
```

---

## 12. Frontend — hospital-complete UI

Look and feel: **real hospital ops console** (clean clinical product UI — not a generic purple SaaS template). Calm blues/teals, clear typography, OPD boards, readable on desktop.

### Screens

| Route | Purpose |
|---|---|
| `/` | Hospital home / status (seeded? trained? live queues summary) |
| `/training` | **Start Training** hero action + 2-minute live animation |
| `/opd` | Admin OPD board — 10 doctors, queue depth, avg times |
| `/reception` | Create appointment / token (simulates HIS) |
| `/room/[doctorId]` | Doctor room tablet — Start / End / No-show |
| `/patient/[appointmentId]` | Patient view — token + live ETA |
| `/doctors` | Doctor directory with learned averages after training |

### `/training` — animation requirements (important)

- Big primary CTA: **Start Training**
- On click: disable button, show “Training in progress”
- **Duration ≈ 2 minutes** total (backend paced)
- Visible progress:
  - Overall % bar (0 → 100%)
  - Current doctor name + department
  - “Consult 37 / 100” for that doctor
  - Scrolling feed of recent samples: patient name, age, duration
  - Per-doctor mini progress chips (10 doctors) filling as each completes 100
  - Live “learned avg” ticking up per doctor
- When done: success state → CTA to **Open OPD Board**
- Smooth motion (progress bar, feed items, doctor chips) — intentional, not noisy

### Other UI notes

- Rest of screens owned by implementer but must feel like one hospital product
- Show doctor + patient names from seed
- ETA as clock time + ± band after training
- Empty states before seed/train explaining next step

---

## 13. Two-day build phases

### Day 1 — Backend + seed + train API

| Phase | Work | Done when |
|---|---|---|
| **1A** | FastAPI + models + Alembic + Compose **db :5434** + **redis :6379** | DB + Redis up |
| **1B** | Seed doctors/patients **with names** + JSON files | Seed fills Postgres |
| **1C** | `training_consults.json` (100×10) + Redis worker job + status API (~2 min pace) | Curl enqueue + progress works |
| **1D** | Events + live ETA algorithm using samples | ETA works post-train |

### Day 2 — Hospital UI + polish

| Phase | Work | Done when |
|---|---|---|
| **2A** | Next.js hospital shell + `/training` 2-min animation | Training visible & polished |
| **2B** | OPD / reception / room / patient screens | Full demo path |
| **2C** | Edge cases, health, README, compose all services | `docker compose up` demo |

---

## 14. Success criteria (demo)

1. Postgres on **localhost:5434** + Redis on **6379**; seeded **named** doctors + patients.  
2. Click **Start Training** → job enqueued on Redis → UI animates ~**2 minutes** while **100×10** consults ingest.  
3. Progress shows doctor/patient names and running averages.  
4. After training, each doctor has ~100 `duration_samples`; OPD ETA uses learned timings (age-aware).  
5. Live End events continue training (does not stop at 100).  
6. Engine does not need phone; notification todo remains separate.  
7. UI feels like a complete hospital ops product.

---

## 15. Explicit decisions

- [x] Docker Postgres on **5434**  
- [x] Docker **Redis** + background **worker** for training (Celery/RQ/arq — BullMQ-style; agent picks)  
- [x] Seed **doctor names + patient names** in Postgres  
- [x] **Start Training** button → JSON-driven **100 patients per doctor** via queued job  
- [x] Training UI animation ≈ **2 minutes**  
- [x] Hospital-complete frontend (implementer designs screens)  
- [x] Backend structure owned by implementer; extra Docker services allowed as needed  
- [x] Engine: no phone required; notifications later need contact  
- [x] Continuous learning after bootstrap  
- [x] No ML / no WhatsApp in this phase  
- [x] Python FastAPI + Postgres + Next.js  
- [x] **Agent owns code + e2e + run/fix loop** (human does not write app code)  

---

## 16. Ownership — agent writes code, runs servers, owns E2E (locked)

**You (the human) will not write the application code.**  
**The agent writes everything and is responsible for making it work.**

| Task | Owner |
|---|---|
| Write backend + frontend + Docker + seed/JSON | **Agent** |
| Write **e2e tests** (and unit tests as needed) | **Agent** |
| Start Postgres (**Docker :5434**), Redis, worker, API, frontend | **Agent** |
| Run e2e against the live stack | **Agent** |
| If anything fails: **stop the server**, fix the code, restart, re-test | **Agent** |
| Repeat until e2e is green — no handoff of broken work | **Agent** |

In short: after you say to build, it is **completely on the agent** — code, test, fix loop included.

### E2E requirements (when build starts)

- Location: `quivora-backend/tests/e2e/` (API e2e); optional Playwright under `quivora-frontend/e2e/` for UI smoke
- Minimum coverage:
  1. Seed → 10 named doctors + named patients  
  2. Bootstrap training → 100×10 samples (`QUIVORA_TRAIN_FAST=1` for tests; UI demo still ~2 min)  
  3. Each doctor ≈ 100 `duration_samples`  
  4. Appointment → start → end → sample + ETA update  
  5. Health + train status endpoints (+ Redis worker job completes)  
- Loop: start services → run e2e → on fail stop/fix → re-run until green  
- Do not leave a broken server running after a failed loop

### Locked defaults

1. Thin `patients` table **with names + age** for demo UI  
2. Cold-start defaults: child ~6 min, adult ~10 min, senior ~12 min  
3. Docker Compose at `quivora/` root; **Postgres host port 5434**; **Redis 6379**  
4. Notifications later: contact from HIS at send time  
5. Training: Redis-backed worker job + frontend polling; fast mode for e2e  
6. **Agent owns all code + e2e + run/fix until green**  
7. Agent may use Celery, RQ, arq, or BullMQ — whatever fits; Redis is required

---

## 17. Status

**Implemented (v0.1 pilot).** Run:

```bash
./scripts/start-backend.sh
cd quivora-frontend && npm run dev
```

E2E: `./scripts/run-e2e.sh`

**Note:** If ports 5434/6379 are already in use, Quivora uses the existing Postgres/Redis instances (create `quivora` DB + role as in README).