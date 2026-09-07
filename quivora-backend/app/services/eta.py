from __future__ import annotations

import statistics
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models import (
    Appointment,
    AppointmentStatus,
    DurationSample,
    Prediction,
    PRIORITY_RANK,
)
from app.services.age_bands import DEFAULT_DURATION_BY_BAND


OUTLIER_CAP_SEC = 45 * 60  # for learning only


def _avg(values: List[int]) -> Optional[float]:
    if not values:
        
        return None
    return float(statistics.mean(values))


def _query_durations(
    db: Session,
    doctor_id: int,
    age_band: Optional[str],
    since: Optional[datetime],
    limit: int = 200,
) -> List[int]:
    q = select(DurationSample.duration_sec).where(DurationSample.doctor_id == doctor_id)
    if age_band:
        q = q.where(DurationSample.age_band == age_band)
    if since:
        q = q.where(DurationSample.created_at >= since)
    q = q.order_by(DurationSample.created_at.desc()).limit(limit)
    return [r[0] for r in db.execute(q).all()]


def predict_duration_sec(
    db: Session,
    doctor_id: int,
    age_band: str,
    now: Optional[datetime] = None,
) -> Tuple[int, float]:
    """Weighted blend + confidence — optimized single-query execution."""
    now = now or datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    
    # Query all duration samples for this doctor from the past week in a single query
    samples = db.execute(
        select(DurationSample.duration_sec, DurationSample.age_band, DurationSample.created_at)
        .where(
            DurationSample.doctor_id == doctor_id,
            DurationSample.created_at >= week_ago,
        )
        .order_by(DurationSample.created_at.desc())
        .limit(300)
    ).all()

    if not samples:
        pred = float(DEFAULT_DURATION_BY_BAND.get(age_band, 10 * 60))
        return int(round(pred)), 12.0

    last_hour_strt = now - timedelta(hours=1)
    today_strt = now.replace(hour=0, minute=0, second=0, microsecond=0)

    last_hour = [s[0] for s in samples if s[1] == age_band and s[2] >= last_hour_strt]
    today = [s[0] for s in samples if s[1] == age_band and s[2] >= today_strt]
    week = [s[0] for s in samples if s[1] == age_band]
    doctor_all = [s[0] for s in samples]

    buckets = [
        (0.45, _avg(last_hour)),
        (0.25, _avg(today)),
        (0.20, _avg(week)),
        (0.10, _avg(doctor_all)),
    ]
    weight_sum = 0.0
    value_sum = 0.0
    for w, v in buckets:
        if v is not None:
            weight_sum += w
            value_sum += w * v

    if weight_sum == 0:
        pred = float(DEFAULT_DURATION_BY_BAND.get(age_band, 10 * 60))
        confidence = 12.0
    else:
        pred = value_sum / weight_sum
        recent = last_hour or today or week or doctor_all
        if len(recent) >= 2:
            confidence = max(5.0, min(20.0, statistics.pstdev(recent) / 60.0))
        else:
            confidence = 10.0

    return int(round(pred)), confidence


def remaining_for_in_progress(appt: Appointment, predicted: int, now: datetime) -> int:
    if not appt.started_at:
        return predicted
    started = appt.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    elapsed = int((now - started).total_seconds())
    return max(30, predicted - elapsed)  # at least 30s remaining guess


def recompute_doctor_queue_etas(db: Session, doctor_id: int) -> None:
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from app.models import Doctor as DoctorModel, Hospital, SLOT_ORDER
    from app.services.queue import session_day_bounds_utc

    doctor = db.get(DoctorModel, doctor_id)
    doctor_live = doctor.is_live if doctor else False
    active_slot = doctor.active_slot if doctor else None

    now = datetime.now(timezone.utc)
    hospital = db.get(Hospital, doctor.hospital_id) if doctor else None
    day_start, day_end = session_day_bounds_utc(hospital, now)

    appts = (
        db.execute(
            select(Appointment)
            .where(
                Appointment.doctor_id == doctor_id,
                Appointment.status.in_(
                    [
                        AppointmentStatus.scheduled,
                        AppointmentStatus.checked_in,
                        AppointmentStatus.in_progress,
                    ]
                ),
                Appointment.scheduled_at >= day_start,
                Appointment.scheduled_at < day_end,
            )
        )
        .scalars()
        .all()
    )
    # In-progress first, then priority, then token
    appts = sorted(
        appts,
        key=lambda a: (
            0 if a.status == AppointmentStatus.in_progress else 1,
            PRIORITY_RANK.get(getattr(a, "priority", None) or "normal", 3),
            a.token,
        ),
    )

    # Pre-fetch existing predictions in one query to check prev_ahead safely
    appt_ids = [a.id for a in appts]
    existing_preds: dict[int, Prediction] = {}
    if appt_ids:
        rows = db.execute(
            select(Prediction).where(Prediction.appointment_id.in_(appt_ids))
        ).scalars().all()
        existing_preds = {p.appointment_id: p for p in rows}

    # Group by slot — each slot is its own queue (preserve priority order within slot)
    by_slot: dict[str, list] = {}
    for appt in appts:
        by_slot.setdefault(appt.slot or "morning", []).append(appt)

    from app.services.time_utils import hospital_zone

    SLOT_START_HOUR = {
        "morning": 9,
        "afternoon": 13,
        "evening": 17,
    }

    tz = hospital_zone(hospital) if hospital else timezone.utc
    local_now = now.astimezone(tz)
    upsert_rows: list[dict] = []
    pred_cache: dict[str, Tuple[int, float]] = {}

    for slot, slot_appts in by_slot.items():
        # ETAs when doctor is live for this slot (break adds extra wait, does not hide ETAs)
        slot_live = doctor_live and (active_slot is None or active_slot == slot)
        start_hour = SLOT_START_HOUR.get(slot, 9)
        cumulative = 0
        break_extra = 0
        if doctor and doctor.is_on_break and doctor.break_started_at:
            bs = doctor.break_started_at
            if bs.tzinfo is None:
                bs = bs.replace(tzinfo=timezone.utc)
            break_extra = int((now - bs).total_seconds())
        delay_extra = int(getattr(doctor, "delay_buffer_sec", 0) or 0) if doctor else 0

        for appt in slot_appts:
            cache_key = f"{doctor_id}:{appt.age_band}"
            if cache_key in pred_cache:
                pred, conf = pred_cache[cache_key]
            else:
                pred, conf = predict_duration_sec(db, doctor_id, appt.age_band, now)
                pred_cache[cache_key] = (pred, conf)
            if appt.status == AppointmentStatus.in_progress:
                wait = remaining_for_in_progress(appt, pred, now)
                ahead = 0
                eta_wait = wait
            else:
                ahead = 0
                for a in slot_appts:
                    if a.id == appt.id:
                        break
                    if a.status in (
                        AppointmentStatus.scheduled,
                        AppointmentStatus.checked_in,
                        AppointmentStatus.in_progress,
                    ):
                        ahead += 1
                eta_wait = cumulative

            if appt.status != AppointmentStatus.in_progress:
                eta_wait += break_extra + delay_extra

            # Calculate base start time for the slot/queue based on doctor session timing
            if appt.scheduled_at:
                sched_local = appt.scheduled_at.astimezone(tz)
                slot_start = sched_local.replace(hour=start_hour, minute=0, second=0, microsecond=0)
            else:
                slot_start = local_now.replace(hour=start_hour, minute=0, second=0, microsecond=0)

            if slot_live:
                slot_base = max(local_now, slot_start)
            else:
                if local_now < slot_start:
                    slot_base = slot_start
                else:
                    slot_base = local_now

            # Projected ETA from doctor's session timing & queue position
            eta_at = (slot_base + timedelta(seconds=max(0, int(eta_wait)))).astimezone(timezone.utc)
            pred_row = existing_preds.get(appt.id)
            prev_ahead = pred_row.patients_ahead if pred_row else None

            upsert_rows.append({
                "appointment_id": appt.id,
                "eta_at": eta_at,
                "confidence_min": conf,
                "patients_ahead": ahead,
                "wait_seconds": eta_wait,
                "algorithm_version": "v1-weighted-slot",
            })

            if (slot_live
                    and prev_ahead is not None
                    and appt.status != AppointmentStatus.in_progress):
                from app.services.telegram_bot import notify_almost_next, notify_next
                from app.services import sms
                doctor_name = doctor.name if doctor else "Doctor"
                patient_name = appt.patient.name if appt.patient else "Patient"
                phone = sms.phone_from_patient(appt.patient)
                # Prefer full label with timings when notifying
                from app.models import SLOT_LABELS as _SL
                service = f"{doctor_name} · {_SL.get(slot, slot.capitalize())}"
                eta_time = eta_at.astimezone().strftime("%-I:%M %p") if eta_at else None

                if ahead == 1 and prev_ahead > 1:
                    serving = None
                    from app.services.queue import current_serving_token
                    serving = current_serving_token(db, doctor.id, slot) if doctor else None
                    wait_sec = int(eta_wait) if eta_wait is not None else None
                    if appt.telegram_chat_id:
                        notify_almost_next(appt.telegram_chat_id, patient_name, appt.token, service, eta_time, appt.public_token)
                    sms.notify_almost_next(
                        phone, patient_name, appt.token, service, eta_time,
                        current_token=serving, wait_seconds=wait_sec,
                        public_token=appt.public_token,
                    )
                elif ahead == 0 and prev_ahead > 0:
                    from app.services.queue import current_serving_token
                    serving = current_serving_token(db, doctor.id, slot) if doctor else None
                    wait_sec = int(eta_wait) if eta_wait is not None else None
                    if appt.telegram_chat_id:
                        notify_next(appt.telegram_chat_id, patient_name, appt.token, service, eta_time, appt.public_token)
                    sms.notify_next(
                        phone, patient_name, appt.token, service, eta_time,
                        current_token=serving, wait_seconds=wait_sec,
                        public_token=appt.public_token,
                    )

            if appt.status == AppointmentStatus.in_progress:
                cumulative = remaining_for_in_progress(appt, pred, now)
            else:
                cumulative += pred

    if upsert_rows:
        stmt = pg_insert(Prediction).values(upsert_rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=["appointment_id"],
            set_={
                "eta_at": stmt.excluded.eta_at,
                "confidence_min": stmt.excluded.confidence_min,
                "patients_ahead": stmt.excluded.patients_ahead,
                "wait_seconds": stmt.excluded.wait_seconds,
                "algorithm_version": stmt.excluded.algorithm_version,
                "updated_at": func.now(),
            },
        )
        db.execute(stmt)

    db.commit()


def record_duration_sample(
    db: Session,
    doctor_id: int,
    age_band: str,
    appointment_type: str,
    duration_sec: int,
    hour_of_day: int,
    day_of_week: int,
    source: str = "live",
) -> DurationSample:
    capped = min(max(duration_sec, 60), OUTLIER_CAP_SEC)
    sample = DurationSample(
        doctor_id=doctor_id,
        age_band=age_band,
        appointment_type=appointment_type,
        duration_sec=capped,
        hour_of_day=hour_of_day,
        day_of_week=day_of_week,
        source=source,
    )
    db.add(sample)
    return sample
