"""Date-wise doctor appointment availability."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Appointment, AppointmentStatus, Doctor, DurationSample, Hospital, WEEKDAYS
from app.services.time_utils import hospital_zone, session_day_bounds_utc
from app.services.reception_board import parse_work_days

MAX_BOOKING_DAYS = 30
MAX_SCHEDULE_PAST_DAYS = 90
DEFAULT_AVG_DURATION_SEC = 900
SLOT_DURATION_MINUTES = {
    "morning": 240,
    "afternoon": 240,
    "evening": 240,
}

SLOT_START_HOUR = {
    "morning": 9,
    "afternoon": 13,
    "evening": 17,
}

ACTIVE_STATUSES = (
    AppointmentStatus.scheduled,
    AppointmentStatus.checked_in,
    AppointmentStatus.in_progress,
)


def parse_slots(doctor: Doctor) -> list[str]:
    raw = (doctor.slots or "morning").strip()
    slots = [s.strip() for s in raw.split(",") if s.strip()]
    return slots or ["morning"]


def local_today(hospital: Optional[Hospital]) -> date:
    tz = hospital_zone(hospital)
    return datetime.now(timezone.utc).astimezone(tz).date()


def parse_appointment_date(value: Optional[date | str], hospital: Optional[Hospital]) -> date:
    if value is None:
        return local_today(hospital)
    if isinstance(value, str):
        return date.fromisoformat(value)
    return value


def validate_appointment_date(target: date, hospital: Optional[Hospital]) -> None:
    today = local_today(hospital)
    if target < today:
        raise ValueError("Cannot book appointments in the past")
    if target > today + timedelta(days=MAX_BOOKING_DAYS):
        raise ValueError(f"Cannot book more than {MAX_BOOKING_DAYS} days ahead")


def parse_schedule_date(value: Optional[date | str], hospital: Optional[Hospital]) -> date:
    target = parse_appointment_date(value, hospital)
    today = local_today(hospital)
    if target < today - timedelta(days=MAX_SCHEDULE_PAST_DAYS):
        raise ValueError(f"Cannot view schedule more than {MAX_SCHEDULE_PAST_DAYS} days in the past")
    if target > today + timedelta(days=MAX_BOOKING_DAYS):
        raise ValueError(f"Cannot view schedule more than {MAX_BOOKING_DAYS} days ahead")
    return target


def estimated_slot_capacity(avg_duration_sec: Optional[float], slot: str = "morning") -> int:
    duration = avg_duration_sec or DEFAULT_AVG_DURATION_SEC
    slot_minutes = SLOT_DURATION_MINUTES.get(slot, 240)
    return max(4, int(slot_minutes * 60 / duration))


def occupancy_pct(booked: int, capacity: int) -> int:
    if capacity <= 0:
        return 0
    return min(100, round(booked / capacity * 100))


def works_on_date(work_days: list[str], target: date, hospital: Optional[Hospital]) -> bool:
    tz = hospital_zone(hospital)
    anchor = datetime(target.year, target.month, target.day, 12, 0, tzinfo=tz)
    return WEEKDAYS[anchor.weekday()] in work_days


def day_anchor_utc(target: date, hospital: Optional[Hospital]) -> datetime:
    tz = hospital_zone(hospital)
    return datetime(target.year, target.month, target.day, 12, 0, tzinfo=tz)


def slot_scheduled_at(hospital: Hospital, target: date, slot: str) -> datetime:
    tz = hospital_zone(hospital)
    hour = SLOT_START_HOUR.get(slot, 9)
    local = datetime(target.year, target.month, target.day, hour, 0, tzinfo=tz)
    return local.astimezone(timezone.utc)


def count_slot_bookings(
    db: Session,
    doctor_id: int,
    slot: str,
    day_start: datetime,
    day_end: datetime,
) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Appointment)
            .where(
                Appointment.doctor_id == doctor_id,
                Appointment.slot == slot,
                Appointment.scheduled_at >= day_start,
                Appointment.scheduled_at < day_end,
                Appointment.status.in_(ACTIVE_STATUSES),
            )
        ).scalar()
        or 0
    )


def build_doctor_availability(
    db: Session,
    doctor: Doctor,
    hospital: Hospital,
    target: date,
) -> dict:
    work_days = parse_work_days(getattr(doctor, "work_days", None))
    works = works_on_date(work_days, target, hospital)
    today = local_today(hospital)
    is_today = target == today
    day_start, day_end = session_day_bounds_utc(hospital, day_anchor_utc(target, hospital))

    slots = []
    for slot in parse_slots(doctor):
        booked_count = count_slot_bookings(db, doctor.id, slot, day_start, day_end)
        available = True
        reason = None
        if not works:
            available = False
            reason = "Doctor does not work this day"
        elif is_today and not doctor.is_available:
            available = False
            reason = "Doctor not available today"

        slots.append(
            {
                "slot": slot,
                "available": available,
                "booked_count": booked_count,
                "reason": reason,
            }
        )

    return {
        "date": target.isoformat(),
        "doctor_id": doctor.id,
        "doctor_external_id": doctor.external_id,
        "doctor_name": doctor.name,
        "department": doctor.department,
        "works_that_day": works,
        "is_available": bool(doctor.is_available) if is_today else True,
        "slots": slots,
    }


def build_hospital_availability(db: Session, hospital: Hospital, target: date) -> dict:
    doctors = db.execute(
        select(Doctor).where(Doctor.hospital_id == hospital.id).order_by(Doctor.department, Doctor.name)
    ).scalars().all()
    return {
        "date": target.isoformat(),
        "hospital_id": hospital.id,
        "hospital_name": hospital.name,
        "doctors": [build_doctor_availability(db, d, hospital, target) for d in doctors],
    }


def build_doctor_day_schedule(
    db: Session,
    doctor: Doctor,
    hospital: Hospital,
    target: date,
    *,
    appointment_mapper,
) -> dict:
    from app.models import SLOT_ORDER

    work_days = parse_work_days(getattr(doctor, "work_days", None))
    works = works_on_date(work_days, target, hospital)
    day_start, day_end = session_day_bounds_utc(hospital, day_anchor_utc(target, hospital))

    avg_duration = db.execute(
        select(func.avg(DurationSample.duration_sec)).where(DurationSample.doctor_id == doctor.id)
    ).scalar()

    appts = db.execute(
        select(Appointment)
        .where(
            Appointment.doctor_id == doctor.id,
            Appointment.scheduled_at >= day_start,
            Appointment.scheduled_at < day_end,
        )
        .order_by(Appointment.slot, Appointment.token)
    ).scalars().all()

    slot_summaries = []
    occupancy_values = []
    doctor_slots = parse_slots(doctor)

    for slot in doctor_slots:
        slot_appts = [a for a in appts if (a.slot or "morning") == slot]
        active_count = sum(1 for a in slot_appts if a.status in ACTIVE_STATUSES)
        completed_count = sum(1 for a in slot_appts if a.status == AppointmentStatus.completed)
        no_show_count = sum(1 for a in slot_appts if a.status == AppointmentStatus.no_show)
        cancelled_count = sum(1 for a in slot_appts if a.status == AppointmentStatus.cancelled)
        booked_count = active_count + completed_count + no_show_count
        capacity = estimated_slot_capacity(
            float(avg_duration) if avg_duration is not None else None,
            slot,
        )
        slot_occ = occupancy_pct(booked_count, capacity)
        slot_summaries.append(
            {
                "slot": slot,
                "total_count": len(slot_appts),
                "active_count": active_count,
                "completed_count": completed_count,
                "no_show_count": no_show_count,
                "cancelled_count": cancelled_count,
                "estimated_capacity": capacity,
                "occupancy_pct": slot_occ,
            }
        )
        if works:
            occupancy_values.append(slot_occ)

    appts_sorted = sorted(
        appts,
        key=lambda a: (
            SLOT_ORDER.get(a.slot or "morning", 9),
            a.token,
        ),
    )

    return {
        "date": target.isoformat(),
        "doctor_id": doctor.id,
        "doctor_external_id": doctor.external_id,
        "doctor_name": doctor.name,
        "works_that_day": works,
        "slots": slot_summaries,
        "appointments": [appointment_mapper(a) for a in appts_sorted],
        "total_appointments": len(appts),
        "overall_occupancy_pct": round(sum(occupancy_values) / len(occupancy_values)) if occupancy_values else 0,
    }
