from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    PRIORITY_LABELS,
    PRIORITY_RANK,
    Appointment,
    AppointmentStatus,
    AppointmentType,
    Doctor,
    DoctorOpsEvent,
    EventType,
    Hospital,
    Patient,
    QueueEvent,
    SLOT_LABELS,
)
from app.config import settings
from app.services.age_bands import age_to_band
from app.services.availability import (
    day_anchor_utc,
    parse_appointment_date,
    slot_scheduled_at,
    validate_appointment_date,
    works_on_date,
    local_today,
)
from app.services.eta import recompute_doctor_queue_etas, record_duration_sample
from app.services.reception_board import parse_work_days
from app.services import sms
from app.services import telegram_bot as tg

VALID_PRIORITIES = ("emergency", "senior", "urgent", "normal")
WAITING_STATUSES = (
    AppointmentStatus.scheduled,
    AppointmentStatus.checked_in,
    AppointmentStatus.in_progress,
)


def _test_chat_id() -> Optional[str]:
    v = settings.telegram_test_recipient.strip()
    return v if v else None


from app.services.time_utils import hospital_zone, session_day_bounds_utc
def _appt_anchor(appt: Appointment) -> Optional[datetime]:
    t = appt.scheduled_at or appt.created_at
    if t is None:
        return None
    if t.tzinfo is None:
        return t.replace(tzinfo=timezone.utc)
    return t


def clear_session_queues(
    db: Session,
    doctor: Doctor,
    *,
    keep_slot: Optional[str] = None,
    clear_all_waiting: bool = False,
    reason: str = "Session ended",
) -> int:
    """
    Empty leftover OPD queues between sessions.

    - clear_all_waiting: cancel every waiting appointment for this doctor (go offline).
    - keep_slot: keep only today's appointments for that slot; cancel other slots
      and prior-day leftovers for the same slot.
    """
    hospital = db.get(Hospital, doctor.hospital_id)
    day_start, day_end = session_day_bounds_utc(hospital)
    waiting = db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor.id,
            Appointment.status.in_(WAITING_STATUSES),
        )
    ).scalars().all()

    cleared = 0
    now = datetime.now(timezone.utc)
    for appt in waiting:
        cancel = False
        if clear_all_waiting:
            cancel = True
        elif keep_slot:
            slot = appt.slot or "morning"
            anchor = _appt_anchor(appt)
            if slot != keep_slot:
                cancel = True
            elif anchor is None or not (day_start <= anchor < day_end):
                cancel = True
        if not cancel:
            continue
        was_in_progress = appt.status == AppointmentStatus.in_progress or bool(appt.started_at)
        appt.status = AppointmentStatus.cancelled
        if was_in_progress:
            appt.ended_at = now
        db.add(
            QueueEvent(
                appointment_id=appt.id,
                event_type=EventType.no_show.value,
                note=reason,
                timestamp=now,
            )
        )
        cleared += 1

    # Always start a new token series for the next session
    doctor.queue_epoch_at = now
    db.add(doctor)
    db.commit()
    return cleared


def bump_queue_epoch(db: Session, doctor: Doctor) -> datetime:
    """Force next token for this doctor to start at 1."""
    now = datetime.now(timezone.utc)
    doctor.queue_epoch_at = now
    db.add(doctor)
    db.commit()
    db.refresh(doctor)
    return now


def ensure_queue_epoch(db: Session, doctor: Doctor) -> datetime:
    """Return session token epoch; initialize to now if missing (fresh tokens)."""
    epoch = getattr(doctor, "queue_epoch_at", None)
    if epoch is None:
        return bump_queue_epoch(db, doctor)
    if epoch.tzinfo is None:
        return epoch.replace(tzinfo=timezone.utc)
    return epoch


def current_serving_token(db: Session, doctor_id: int, slot: str) -> Optional[int]:
    appt = db.execute(
        select(Appointment)
        .where(
            Appointment.doctor_id == doctor_id,
            Appointment.slot == slot,
            Appointment.status == AppointmentStatus.in_progress,
        )
        .order_by(Appointment.started_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return appt.token if appt else None


def today_session_filter(hospital: Optional[Hospital]):
    """SQLAlchemy filter: appointment belongs to today's hospital-local day."""
    day_start, day_end = session_day_bounds_utc(hospital)
    return or_(
        Appointment.scheduled_at.between(day_start, day_end - timedelta(microseconds=1)),
        (Appointment.scheduled_at.is_(None) & Appointment.created_at.between(day_start, day_end - timedelta(microseconds=1))),
    )


def _parse_slots(doctor: Doctor) -> list[str]:
    raw = (doctor.slots or "morning").strip()
    slots = [s.strip() for s in raw.split(",") if s.strip()]
    return slots or ["morning"]


def resolve_slot(doctor: Doctor, requested: Optional[str]) -> str:
    available = _parse_slots(doctor)
    if requested and requested in available:
        return requested
    if requested and requested not in available:
        raise ValueError(f"Doctor does not offer {requested} slot. Available: {', '.join(available)}")
    return available[0]


def resolve_priority(age: int, requested: Optional[str]) -> str:
    """Normalize priority; auto-upgrade to senior when age >= 60 unless emergency/urgent."""
    p = (requested or "normal").strip().lower()
    if p not in VALID_PRIORITIES:
        p = "normal"
    if age >= 60 and p == "normal":
        return "senior"
    return p


def queue_sort_key(appt: Appointment):
    """In-progress always first; then priority rank; then token FCFS within tier."""
    in_room = 0 if appt.status == AppointmentStatus.in_progress else 1
    rank = PRIORITY_RANK.get(getattr(appt, "priority", None) or "normal", 3)
    return (in_room, rank, appt.token)


def get_hospital(db: Session) -> Hospital:
    h = db.execute(select(Hospital).limit(1)).scalar_one_or_none()
    if not h:
        raise ValueError("Hospital not seeded")
    return h


def create_appointment(
    db: Session,
    doctor_external_id: str,
    age: int,
    patient_external_id: Optional[str] = None,
    patient_name: Optional[str] = None,
    patient_phone: Optional[str] = None,
    external_id: Optional[str] = None,
    token: Optional[int] = None,
    appointment_type: str = "new",
    slot: Optional[str] = None,
    scheduled_at: Optional[datetime] = None,
    appointment_date: Optional[date] = None,
    priority: Optional[str] = None,
    priority_reason: Optional[str] = None,
) -> Appointment:
    from app.services.self_checkin import find_patient_by_phone, format_phone_display, normalize_phone

    doctor = db.execute(
        select(Doctor).where(Doctor.external_id == doctor_external_id)
    ).scalar_one_or_none()
    if not doctor:
        raise ValueError(f"Doctor not found: {doctor_external_id}")
    hospital = db.get(Hospital, doctor.hospital_id)

    slot_val = resolve_slot(doctor, slot)
    priority_val = resolve_priority(age, priority)
    reason = (priority_reason or "").strip() or None

    target_date = parse_appointment_date(appointment_date, hospital)
    validate_appointment_date(target_date, hospital)
    work_days = parse_work_days(getattr(doctor, "work_days", None))
    if not works_on_date(work_days, target_date, hospital):
        raise ValueError("Doctor does not work on the selected date")
    if target_date == local_today(hospital) and not doctor.is_available:
        raise ValueError("Doctor is not available for booking today")

    if scheduled_at is None:
        scheduled_at = slot_scheduled_at(hospital, target_date, slot_val)
    is_today = target_date == local_today(hospital)
    if priority_val != "normal" and not reason:
        if priority_val == "senior" and age >= 60:
            reason = "Age 60+ — senior priority"
        else:
            raise ValueError(f"priority_reason is required for {priority_val} triage")

    phone_digits = normalize_phone(patient_phone or "")
    if patient_phone and len(phone_digits) < 10:
        raise ValueError("Enter a valid 10-digit mobile number")

    patient = None
    if phone_digits:
        patient = find_patient_by_phone(db, hospital.id, phone_digits)
        if patient:
            if patient_name and patient_name.strip():
                patient.name = patient_name.strip()
            patient.age = age
            patient.age_band = age_to_band(age)
            if not patient.phone:
                patient.phone = format_phone_display(phone_digits)
    if not patient and patient_external_id:
        patient = db.execute(
            select(Patient).where(
                Patient.hospital_id == hospital.id,
                Patient.external_id == patient_external_id,
            )
        ).scalar_one_or_none()
        if patient and phone_digits and not patient.phone:
            patient.phone = format_phone_display(phone_digits)
    if not patient:
        ext = patient_external_id or (
            f"MOB-{phone_digits[-8:]}" if phone_digits else f"WALK-{uuid.uuid4().hex[:8]}"
        )
        patient = Patient(
            hospital_id=hospital.id,
            external_id=ext,
            name=(patient_name or "").strip() or f"Patient {ext}",
            age=age,
            age_band=age_to_band(age),
            phone=format_phone_display(phone_digits) if phone_digits else None,
        )
        existing_ext = db.execute(
            select(Patient).where(
                Patient.hospital_id == hospital.id,
                Patient.external_id == patient.external_id,
            )
        ).scalar_one_or_none()
        if existing_ext:
            patient.external_id = f"MOB-{phone_digits or uuid.uuid4().hex[:8]}-{age}"
        db.add(patient)
        db.flush()

    # Tokens restart from 1 after each session clear (queue_epoch_at)
    if token is None:
        epoch = ensure_queue_epoch(db, doctor)
        from app.services.availability import day_anchor_utc

        day_start, day_end = session_day_bounds_utc(hospital, day_anchor_utc(target_date, hospital))
        token_start = max(epoch, day_start)
        max_token = db.execute(
            select(func.max(Appointment.token)).where(
                Appointment.doctor_id == doctor.id,
                Appointment.slot == slot_val,
                Appointment.scheduled_at >= token_start,
                Appointment.scheduled_at < day_end,
                Appointment.status.notin_(
                    [AppointmentStatus.cancelled, AppointmentStatus.no_show]
                ),
            )
        ).scalar()
        token = int(max_token or 0) + 1

    appt_type = (
        AppointmentType.follow_up
        if appointment_type == "follow_up"
        else AppointmentType.new
    )
    auto_chat = _test_chat_id()
    appt = Appointment(
        hospital_id=hospital.id,
        external_id=external_id or f"APT-{uuid.uuid4().hex[:10]}",
        doctor_id=doctor.id,
        patient_id=patient.id,
        token=token,
        appointment_type=appt_type,
        status=AppointmentStatus.scheduled,
        age=age,
        age_band=age_to_band(age),
        slot=slot_val,
        priority=priority_val,
        priority_reason=reason,
        scheduled_at=scheduled_at,
        telegram_chat_id=auto_chat,
    )
    db.add(appt)
    db.flush()

    if priority_val != "normal":
        db.add(
            QueueEvent(
                appointment_id=appt.id,
                event_type=EventType.priority_set.value,
                note=f"{PRIORITY_LABELS.get(priority_val, priority_val)}: {reason}",
                timestamp=datetime.now(timezone.utc),
            )
        )

    db.commit()
    db.refresh(appt)
    if is_today:
        recompute_doctor_queue_etas(db, doctor.id)
        db.refresh(appt)

    if not is_today:
        slot_label = SLOT_LABELS.get(slot_val, slot_val.capitalize())
        service = f"{doctor.name} · {slot_label} · {target_date.isoformat()}"
        sms_phone = format_phone_display(phone_digits) if phone_digits else sms.phone_from_patient(patient)
        sms.notify_booked(
            sms_phone,
            patient.name,
            appt.token,
            0,
            service,
            current_token=None,
            wait_seconds=None,
            eta_time=None,
            doctor_live=False,
            sync=True,
            public_token=appt.public_token,
        )
        return appt

    waiting = db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor.id,
            Appointment.slot == slot_val,
            Appointment.status.in_([AppointmentStatus.scheduled, AppointmentStatus.checked_in]),
        )
    ).scalars().all()
    ordered = sorted(waiting, key=queue_sort_key)
    ahead = 0
    for a in ordered:
        if a.id == appt.id:
            break
        ahead += 1
    slot_label = SLOT_LABELS.get(slot_val, slot_val.capitalize())
    pri = PRIORITY_LABELS.get(priority_val, "")
    service = f"{doctor.name} · {slot_label}"
    if priority_val != "normal":
        service = f"{service} · {pri}"

    if auto_chat and settings.telegram_bot_token:
        tg.notify_booked(auto_chat, patient.name, appt.token, ahead, service, appt.public_token)

    # Registration SMS with live queue context (current token / wait / ETA)
    from app.models import Prediction
    pred = db.execute(select(Prediction).where(Prediction.appointment_id == appt.id)).scalar_one_or_none()
    serving = current_serving_token(db, doctor.id, slot_val)
    wait_sec = int(pred.wait_seconds) if pred and pred.wait_seconds is not None else None
    eta_time = None
    if pred and pred.eta_at:
        eta_time = pred.eta_at.astimezone().strftime("%-I:%M %p")
    sms_phone = format_phone_display(phone_digits) if phone_digits else sms.phone_from_patient(patient)
    sms.notify_booked(
        sms_phone,
        patient.name,
        appt.token,
        ahead,
        service,
        current_token=serving,
        wait_seconds=wait_sec,
        eta_time=eta_time,
        doctor_live=bool(doctor.is_live and (doctor.active_slot in (None, slot_val))),
        sync=True,
        public_token=appt.public_token,
    )

    return appt


END_WITH_NEXT_EVENTS = frozenset({"ended", "ended_and_next"})
END_WITH_BREAK_EVENT = "ended_and_break"


def _service_label(appt: Appointment) -> str:
    doctor_name = appt.doctor.name if appt.doctor else "Doctor"
    slot = appt.slot or "morning"
    return f"{doctor_name} · {SLOT_LABELS.get(slot, slot.capitalize())}"


def _end_consult(db: Session, appt: Appointment, now: datetime) -> None:
    db.add(QueueEvent(appointment_id=appt.id, event_type=EventType.ended.value, timestamp=now))
    appt.status = AppointmentStatus.completed
    appt.ended_at = now
    if appt.started_at:
        started = appt.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        duration = int((now - started).total_seconds())
    else:
        duration = 10 * 60
    record_duration_sample(
        db,
        doctor_id=appt.doctor_id,
        age_band=appt.age_band,
        appointment_type=appt.appointment_type.value,
        duration_sec=duration,
        hour_of_day=now.hour,
        day_of_week=now.weekday(),
        source="live",
    )
    chat_id = appt.telegram_chat_id
    phone = sms.phone_from_patient(appt.patient)
    patient_name = appt.patient.name if appt.patient else "Patient"
    service = _service_label(appt)
    if chat_id:
        tg.notify_ended(chat_id, patient_name, service, appt.public_token)
    sms.notify_ended(phone, patient_name, service, appt.public_token)


def _start_consult(db: Session, appt: Appointment, now: datetime) -> None:
    db.add(QueueEvent(appointment_id=appt.id, event_type=EventType.started.value, timestamp=now))
    appt.status = AppointmentStatus.in_progress
    appt.started_at = now
    chat_id = appt.telegram_chat_id
    phone = sms.phone_from_patient(appt.patient)
    patient_name = appt.patient.name if appt.patient else "Patient"
    service = _service_label(appt)
    if chat_id:
        tg.notify_started(chat_id, patient_name, appt.token, service, appt.public_token)
    sms.notify_started(phone, patient_name, appt.token, service, appt.public_token)


def find_next_waiting_in_slot(db: Session, doctor: Doctor, slot: str) -> Optional[Appointment]:
    hospital = db.get(Hospital, doctor.hospital_id)
    day_start, day_end = session_day_bounds_utc(hospital)
    waiting = db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor.id,
            Appointment.slot == slot,
            Appointment.status.in_(
                [AppointmentStatus.scheduled, AppointmentStatus.checked_in]
            ),
            Appointment.scheduled_at >= day_start,
            Appointment.scheduled_at < day_end,
        )
    ).scalars().all()
    if not waiting:
        return None
    return sorted(waiting, key=queue_sort_key)[0]


def start_doctor_break(db: Session, doctor: Doctor, now: datetime) -> None:
    if not doctor.is_live:
        raise ValueError("Doctor must be live to start a break")
    if doctor.is_on_break:
        raise ValueError("Already on break")
    doctor.is_on_break = True
    doctor.break_started_at = now
    db.add(DoctorOpsEvent(doctor_id=doctor.id, event_type="break_start", timestamp=now))
    slot = doctor.active_slot or _parse_slots(doctor)[0]
    hospital = db.get(Hospital, doctor.hospital_id)
    day_start, day_end = session_day_bounds_utc(hospital)
    waiting = db.execute(
        select(Appointment).where(
            Appointment.doctor_id == doctor.id,
            Appointment.slot == slot,
            Appointment.status.in_(
                [AppointmentStatus.scheduled, AppointmentStatus.checked_in]
            ),
            Appointment.scheduled_at >= day_start,
            Appointment.scheduled_at < day_end,
        ).order_by(Appointment.token.asc())
    ).scalars().all()
    for appt in waiting:
        if not appt.patient:
            continue
        if appt.telegram_chat_id:
            tg.notify_break_started(appt.telegram_chat_id, appt.patient.name, appt.token, doctor.name, appt.public_token)
        sms.notify_break_started(sms.phone_from_patient(appt.patient), appt.patient.name, appt.token, doctor.name, appt.public_token)


def apply_end_consult_flow(db: Session, appointment_id: int, event_type: str) -> Appointment:
    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise ValueError("Appointment not found")
    if appt.status != AppointmentStatus.in_progress:
        raise ValueError("Only an in-progress consult can be ended")

    doctor = appt.doctor or db.get(Doctor, appt.doctor_id)
    if not doctor:
        raise ValueError("Doctor not found")

    now = datetime.now(timezone.utc)
    slot = appt.slot or doctor.active_slot or _parse_slots(doctor)[0]
    _end_consult(db, appt, now)

    if event_type == END_WITH_BREAK_EVENT:
        start_doctor_break(db, doctor, now)
    elif event_type in END_WITH_NEXT_EVENTS:
        nxt = find_next_waiting_in_slot(db, doctor, slot)
        if nxt:
            _start_consult(db, nxt, now)

    db.commit()
    recompute_doctor_queue_etas(db, appt.doctor_id)
    db.refresh(appt)
    return appt


def apply_event(db: Session, appointment_id: int, event_type: str) -> Appointment:
    if event_type in END_WITH_NEXT_EVENTS or event_type == END_WITH_BREAK_EVENT:
        return apply_end_consult_flow(db, appointment_id, event_type)

    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise ValueError("Appointment not found")

    try:
        et = EventType(event_type)
    except ValueError as e:
        raise ValueError(f"Invalid event_type: {event_type}") from e

    now = datetime.now(timezone.utc)
    db.add(QueueEvent(appointment_id=appt.id, event_type=et.value, timestamp=now))

    chat_id = appt.telegram_chat_id
    phone = sms.phone_from_patient(appt.patient)
    doctor_name = appt.doctor.name if appt.doctor else "Doctor"
    patient_name = appt.patient.name if appt.patient else "Patient"
    service = f"{doctor_name} · {SLOT_LABELS.get(appt.slot or 'morning', (appt.slot or 'morning').capitalize())}"

    if et == EventType.checked_in:
        appt.status = AppointmentStatus.checked_in
    elif et == EventType.started:
        appt.status = AppointmentStatus.in_progress
        appt.started_at = now
        if chat_id:
            tg.notify_started(chat_id, patient_name, appt.token, service, appt.public_token)
        sms.notify_started(phone, patient_name, appt.token, service, appt.public_token)
    elif et == EventType.no_show:
        appt.status = AppointmentStatus.no_show
        if chat_id:
            tg.notify_no_show(chat_id, patient_name, appt.token, appt.public_token)
        sms.notify_no_show(phone, patient_name, appt.token, appt.public_token)
    elif et == EventType.emergency_insert:
        # Promote to emergency priority — jumps ahead of all non-emergency
        appt.priority = "emergency"
        appt.priority_reason = appt.priority_reason or "Emergency insert from room"
        appt.status = AppointmentStatus.checked_in
        db.add(
            QueueEvent(
                appointment_id=appt.id,
                event_type=EventType.priority_set.value,
                note="Emergency: promoted from room tablet",
                timestamp=now,
            )
        )

    db.commit()
    recompute_doctor_queue_etas(db, appt.doctor_id)
    db.refresh(appt)
    return appt
