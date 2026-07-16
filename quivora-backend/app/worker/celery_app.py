from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from celery import Celery
from sqlalchemy import select, text

from app.config import settings
from app.db import SessionLocal
from app.models import Doctor, DurationSample, TrainJob, TrainJobStatus
from app.services.seed import load_training_json

celery_app = Celery("quivora", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.task_track_started = True
celery_app.conf.worker_hijack_root_logger = False


def _redis():
    import redis
    return redis.from_url(settings.redis_url, decode_responses=True)


def publish_progress(job_id: str, payload: Dict[str, Any]) -> None:
    r = _redis()
    r.set(f"quivora:train:{job_id}", json.dumps(payload), ex=3600)


def _update_job_raw(db, job_id: str, **fields) -> None:
    """
    Update train_jobs using a raw UPDATE statement.
    Avoids ORM session-level row locks that cause deadlocks when two tasks race.
    """
    if not fields:
        return
    set_parts = ", ".join(f"{k} = :{k}" for k in fields)
    db.execute(text(f"UPDATE train_jobs SET {set_parts} WHERE id = :__id"), {**fields, "__id": job_id})
    db.commit()


def create_train_job(db) -> TrainJob:
    job_id = str(uuid.uuid4())
    data = load_training_json()
    doctors = data["doctors"]
    per = int(data.get("consults_per_doctor", 100))
    doctor_progress = {
        d["doctor_external_id"]: {
            "name": d["doctor_name"],
            "department": d["department"],
            "done": 0,
            "total": per,
            "avg_sec": None,
        }
        for d in doctors
    }
    job = TrainJob(
        id=job_id,
        status=TrainJobStatus.pending,
        progress_pct=0.0,
        consults_per_doctor=per,
        doctors_total=len(doctors),
        samples_total=per * len(doctors),
        doctor_progress_json=json.dumps(doctor_progress),
        recent_feed_json=json.dumps([]),
    )
    db.add(job)
    db.commit()
    return job


# How many samples to insert before a DB flush (reduces commit frequency)
_BATCH_SIZE = 10
# How often to publish Redis progress updates (every N samples)
_PUBLISH_EVERY = 5


@celery_app.task(name="quivora.run_bootstrap_training")
def run_bootstrap_training(job_id: str, fast: Optional[bool] = None) -> Dict[str, Any]:
    db = SessionLocal()
    try:
        # ── Claim the job with SELECT FOR UPDATE SKIP LOCKED ──────────────────
        # If another worker already holds the lock, abort immediately.
        row = db.execute(
            text("SELECT id, status FROM train_jobs WHERE id = :id FOR UPDATE SKIP LOCKED"),
            {"id": job_id},
        ).fetchone()
        if not row:
            # Another worker grabbed it — exit silently
            return {"job_id": job_id, "status": "skipped", "reason": "duplicate task"}

        job = db.get(TrainJob, job_id)
        if not job:
            return {"error": "job not found"}

        # Mark running via raw SQL to avoid ORM tracking conflicts
        _update_job_raw(db, job_id,
            status="running",
            started_at=datetime.now(timezone.utc).isoformat(),
        )
        # Re-fetch so ORM object is clean
        db.expire(job)
        job = db.get(TrainJob, job_id)

        data = load_training_json()
        doctors = data["doctors"]
        per = int(data.get("consults_per_doctor", 100))
        total = per * len(doctors)
        use_fast = settings.train_fast if fast is None else bool(fast)
        delay = 0.0 if use_fast else (settings.train_total_seconds / max(total, 1))

        doctor_progress = json.loads(job.doctor_progress_json or "{}")
        recent_feed: list = []
        samples_done = 0
        pending_samples: list = []

        for doc_block in doctors:
            ext = doc_block["doctor_external_id"]
            doctor = db.execute(
                select(Doctor).where(Doctor.external_id == ext)
            ).scalar_one_or_none()
            if not doctor:
                raise RuntimeError(f"Doctor missing: {ext}")
            doctor_pk = doctor.id

            durations_acc: list[int] = []

            for consult in doc_block["consultations"]:
                pending_samples.append(DurationSample(
                    doctor_id=doctor_pk,
                    age_band=consult["age_band"],
                    appointment_type=consult["appointment_type"],
                    duration_sec=int(consult["duration_sec"]),
                    hour_of_day=int(consult["hour_of_day"]),
                    day_of_week=int(consult["day_of_week"]),
                    source="bootstrap",
                ))
                durations_acc.append(int(consult["duration_sec"]))
                samples_done += 1

                avg_sec = sum(durations_acc) / len(durations_acc)
                doctor_progress[ext]["done"] = consult["seq"]
                doctor_progress[ext]["avg_sec"] = round(avg_sec, 1)

                feed_item = {
                    "doctor_name": doc_block["doctor_name"],
                    "patient_name": consult["patient_name"],
                    "age": consult["age"],
                    "duration_sec": consult["duration_sec"],
                    "seq": consult["seq"],
                }
                recent_feed = ([feed_item] + recent_feed)[:12]

                # Flush DurationSample rows in batches — avoids 4000 individual commits
                if len(pending_samples) >= _BATCH_SIZE:
                    for s in pending_samples:
                        db.add(s)
                    db.flush()
                    pending_samples = []

                # Update job progress via raw SQL every N samples
                if samples_done % _PUBLISH_EVERY == 0 or samples_done == total:
                    pct = round(100.0 * samples_done / total, 2)
                    doctors_done = sum(1 for v in doctor_progress.values() if v["done"] >= per)
                    _update_job_raw(db, job_id,
                        progress_pct=pct,
                        current_doctor_name=doc_block["doctor_name"],
                        current_doctor_external_id=ext,
                        current_department=doc_block["department"],
                        current_patient_name=consult["patient_name"],
                        current_seq=int(consult["seq"]),
                        samples_done=samples_done,
                        doctors_done=doctors_done,
                        doctor_progress_json=json.dumps(doctor_progress),
                        recent_feed_json=json.dumps(recent_feed),
                    )
                    publish_progress(job_id, {
                        "job_id": job_id,
                        "status": "running",
                        "progress_pct": pct,
                        "current_doctor_name": doc_block["doctor_name"],
                        "current_doctor_external_id": ext,
                        "current_department": doc_block["department"],
                        "current_patient_name": consult["patient_name"],
                        "current_seq": int(consult["seq"]),
                        "consults_per_doctor": per,
                        "doctors_total": len(doctors),
                        "doctors_done": doctors_done,
                        "samples_done": samples_done,
                        "samples_total": total,
                        "doctor_progress": doctor_progress,
                        "recent_feed": recent_feed,
                    })

                if delay > 0:
                    time.sleep(delay)

        # Flush any remaining samples
        for s in pending_samples:
            db.add(s)
        if pending_samples:
            db.flush()

        doctors_done_final = sum(1 for v in doctor_progress.values() if v["done"] >= per)
        _update_job_raw(db, job_id,
            status="completed",
            progress_pct=100.0,
            samples_done=total,
            doctors_done=doctors_done_final,
            doctor_progress_json=json.dumps(doctor_progress),
            recent_feed_json=json.dumps(recent_feed),
            finished_at=datetime.now(timezone.utc).isoformat(),
        )

        final_payload = {
            "job_id": job_id,
            "status": "completed",
            "progress_pct": 100.0,
            "current_doctor_name": doctor_progress and list(doctor_progress.values())[-1].get("name"),
            "current_doctor_external_id": list(doctor_progress.keys())[-1] if doctor_progress else None,
            "current_department": doctor_progress and list(doctor_progress.values())[-1].get("department"),
            "current_patient_name": recent_feed[0]["patient_name"] if recent_feed else None,
            "current_seq": per,
            "consults_per_doctor": per,
            "doctors_total": len(doctors),
            "doctors_done": doctors_done_final,
            "samples_done": total,
            "samples_total": total,
            "doctor_progress": doctor_progress,
            "recent_feed": recent_feed,
        }
        publish_progress(job_id, final_payload)
        return {"job_id": job_id, "status": "completed", "samples": total}

    except Exception as e:
        try:
            db.rollback()
            _update_job_raw(db, job_id,
                status="failed",
                error_message=str(e)[:500],
                finished_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception:
            pass
        publish_progress(job_id, {"job_id": job_id, "status": "failed", "error_message": str(e)})
        raise
    finally:
        db.close()
