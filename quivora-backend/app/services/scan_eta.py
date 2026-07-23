"""ETA prediction for scan queues — same weighted-average approach as OPD."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.models import ScanAppointment, ScanDurationSample, ScanMachine, ScanPrediction, ScanStatus

# Default scan durations (seconds) when no samples exist
SCAN_DEFAULTS = {
    "mri": 32 * 60,
    "ct": 12 * 60,
    "xray": 5 * 60,
    "ultrasound": 18 * 60,
    "blood_test": 10 * 60,
}


def _avg_samples(db: Session, machine_id: int, scan_type: str,
                 age_band: Optional[str], since: Optional[datetime]) -> Optional[float]:
    q = select(func.avg(ScanDurationSample.duration_sec)).where(
        ScanDurationSample.machine_id == machine_id,
    )
    if age_band:
        q = q.where(ScanDurationSample.age_band == age_band)
    if since:
        q = q.where(ScanDurationSample.created_at >= since)
    return db.execute(q).scalar()


def predict_scan_duration(db: Session, machine_id: int, scan_type: str, age_band: str) -> int:
    now = datetime.now(timezone.utc)
    last_hour = now - timedelta(hours=1)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)

    h = _avg_samples(db, machine_id, scan_type, age_band, last_hour)
    d = _avg_samples(db, machine_id, scan_type, age_band, today_start)
    w = _avg_samples(db, machine_id, scan_type, age_band, week_start)
    b = _avg_samples(db, machine_id, scan_type, None, None)

    weights = [(h, 0.45), (d, 0.25), (w, 0.20), (b, 0.10)]
    total_w = sum(wt for val, wt in weights if val is not None)
    if total_w == 0:
        return SCAN_DEFAULTS.get(scan_type, 15 * 60)
    pred = sum(float(val) * wt for val, wt in weights if val is not None) / total_w
    return max(60, int(pred))


def recompute_scan_queue_etas(db: Session, machine_id: int) -> None:
    machine = db.get(ScanMachine, machine_id)
    machine_live = machine.is_live if machine else False

    active_statuses = [ScanStatus.scheduled, ScanStatus.arrived, ScanStatus.in_progress]
    appts = db.execute(
        select(ScanAppointment)
        .where(
            ScanAppointment.machine_id == machine_id,
            ScanAppointment.status.in_(active_statuses),
        )
        .order_by(ScanAppointment.id)
    ).scalars().all()

    now = datetime.now(timezone.utc)
    eta_wait = 0.0

    for appt in appts:
        pred_sec = predict_scan_duration(db, machine_id, machine.scan_type.value, appt.age_band)
        patients_ahead = sum(
            1 for a in appts
            if a.id < appt.id and a.status != ScanStatus.in_progress
        )

        if appt.status == ScanStatus.in_progress and appt.started_at:
            elapsed = (now - appt.started_at.replace(tzinfo=timezone.utc)).total_seconds()
            remaining = max(0.0, pred_sec - elapsed)
            eta_wait = remaining
        else:
            eta_wait += pred_sec

        eta_at = (now + timedelta(seconds=eta_wait)) if machine_live else None

        # Variance for confidence band
        samples = db.execute(
            select(ScanDurationSample.duration_sec).where(
                ScanDurationSample.machine_id == machine_id
            ).order_by(ScanDurationSample.id.desc()).limit(20)
        ).scalars().all()
        if len(samples) >= 2:
            mean = sum(samples) / len(samples)
            variance = sum((s - mean) ** 2 for s in samples) / len(samples)
            confidence_min = (variance ** 0.5) / 60
        else:
            confidence_min = 5.0

        pred = db.execute(
            select(ScanPrediction).where(ScanPrediction.scan_appointment_id == appt.id)
        ).scalar_one_or_none()
        prev_ahead = pred.patients_ahead if pred else None
        if pred:
            pred.eta_at = eta_at
            pred.predicted_duration_sec = pred_sec
            pred.patients_ahead = patients_ahead
            pred.wait_seconds = int(eta_wait)
            pred.confidence_min = round(confidence_min, 1)
        else:
            db.add(ScanPrediction(
                scan_appointment_id=appt.id,
                eta_at=eta_at,
                predicted_duration_sec=pred_sec,
                patients_ahead=patients_ahead,
                wait_seconds=int(eta_wait),
                confidence_min=round(confidence_min, 1),
            ))

        # Same 2-level hierarchy as doctor queues
        if (machine_live
                and prev_ahead is not None
                and appt.status != ScanStatus.in_progress):
            from app.services.telegram_bot import notify_almost_next, notify_next
            from app.services import sms
            machine_name = machine.name if machine else "Scan"
            patient_name = appt.patient.name if appt.patient else "Patient"
            phone = sms.phone_from_patient(appt.patient)
            eta_time = eta_at.astimezone().strftime("%-I:%M %p") if eta_at else None
            if patients_ahead == 1 and prev_ahead > 1:
                if appt.telegram_chat_id:
                    notify_almost_next(appt.telegram_chat_id, patient_name, appt.token, machine_name, eta_time, appt.public_token)
                sms.notify_almost_next(phone, patient_name, appt.token, machine_name, eta_time, public_token=appt.public_token)
            elif patients_ahead == 0 and prev_ahead > 0:
                if appt.telegram_chat_id:
                    notify_next(appt.telegram_chat_id, patient_name, appt.token, machine_name, eta_time, appt.public_token)
                sms.notify_next(phone, patient_name, appt.token, machine_name, eta_time, public_token=appt.public_token)

    db.commit()


def record_scan_duration(db: Session, machine_id: int, scan_type: str,
                         age_band: str, duration_sec: int) -> None:
    capped = min(duration_sec, SCAN_DEFAULTS.get(scan_type, 15 * 60) * 4)
    db.add(ScanDurationSample(
        machine_id=machine_id,
        scan_type=scan_type,
        age_band=age_band,
        duration_sec=max(30, capped),
        source="live",
    ))
    db.commit()
