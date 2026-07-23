# Quivora — Production Readiness Plan

**Status:** Draft — approve before implementation  
**Audience:** Engineering + hospital pilot stakeholders  
**Current baseline:** v0.1 pilot (FastAPI + Postgres + Redis/Celery + Next.js)  
**Goal:** Safely run Quivora for a real hospital with real patients, payments, and uptime expectations.

---

## 1. Executive summary

Quivora is production-capable as a **queue + ETA engine**, but several areas are still **demo-grade**:

| Area | Today | Required for production |
|------|--------|-------------------------|
| Authentication | Single shared `X-API-Key`, exposed in browser | Role-based auth, hospital-scoped access |
| Patient data | Many read APIs are public | Authenticated, hospital-scoped reads |
| Payments | Mock UPI QR in frontend only | Razorpay/Cashfree + webhook + DB records |
| Deployment | Local scripts, DB/Redis compose only | Containerized app + managed infra + CI/CD |
| Database | `create_all` + ad-hoc `db_migrate.py` | Versioned Alembic migrations |
| Admin tools | `/v1/admin/seed` can wipe all data | Disabled or platform-admin only in prod |

**Recommended timeline:** 4–5 weeks to pilot-ready production, assuming 1 engineer full-time.

---

## 2. Production definition

### 2.1 In scope (pilot production)

- One or more hospitals on shared Quivora SaaS
- Hospital staff: reception booking, doctor room, hospital console (fees, schedules)
- Patient self-registration via hospital QR / link
- Same-day consultation fee collection (UPI + pay-at-desk)
- Live queue, ETA, insights dashboard
- SMS/Telegram notifications (optional but recommended)
- 99.5% uptime target, daily DB backups, error monitoring

### 2.2 Out of scope (post-pilot)

- Full HIS/EMR replacement
- Multi-region deployment
- Advanced ML models
- Full DPDP/legal compliance audit (basic safeguards only in pilot)
- Scan journey billing integrations beyond current scope

### 2.3 Success criteria

1. No patient PII accessible without authentication.
2. API key / admin secrets never shipped to the browser.
3. Payment status is server-verified (webhook), not client-click only.
4. Deploy is repeatable: `git push` → staging → smoke tests → production.
5. Database can be restored from backup within 1 hour.
6. One hospital can operate a full OPD day without manual DB fixes.

---

## 3. Current architecture gaps

### 3.1 Security

- `NEXT_PUBLIC_API_KEY` in frontend — **any user can extract the key from DevTools**.
- `main.py` sets `allow_origins=["*"]` — ignores `QUIVORA_CORS_ORIGINS`.
- Public endpoints expose sensitive data:
  - `GET /v1/patients`, `GET /v1/patients/search`
  - `GET /v1/appointments/{id}`, `GET /v1/doctors/{ref}/queue`
  - `GET /v1/hospitals/{ref}/patients/by-phone`
- Single global API key — no per-hospital or per-role isolation.
- `POST /v1/admin/seed?reset=true` can destroy all data.

### 3.2 Payments

- Payment UI is frontend-only (`MockPaymentQr`, client-side “Payment successful”).
- No `payments` table, no provider integration, no reconciliation.
- Doctor fees are used for display but not persisted on the appointment at booking time.

### 3.3 Infrastructure

- No Dockerfiles for API, worker, or frontend.
- `docker-compose.yml` only runs Postgres + Redis (`full` profile).
- No GitHub Actions / CI pipeline.
- No staging environment separation.
- Logs go to `/tmp/quivora-*.log` via shell scripts.

### 3.4 Data & migrations

- Alembic listed in `requirements.txt` but not initialized.
- Schema changes rely on `Base.metadata.create_all()` at startup + `db_migrate.py`.
- Risky for zero-downtime deploys and rollbacks.

---

## 4. Target production architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                  │
│  Browser (ops/reception) │ Doctor room tablet │ Patient mobile  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
┌────────────────────────────▼────────────────────────────────────┐
│  CDN / TLS (Cloudflare or provider edge)                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Next.js (quivora-frontend)                                      │
│  - App UI                                                        │
│  - BFF API routes (/api/*) — holds secrets, issues session JWT   │
└────────────────────────────┬────────────────────────────────────┘
                             │ server-to-server
┌────────────────────────────▼────────────────────────────────────┐
│  FastAPI (quivora-backend)                                       │
│  - REST /v1/*                                                    │
│  - Auth middleware (JWT + hospital scope)                        │
│  - Payment webhooks (Razorpay)                                   │
└──────┬──────────────────────────────┬───────────────────────────┘
       │                              │
┌──────▼──────┐                ┌──────▼──────┐
│  Postgres   │                │   Redis     │
│  (managed)  │                │  (managed)  │
└─────────────┘                └──────┬──────┘
                                      │
                               ┌──────▼──────┐
                               │   Celery    │
                               │   worker    │
                               └─────────────┘

External: Razorpay/Cashfree · Fast2SMS (DLT) · Telegram · Sentry
```

### 4.1 Recommended hosting (pick one stack)

| Component | Option A (fastest) | Option B (AWS) |
|-----------|-------------------|----------------|
| Frontend | Vercel | CloudFront + S3 or ECS |
| API | Railway / Fly.io | ECS Fargate or App Runner |
| Worker | Same as API host | ECS Fargate |
| Postgres | Neon / Supabase / Railway | RDS PostgreSQL |
| Redis | Upstash | ElastiCache |
| Secrets | Vercel + Railway env | AWS Secrets Manager |
| DNS/TLS | Cloudflare | Route 53 + ACM |

**Decision needed:** Choose stack before Phase 2 deploy work.

---

## 5. Implementation phases

### Phase 1 — Security & access control (Week 1)

**Priority: P0 — block production without this**

#### 1A. Authentication model

| Role | Access | Method |
|------|--------|--------|
| Platform admin | All hospitals, seed (staging only), insights | Email + password or SSO |
| Hospital admin | One hospital: doctors, fees, departments, settings | Hospital login |
| Reception / ops | Book patients, view queue, mark cash collected | Hospital staff login |
| Doctor room | Start/end consult, break, running late | PIN or staff login scoped to doctor |
| Patient | Self check-in, view own token/ETA | Phone OTP or token link (no admin API) |
| HIS integration | Server-to-server appointment/events | Per-hospital API key (backend only) |

#### 1B. Backend auth middleware

- [ ] Add `users`, `hospital_memberships`, `sessions` (or JWT claims) tables
- [ ] Replace `require_api_key` with layered dependencies:
  - `require_auth` — valid session/JWT
  - `require_hospital_access(hospital_id)` — membership check
  - `require_platform_admin` — admin routes only
- [ ] Per-hospital API keys for HIS: stored hashed, rotatable, scoped to hospital
- [ ] Audit log table for sensitive actions (fee edit, priority override, go-live, seed)

#### 1C. Remove secrets from frontend

- [ ] Delete `NEXT_PUBLIC_API_KEY` usage
- [ ] Add Next.js Route Handlers under `src/app/api/` as BFF:
  - Attach session cookie / JWT
  - Proxy to FastAPI with server-side service key or user token
- [ ] Patient-facing flows use limited-scope tokens (appointment id + short code)

#### 1D. Lock down public endpoints

Mark as **authenticated** (minimum hospital staff):

- `GET /v1/patients`, `GET /v1/patients/search`
- `GET /v1/appointments/{id}` (except patient token link)
- `GET /v1/doctors/{ref}/queue`, `GET /v1/doctors/{ref}/schedule`
- `GET /v1/hospitals/{ref}/patients/by-phone`

Keep public (with rate limits):

- `GET /health`
- `GET /v1/hospitals` (list for booking — consider slug-only public catalog)
- `GET /v1/hospitals/{ref}/availability`
- `GET /v1/doctors/{ref}/availability`
- `POST /v1/hospitals/{ref}/self-checkin` (OTP + rate limit)

#### 1E. Production guards

- [ ] `QUIVORA_ENV=production` flag
- [ ] When production: disable `POST /v1/admin/seed` and seed-insights
- [ ] Hide admin re-seed UI unless `NODE_ENV=development` or platform admin on staging
- [ ] Fix CORS: use `settings.cors_origin_list`, never `*`

**Done when:** Pen test / manual check confirms no PII or admin actions without auth.

---

### Phase 2 — Real payments (Week 2)

**Priority: P0 for same-day billing**

#### 2A. Data model

```sql
-- conceptual
payments (
  id, appointment_id, hospital_id,
  amount_paise, currency,
  fee_type,              -- consultation | follow_up | scan
  fee_snapshot_json,     -- doctor fee at time of booking
  status,                -- created | paid | failed | pending_cash | refunded
  method,                -- upi | card | cash
  provider,              -- razorpay | cash
  provider_order_id,
  provider_payment_id,
  created_at, paid_at
)

appointments (
  ... existing ...
  payment_status,        -- unpaid | paid | pending_cash | waived
  amount_due_paise
)
```

- [ ] Snapshot `consultation_fee` / `follow_up_fee` on appointment at create time
- [ ] Future-date appointments: `payment_status = waived` until day-of (optional reminder)

#### 2B. Razorpay integration (recommended for India)

- [ ] `POST /v1/appointments/{id}/payments/create-order` — returns order id + amount
- [ ] Frontend: Razorpay Checkout instead of `MockPaymentQr`
- [ ] `POST /v1/payments/webhook` — verify signature, idempotent update
- [ ] `POST /v1/appointments/{id}/payments/mark-cash-collected` — reception only
- [ ] Receipt reference stored and shown on token confirm screen

#### 2C. Frontend payment flow

- [ ] Remove client-only “Payment successful” without server confirmation
- [ ] Poll payment status or use webhook + SSE/poll until `paid`
- [ ] Pay-at-desk: token issued, `pending_cash` until reception marks collected
- [ ] Hospital console: list pending cash payments for today

**Done when:** Test payment in Razorpay sandbox completes end-to-end; cash flow auditable.

---

### Phase 3 — Deployment & data (Week 3)

**Priority: P0**

#### 3A. Dockerize services

- [ ] `quivora-backend/Dockerfile` — gunicorn + uvicorn workers
- [ ] `quivora-backend/Dockerfile.worker` — Celery
- [ ] `quivora-frontend/Dockerfile` — Next.js `output: 'standalone'`
- [ ] Extend `docker-compose.yml`:
  - `api`, `worker`, `web` services
  - Healthchecks, restart policies
  - Non-root users in containers

#### 3B. Environment configuration

| Variable | Staging | Production |
|----------|---------|------------|
| `QUIVORA_ENV` | staging | production |
| `QUIVORA_DATABASE_URL` | staging DB | prod DB (secret) |
| `QUIVORA_API_KEY` | staging service key | prod service key (BFF only) |
| `QUIVORA_CORS_ORIGINS` | staging URL | prod URL |
| `RAZORPAY_KEY_ID` | test | live |
| `RAZORPAY_KEY_SECRET` | test | live (secret) |
| `RAZORPAY_WEBHOOK_SECRET` | test | live (secret) |

- [ ] `.env.example` updated for all new vars
- [ ] No secrets in git; document secret rotation procedure

#### 3C. Alembic migrations

- [ ] `alembic init` + baseline migration from current models
- [ ] Remove `create_all()` from production startup (migrations only)
- [ ] Keep `db_migrate.py` only as one-time bridge, then deprecate
- [ ] Deploy step: `alembic upgrade head` before starting API

#### 3D. Managed Postgres + Redis

- [ ] Provision managed Postgres (daily backups, 7–30 day retention)
- [ ] Provision managed Redis
- [ ] Connection pooling if needed (PgBouncer)
- [ ] Run backup restore drill once

#### 3E. Staging environment

- [ ] `staging.quivora.app` + `api-staging.quivora.app`
- [ ] Razorpay test mode
- [ ] Synthetic data only; seed allowed on staging

**Done when:** `docker compose up` or platform deploy brings full stack green; staging mirrors prod.

---

### Phase 4 — CI/CD, observability, hardening (Week 4)

**Priority: P1**

#### 4A. GitHub Actions CI

```yaml
# on pull_request and push to main
jobs:
  backend-test:  pytest (unit + e2e with test DB)
  frontend-check: lint, tsc, build
  optional: docker build smoke
```

- [ ] Branch protection: require CI green before merge
- [ ] Auto-deploy staging on merge to `main`
- [ ] Manual approval gate for production deploy

#### 4B. Observability

- [ ] Structured JSON logging (request_id, hospital_id, user_id)
- [ ] Sentry for API + frontend
- [ ] Uptime monitor on `/health` (DB + Redis checks)
- [ ] Alerts: 5xx rate, health fail, worker down, payment webhook failures

#### 4C. Rate limiting & abuse

- [ ] Rate limit patient lookup by phone (e.g. 10/min/IP)
- [ ] Rate limit self-check-in and appointment create
- [ ] Cloudflare or middleware (slowapi / redis-backed)

#### 4D. SMS / notifications (production)

- [ ] Fast2SMS: move from Quick route to DLT-registered templates (India)
- [ ] Telegram: optional per-hospital bot config
- [ ] Appointment reminders: day-before + 2 hours before (Celery beat)

**Done when:** On-call can diagnose an incident from logs/Sentry; CI blocks broken deploys.

---

### Phase 5 — Pilot launch & compliance basics (Week 5)

**Priority: P1**

#### 5A. Hospital onboarding checklist

- [ ] Create hospital + admin user
- [ ] Enroll doctors, set fees and schedules
- [ ] Run training/bootstrap (or import history) on staging first
- [ ] Configure Razorpay sub-merchant or hospital settlement model
- [ ] Print QR codes pointing to production register URL
- [ ] Train reception on cash collection flow

#### 5B. Data privacy (India — practical minimum)

- [ ] Privacy policy + terms on register flow
- [ ] Consent checkbox for SMS/WhatsApp
- [ ] Data retention: auto-archive appointments older than N months
- [ ] Right to erasure process (manual v1: admin anonymize patient)
- [ ] Encrypt data at rest (managed DB) + TLS in transit
- [ ] Access audit for staff accounts

#### 5C. Runbook

Document in `docs/RUNBOOK.md`:

- Deploy procedure
- Rollback procedure
- Restore from backup
- Rotate API keys / Razorpay secrets
- Handle payment webhook failures
- Scale worker concurrency

#### 5D. Load & soak test (light)

- [ ] 50 concurrent bookings
- [ ] 10 doctors live with 200 queue items
- [ ] ETA endpoint p95 < 500ms

**Done when:** One hospital completes a real OPD day on production.

---

## 6. API changes summary

### New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/auth/login` | Staff login |
| POST | `/v1/auth/logout` | Invalidate session |
| GET | `/v1/auth/me` | Current user + hospitals |
| POST | `/v1/appointments/{id}/payments/create-order` | Razorpay order |
| POST | `/v1/payments/webhook` | Provider webhook |
| POST | `/v1/appointments/{id}/payments/mark-cash-collected` | Reception |
| GET | `/v1/hospitals/{ref}/payments/pending-cash` | Today's desk queue |

### Endpoints to restrict in production

| Method | Path | Production rule |
|--------|------|-----------------|
| POST | `/v1/admin/seed` | Disabled |
| POST | `/v1/admin/seed-insights/{ref}` | Platform admin, staging only |
| GET | `/v1/patients` | Hospital staff auth |
| GET | `/v1/patients/search` | Hospital staff auth |

---

## 7. Frontend changes summary

| Area | Change |
|------|--------|
| `src/lib/api.ts` | Remove `NEXT_PUBLIC_API_KEY`; call `/api/*` BFF |
| `src/app/api/` | New route handlers for auth + proxied API |
| `src/app/register/page.tsx` | Razorpay checkout; poll payment status |
| `src/app/admin/page.tsx` | Hide seed on production |
| `src/app/hospital/[id]/page.tsx` | Pending cash payments panel |
| Auth UI | Login page for staff; session persistence |

---

## 8. Testing strategy

### 8.1 Automated

| Suite | Coverage |
|-------|----------|
| Unit | Auth helpers, payment amount snapshot, webhook signature verify |
| API e2e | Login → book → pay (mock provider) → confirm |
| Existing e2e | Keep green with `QUIVORA_TRAIN_FAST=1` |
| Frontend | `tsc`, `eslint`, `build` in CI |

### 8.2 Manual pre-launch checklist

- [ ] Staff login/logout works; cannot access other hospital data
- [ ] Patient cannot call admin APIs from browser
- [ ] Same-day booking: UPI payment completes in Razorpay test
- [ ] Pay-at-desk: reception marks collected
- [ ] Doctor room: start/end updates ETA for waiting patients
- [ ] Fee edit on hospital console reflects on next booking
- [ ] Backup restore tested
- [ ] Seed endpoint returns 403 on production

---

## 9. Rollout strategy

```
Development (local)
    ↓ merge to main
Staging (auto-deploy, test keys, seed allowed)
    ↓ manual promote after checklist
Production (live keys, seed disabled, real hospital)
```

**Pilot:** Start with **one hospital**, **limited hours**, **platform team on standby** for first 3 OPD days.

**Rollback:** Keep previous Docker image tagged; DB migrations must be backward-compatible or have down migrations for critical releases.

---

## 10. Effort estimate

| Phase | Focus | Estimate |
|-------|--------|----------|
| 1 | Auth + API lockdown + BFF | 5–7 days |
| 2 | Payments (Razorpay) | 4–5 days |
| 3 | Docker + migrations + staging | 4–5 days |
| 4 | CI/CD + monitoring | 3–4 days |
| 5 | Pilot prep + docs | 3–4 days |
| **Total** | | **~4–5 weeks** |

Parallelizable: Phase 3 infra can start while Phase 2 payments is in progress.

---

## 11. Decisions required (approve before build)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Hosting stack | Vercel+Railway vs AWS | Vercel+Railway for fastest pilot |
| 2 | Payment provider | Razorpay vs Cashfree | Razorpay (broad UPI support) |
| 3 | Staff auth | Custom JWT vs Clerk/Auth0 | Custom JWT for pilot; Clerk if faster |
| 4 | Patient auth | OTP only vs magic link | Phone OTP for India |
| 5 | Settlement | Platform collects vs hospital Razorpay account | Hospital-linked account for pilot |
| 6 | Domain | `app.quivora.in` etc. | Decide before TLS setup |

---

## 12. File / repo additions (planned)

```
quivora/
  PRODUCTION-PLAN.md          ← this document
  docker-compose.prod.yml     ← full stack
  docs/
    RUNBOOK.md
    DEPLOY.md
  .github/workflows/
    ci.yml
    deploy-staging.yml
  quivora-backend/
    Dockerfile
    Dockerfile.worker
    alembic/
    app/
      auth/                   ← middleware, deps, models
      payments/               ← razorpay service, webhook
  quivora-frontend/
    Dockerfile
    src/app/api/              ← BFF routes
    src/app/login/
```

---

## 13. Status tracker

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Security | Not started | |
| Phase 2 — Payments | Not started | Mock UI exists |
| Phase 3 — Deploy & DB | Not started | Compose DB/Redis only |
| Phase 4 — CI/CD & ops | Not started | |
| Phase 5 — Pilot launch | Not started | |

---

## 14. References

- Existing pilot plan: `plan.md`
- Backend config: `quivora-backend/app/config.py`
- API auth today: `quivora-backend/app/api/routes.py` (`require_api_key`)
- Mock payment UI: `quivora-frontend/src/app/register/page.tsx`
- Doctor fees (recent): hospital console + `consultation_fee` / `follow_up_fee` on Doctor model

---

**Next step:** Review §11 decisions, then approve Phase 1 implementation.
