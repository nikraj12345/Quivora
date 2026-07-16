from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    PRIORITY_LABELS,
    PRIORITY_RANK,
    Appointment,
    AppointmentStatus,
    AppointmentType,
    Doctor,
    EventType,
    Hospital,
    Patient,
    QueueEvent,
    SLOT_LABELS,
)
from app.config import settings
from app.services.age_bands import age_to_band
from app.services.eta import recompute_doctor_queue_etas, record_duration_sample
from app.services import telegram_bot as tg

VALID_PRIORITIES = ("emergency", "senior", "urgent", "normal")


def _test_chat_id() -> Optional[str]:
    v = settings.telegram_test_recipient.strip()
    return v if v else None


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
    external_id: Optional[str] = None,
    token: Optional[int] = None,
    appointment_type: str = "new",
    slot: Optional[str] = None,
    scheduled_at: Optional[datetime] = None,
    priority: Optional[str] = None,
    priority_reason: Optional[str] = None,
) -> Appointment:
    doctor = db.execute(
        select(Doctor).where(Doctor.external_id == doctor_external_id)
    ).scalar_one_or_none()
    if not doctor:
        raise ValueError(f"Doctor not found: {doctor_external_id}")
    hospital = db.get(Hospital, doctor.hospital_id)

    slot_val = resolve_slot(doctor, slot)
    priority_val = resolve_priority(age, priority)
    reason = (priority_reason or "").strip() or None
    if priority_val != "normal" and not reason:
        if priority_val == "senior" and age >= 60:
            reason = "Age 60+ — senior priority"
        else:
            raise ValueError(f"priority_reason is required for {priority_val} triage")

    patient = None
    if patient_external_id:
        patient = db.execute(
            select(Patient).where(
                Patient.hospital_id == hospital.id,
                Patient.external_id == patient_external_id,
            )
        ).scalar_one_or_none()
    if not patient:
        ext = patient_external_id or f"WALK-{uuid.uuid4().hex[:8]}"
        patient = Patient(
            hospital_id=hospital.id,
            external_id=ext,
            name=patient_name or f"Patient {ext}",
            age=age,
            age_band=age_to_band(age),
        )
        db.add(patient)
        db.flush()

    # Token is per doctor + slot (display number); order is by priority then token
    if token is None:
        max_token = db.execute(
            select(func.max(Appointment.token)).where(
                Appointment.doctor_id == doctor.id,
                Appointment.slot == slot_val,
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
        scheduled_at=scheduled_at or datetime.now(timezone.utc),
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
    recompute_doctor_queue_etas(db, doctor.id)
    db.refresh(appt)

    if auto_chat and settings.telegram_bot_token:
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
        tg.notify_booked(auto_chat, patient.name, appt.token, ahead, service)

    return appt


def apply_event(db: Session, appointment_id: int, event_type: str) -> Appointment:
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
    doctor_name = appt.doctor.name if appt.doctor else "Doctor"
    patient_name = appt.patient.name if appt.patient else "Patient"
    service = f"{doctor_name} · {SLOT_LABELS.get(appt.slot or 'morning', (appt.slot or 'morning').capitalize())}"

    if et == EventType.checked_in:
        appt.status = AppointmentStatus.checked_in
    elif et == EventType.started:
        appt.status = AppointmentStatus.in_progress
        appt.started_at = now
        if chat_id:
            tg.notify_started(chat_id, patient_name, appt.token, service)
    elif et == EventType.ended:
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
        if chat_id:
            tg.notify_ended(chat_id, patient_name, service)
    elif et == EventType.no_show:
        appt.status = AppointmentStatus.no_show
        if chat_id:
            tg.notify_no_show(chat_id, patient_name, appt.token)
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
