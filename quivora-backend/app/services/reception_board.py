"""Doctor schedule helpers and reception board builder."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Appointment,
    AppointmentStatus,
    DEFAULT_WORK_DAYS,
    Doctor,
    DurationSample,
    Prediction,
    WEEKDAYS,
)
from app.schemas import ReceptionBoardOut, ReceptionDoctorRow


def parse_work_days(raw: str | None) -> list[str]:
    days = [d.strip().lower() for d in (raw or DEFAULT_WORK_DAYS).split(",") if d.strip()]
    return [d for d in days if d in WEEKDAYS] or list(DEFAULT_WORK_DAYS.split(","))


def format_work_days(days: list[str]) -> str:
    valid = [d for d in days if d in WEEKDAYS]
    return ",".join(valid) if valid else DEFAULT_WORK_DAYS


def works_today(work_days: list[str], now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return WEEKDAYS[now.weekday()] in work_days


def build_reception_board(db: Session, hospital_id: int, hospital_name: str) -> ReceptionBoardOut:
    from app.models import Hospital
    from app.services.queue import session_day_bounds_utc

    now = datetime.now(timezone.utc)
    active_statuses = [
        AppointmentStatus.scheduled,
        AppointmentStatus.checked_in,
        AppointmentStatus.in_progress,
    ]
    hospital = db.get(Hospital, hospital_id)
    day_start, day_end = session_day_bounds_utc(hospital, now)

    doctors = db.execute(
        select(Doctor).where(Doctor.hospital_id == hospital_id).order_by(Doctor.department, Doctor.name)
    ).scalars().all()

    rows: list[ReceptionDoctorRow] = []
    live_count = 0
    break_count = 0
    total_waiting = 0

    for d in doctors:
        work_days = parse_work_days(getattr(d, "work_days", None))
        works = works_today(work_days, now)

        appts = db.execute(
            select(Appointment)
            .where(
                Appointment.doctor_id == d.id,
                Appointment.status.in_(active_statuses),
                Appointment.scheduled_at >= day_start,
                Appointment.scheduled_at < day_end,
            )
            .order_by(Appointment.token.asc())
        ).scalars().all()

        queue_total = len(appts)
        active_slot = d.active_slot or "morning"
        slot_appts = [a for a in appts if (a.slot or "morning") == active_slot] if d.is_live else appts
        queue_active = len(slot_appts) if d.is_live else 0

        current_token = None
        current_patient = None
        for a in appts:
            if a.status == AppointmentStatus.in_progress:
                current_token = a.token
                current_patient = a.patient.name if a.patient else None
                break

        longest_wait_min = None
        if d.is_live and slot_appts:
            waits = []
            for a in slot_appts:
                if a.status == AppointmentStatus.in_progress:
                    continue
                pred = db.execute(
                    select(Prediction).where(Prediction.appointment_id == a.id)
                ).scalar_one_or_none()
                if pred and pred.wait_seconds is not None:
                    waits.append(pred.wait_seconds)
            if waits:
                longest_wait_min = max(1, max(waits) // 60)

        if d.is_on_break:
            status = "break"
            break_count += 1
        elif not d.is_available or not works:
            status = "unavailable"
        elif d.is_live:
            status = "live"
            live_count += 1
        else:
            status = "offline"

        total_waiting += queue_total

        avg_sec = db.execute(
            select(func.avg(DurationSample.duration_sec)).where(DurationSample.doctor_id == d.id)
        ).scalar()

        rows.append(
            ReceptionDoctorRow(
                id=d.id,
                external_id=d.external_id,
                name=d.name,
                department=d.department,
                slots=[s.strip() for s in (d.slots or "morning").split(",") if s.strip()],
                work_days=work_days,
                works_today=works,
                is_available=d.is_available,
                is_live=d.is_live,
                is_on_break=d.is_on_break,
                active_slot=d.active_slot,
                status=status,
                queue_total=queue_total,
                queue_active_slot=queue_active,
                current_token=current_token,
                current_patient=current_patient,
                longest_wait_min=longest_wait_min,
                avg_duration_sec=float(avg_sec) if avg_sec is not None else None,
                delay_buffer_sec=int(getattr(d, "delay_buffer_sec", 0) or 0),
            )
        )

    return ReceptionBoardOut(
        hospital_id=hospital_id,
        hospital_name=hospital_name,
        generated_at=now,
        summary={
            "doctors_total": len(doctors),
            "doctors_live": live_count,
            "doctors_on_break": break_count,
            "patients_waiting": total_waiting,
        },
        doctors=rows,
    )
