from __future__ import annotations

import json
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import (
    Principal,
    allowed_hospital_ids,
    assert_doctor_access,
    assert_hospital_access,
    assert_hospital_crud,
    assert_hospital_manage,
    assert_hospital_operate,
    effective_role,
    get_principal,
    is_platform_admin,
    can_operate_hospital,
    require_platform_admin,
    require_principal,
    require_service,
    require_staff_read,
    require_staff_write,
    scoped_hospital_id_optional,
)
from app.config import settings
from app.db import get_db
from app.models import (
    Appointment, Department, Doctor, DoctorOpsEvent, DurationSample, Hospital, Patient,
    Prediction, ScanAppointment, ScanDurationSample, ScanMachine,
    ScanPrediction, ScanStatus, TrainJob,
)
from app.schemas import (
    AppointmentCreate,
    AppointmentOut,
    DepartmentCreate,
    DepartmentOut,
    DoctorAvailabilityOut,
    DoctorCreate,
    DoctorDayScheduleOut,
    DoctorOut,
    DoctorUpdate,
    EtaOut,
    EventCreate,
    HealthOut,
    HospitalAvailabilityOut,
    HospitalCreate,
    HospitalOut,
    HospitalQrInfoOut,
    HospitalUpdate,
    InsightsOut,
    OpdSummaryOut,
    PatientOut,
    PriorityUpdate,
    PublicTicketOut,
    QueueItemOut,
    ReceptionBoardOut,
    RunningLateBody,
    ScanAppointmentCreate,
    ScanAppointmentOut,
    ScanEtaOut,
    ScanEventCreate,
    ScanMachineOut,
    ScanQueueItemOut,
    SeedResponse,
    PatientCheckinHintOut,
    SelfCheckinBody,
    SelfCheckinOut,
    TrainStartResponse,
    TrainStatsOut,
    TrainStatusOut,
)
from app.services.eta import predict_duration_sec, recompute_doctor_queue_etas
from app.services.availability import (
    build_doctor_availability,
    build_doctor_day_schedule,
    build_hospital_availability,
    day_anchor_utc,
    local_today,
    parse_appointment_date,
    parse_schedule_date,
    validate_appointment_date,
)
from app.services.bootstrap_auth import ensure_bootstrap_users
from app.services.insights import build_hospital_insights
from app.services.hospital_ref import resolve_hospital
from app.services.queue import apply_event, create_appointment
from app.services.scan_eta import predict_scan_duration, record_scan_duration, recompute_scan_queue_etas
from app.services.reception_board import build_reception_board, format_work_days, parse_work_days, works_today
from app.services.self_checkin import (
    checkin_url_for_hospital,
    find_patient_by_phone,
    generate_hospital_qr_png,
    self_checkin,
)
from app.services import sms
from app.worker.celery_app import create_train_job, run_bootstrap_training

router = APIRouter()


def _resolve_hospital(hospital_ref: str, db: Session) -> Hospital:
    return resolve_hospital(hospital_ref, db)


def appt_out(db: Session, appt: Appointment) -> AppointmentOut:
    return AppointmentOut(
        id=appt.id,
        external_id=appt.external_id,
        doctor_id=appt.doctor_id,
        doctor_name=appt.doctor.name,
        patient_id=appt.patient_id,
        patient_name=appt.patient.name,
        token=appt.token,
        age=appt.age,
        age_band=appt.age_band,
        appointment_type=appt.appointment_type.value,
        status=appt.status.value,
        slot=appt.slot or "morning",
        priority=getattr(appt, "priority", None) or "normal",
        priority_reason=getattr(appt, "priority_reason", None),
        scheduled_at=appt.scheduled_at,
        started_at=appt.started_at,
        ended_at=appt.ended_at,
        public_token=appt.public_token,
    )


@router.get("/health")
def health(db: Session = Depends(get_db)):
    pg_ok = False
    redis_ok = False
    try:
        db.execute(select(1))
        pg_ok = True
    except Exception:
        pg_ok = False
    try:
        import redis

        redis_ok = redis.from_url(settings.redis_url).ping() is True
    except Exception:
        redis_ok = False
    return {
        "status": "ok" if pg_ok and redis_ok else "degraded",
        "postgres": pg_ok,
        "redis": redis_ok,
        "telegram_enabled": bool(settings.telegram_bot_token),
        "telegram_bot_username": settings.telegram_bot_username or None,
        **sms.sms_status(),
    }


def _hospital_out(db: Session, h: Hospital) -> HospitalOut:
    return HospitalOut(
        id=h.id,
        external_id=h.external_id,
        name=h.name,
        city=h.city,
        address=getattr(h, "address", "") or "",
        phone=getattr(h, "phone", None),
        timezone=getattr(h, "timezone", "Asia/Kolkata") or "Asia/Kolkata",
        is_active=getattr(h, "is_active", True),
        doctor_count=db.execute(select(func.count()).select_from(Doctor).where(Doctor.hospital_id == h.id)).scalar() or 0,
        patient_count=db.execute(select(func.count()).select_from(Patient).where(Patient.hospital_id == h.id)).scalar() or 0,
        machine_count=db.execute(select(func.count()).select_from(ScanMachine).where(ScanMachine.hospital_id == h.id)).scalar() or 0,
    )


@router.get("/v1/hospitals", response_model=list[HospitalOut])
def list_hospitals(
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    stmt = select(Hospital).order_by(Hospital.id)
    if principal.kind == "anonymous":
        stmt = stmt.where(Hospital.is_active.is_(True))
    else:
        allowed = allowed_hospital_ids(principal)
        if allowed is not None:
            stmt = stmt.where(Hospital.id.in_(allowed))
    hospitals = db.execute(stmt).scalars().all()
    return [_hospital_out(db, h) for h in hospitals]


@router.get("/v1/hospitals/{hospital_ref}", response_model=HospitalOut)
def get_hospital(
    hospital_ref: str,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    h = _resolve_hospital(hospital_ref, db)
    if principal.kind != "anonymous":
        assert_hospital_access(principal, h.id)
    return _hospital_out(db, h)


@router.post("/v1/hospitals", response_model=HospitalOut, dependencies=[Depends(require_platform_admin)])
def create_hospital(body: HospitalCreate, db: Session = Depends(get_db)):
    import uuid
    try:
        ZoneInfo(body.timezone)
    except ZoneInfoNotFoundError:
        raise HTTPException(400, "Invalid IANA timezone")
    ext = body.external_id or f"HOSP-{uuid.uuid4().hex[:6].upper()}"
    existing = db.execute(select(Hospital).where(Hospital.external_id == ext)).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"Hospital {ext} already exists")
    h = Hospital(
        external_id=ext,
        name=body.name.strip(),
        city=body.city.strip(),
        address=(body.address or "").strip(),
        phone=body.phone,
        timezone=body.timezone,
        is_active=True,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return _hospital_out(db, h)


@router.patch("/v1/hospitals/{hospital_ref}", response_model=HospitalOut)
def update_hospital(
    hospital_ref: str,
    body: HospitalUpdate,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    if hospital_ref.isdigit():
        h = db.get(Hospital, int(hospital_ref))
    else:
        h = db.execute(select(Hospital).where(Hospital.external_id == hospital_ref)).scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Hospital not found")
    assert_hospital_crud(principal, h.id)
    if body.name is not None:
        h.name = body.name.strip()
    if body.city is not None:
        h.city = body.city.strip()
    if body.address is not None:
        h.address = body.address.strip()
    if body.phone is not None:
        h.phone = body.phone
    if body.timezone is not None:
        try:
            ZoneInfo(body.timezone)
        except ZoneInfoNotFoundError:
            raise HTTPException(400, "Invalid IANA timezone")
        h.timezone = body.timezone
    if body.is_active is not None:
        h.is_active = body.is_active
    db.commit()
    db.refresh(h)
    return _hospital_out(db, h)


@router.delete("/v1/hospitals/{hospital_ref}")
def delete_hospital(
    hospital_ref: str,
    principal: Principal = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Soft-delete: deactivate hospital. Platform admin only."""
    h = _resolve_hospital(hospital_ref, db)
    h.is_active = False
    db.commit()
    db.refresh(h)
    return {"ok": True, "id": h.id, "is_active": h.is_active}


@router.get("/v1/hospitals/{hospital_ref}/qr", response_model=HospitalQrInfoOut)
def hospital_qr_info(
    hospital_ref: str,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    """QR metadata + sample seeded phones for desk/print use."""
    h = _resolve_hospital(hospital_ref, db)
    assert_hospital_access(principal, h.id)
    samples = db.execute(
        select(Patient)
        .where(Patient.hospital_id == h.id, Patient.phone.isnot(None))
        .order_by(Patient.id)
        .limit(8)
    ).scalars().all()
    return HospitalQrInfoOut(
        hospital_id=h.id,
        hospital_name=h.name,
        city=h.city,
        checkin_url=checkin_url_for_hospital(h),
        qr_png_path=f"/v1/hospitals/{h.id}/qr.png",
        sample_phones=[
            {"name": p.name, "phone": p.phone, "age": p.age} for p in samples
        ],
    )


@router.get("/v1/hospitals/{hospital_ref}/qr.png")
def hospital_qr_png(hospital_ref: str, db: Session = Depends(get_db)):
    """PNG QR code — print and stick at reception / entrance."""
    h = _resolve_hospital(hospital_ref, db)
    png = generate_hospital_qr_png(h)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "no-cache", "Content-Disposition": f'inline; filename="quivora-{h.external_id}-checkin.png"'},
    )


@router.get("/v1/hospitals/{hospital_ref}/patients/by-phone", response_model=Optional[PatientOut])
def patient_by_phone(
    hospital_ref: str,
    phone: str,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    """Staff-only full patient record — scoped to the caller's hospital."""
    h = _resolve_hospital(hospital_ref, db)
    assert_hospital_access(principal, h.id)
    return find_patient_by_phone(db, h.id, phone)


@router.get(
    "/v1/hospitals/{hospital_ref}/patients/checkin-hint",
    response_model=PatientCheckinHintOut,
)
def patient_checkin_hint(hospital_ref: str, phone: str, db: Session = Depends(get_db)):
    """Public QR check-in autofill — same hospital only, minimal fields (no contact PII)."""
    h = _resolve_hospital(hospital_ref, db)
    if not h.is_active:
        raise HTTPException(404, "Hospital not found")
    patient = find_patient_by_phone(db, h.id, phone)
    if not patient:
        return PatientCheckinHintOut(found=False)
    return PatientCheckinHintOut(found=True, name=patient.name, age=patient.age)


@router.post("/v1/hospitals/{hospital_ref}/self-checkin", response_model=SelfCheckinOut)
def hospital_self_checkin(hospital_ref: str, body: SelfCheckinBody, db: Session = Depends(get_db)):
    """Phone lookup → register if new → book doctor (QR self-registration)."""
    h = _resolve_hospital(hospital_ref, db)
    if not h.is_active:
        raise HTTPException(404, "Hospital not found")
    try:
        patient, appt, is_new = self_checkin(
            db,
            hospital=h,
            phone=body.phone,
            doctor_external_id=body.doctor_external_id,
            slot=body.slot,
            name=body.name,
            age=body.age,
            address=body.address,
            gender=body.gender,
            emergency_contact=body.emergency_contact,
            appointment_date=body.appointment_date,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return SelfCheckinOut(
        is_new_patient=is_new,
        patient=PatientOut.model_validate(patient),
        appointment=appt_out(db, appt),
        checkin_url=checkin_url_for_hospital(h),
    )


def _sync_departments_from_doctors(db: Session, hospital_id: int) -> None:
    """Backfill department rows from existing doctor department strings."""
    names = db.execute(
        select(Doctor.department).where(Doctor.hospital_id == hospital_id).distinct()
    ).scalars().all()
    existing = {
        n.lower()
        for n in db.execute(
            select(Department.name).where(Department.hospital_id == hospital_id)
        ).scalars().all()
    }
    for name in names:
        clean = (name or "").strip()
        if clean and clean.lower() not in existing:
            db.add(Department(hospital_id=hospital_id, name=clean))
            existing.add(clean.lower())
    db.commit()


@router.get("/v1/hospitals/{hospital_ref}/departments", response_model=list[DepartmentOut])
def list_departments(hospital_ref: str, db: Session = Depends(get_db)):
    h = _resolve_hospital(hospital_ref, db)
    _sync_departments_from_doctors(db, h.id)
    return db.execute(
        select(Department).where(Department.hospital_id == h.id).order_by(Department.name)
    ).scalars().all()


@router.post(
    "/v1/hospitals/{hospital_ref}/departments",
    response_model=DepartmentOut,
    dependencies=[Depends(require_staff_write)],
)
def create_department(
    hospital_ref: str,
    body: DepartmentCreate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    h = _resolve_hospital(hospital_ref, db)
    assert_hospital_manage(principal, h.id)
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Department name is required")
    existing = db.execute(
        select(Department).where(
            Department.hospital_id == h.id,
            func.lower(Department.name) == name.lower(),
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(400, f"Department '{name}' already exists")
    dept = Department(hospital_id=h.id, name=name)
    db.add(dept)
    db.commit()
    db.refresh(dept)
    return dept


@router.delete(
    "/v1/hospitals/{hospital_ref}/departments/{department_id}",
    dependencies=[Depends(require_staff_write)],
)
def delete_department(
    hospital_ref: str,
    department_id: int,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    h = _resolve_hospital(hospital_ref, db)
    assert_hospital_manage(principal, h.id)
    dept = db.get(Department, department_id)
    if not dept or dept.hospital_id != h.id:
        raise HTTPException(404, "Department not found")
    in_use = db.execute(
        select(func.count()).select_from(Doctor).where(
            Doctor.hospital_id == h.id,
            Doctor.department == dept.name,
        )
    ).scalar() or 0
    if in_use:
        raise HTTPException(400, f"Cannot delete — {in_use} doctor(s) still in this department")
    db.delete(dept)
    db.commit()
    return {"ok": True, "deleted": department_id}


@router.get("/v1/patients/search", response_model=list[PatientOut])
def search_patients(
    q: str = "",
    hospital_id: Optional[int] = None,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    hospital_id = scoped_hospital_id_optional(principal, hospital_id)
    if hospital_id is None:
        raise HTTPException(400, "hospital_id is required")
    stmt = select(Patient)
    stmt = stmt.where(Patient.hospital_id == hospital_id)
    if q.strip():
        stmt = stmt.where(Patient.name.ilike(f"%{q.strip()}%"))
    return db.execute(stmt.order_by(Patient.name).limit(20)).scalars().all()


@router.get("/v1/patients", response_model=list[PatientOut])
def list_patients(
    hospital_id: Optional[int] = None,
    limit: int = 50,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    hospital_id = scoped_hospital_id_optional(principal, hospital_id)
    if hospital_id is None:
        raise HTTPException(400, "hospital_id is required")
    stmt = (
        select(Patient)
        .where(Patient.hospital_id == hospital_id)
        .order_by(Patient.name)
        .limit(min(limit, 200))
    )
    return db.execute(stmt).scalars().all()


@router.get("/v1/opd/summary", response_model=OpdSummaryOut)
def opd_summary(
    hospital_id: Optional[int] = None,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    hospital_id = scoped_hospital_id_optional(principal, hospital_id)
    from datetime import datetime, timezone
    from app.models import AppointmentStatus

    doctor_filters = [Doctor.hospital_id == hospital_id] if hospital_id else []
    total_doctors = db.execute(
        select(func.count()).select_from(Doctor).where(*doctor_filters)
    ).scalar() or 0
    live_doctors = db.execute(
        select(func.count()).select_from(Doctor).where(
            Doctor.is_live == True,  # noqa: E712
            *doctor_filters,
        )
    ).scalar() or 0

    active_statuses = [AppointmentStatus.scheduled, AppointmentStatus.checked_in, AppointmentStatus.in_progress]
    appointment_filters = [Appointment.hospital_id == hospital_id] if hospital_id else []

    from app.services.queue import session_day_bounds_utc
    summary_hospital = db.get(Hospital, hospital_id) if hospital_id else None
    day_start, day_end = session_day_bounds_utc(summary_hospital)
    patients_in_queue = db.execute(
        select(func.count()).select_from(Appointment).where(
            Appointment.status.in_(active_statuses),
            Appointment.scheduled_at >= day_start,
            Appointment.scheduled_at < day_end,
            *appointment_filters,
        )
    ).scalar() or 0

    summary_tz = ZoneInfo("UTC")
    if hospital_id:
        if summary_hospital:
            try:
                summary_tz = ZoneInfo(summary_hospital.timezone or "Asia/Kolkata")
            except ZoneInfoNotFoundError:
                summary_tz = ZoneInfo("UTC")
    today_start = (
        datetime.now(timezone.utc)
        .astimezone(summary_tz)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc)
    )
    consultation_stmt = (
        select(func.count())
        .select_from(Appointment)
        .where(
            Appointment.status == AppointmentStatus.completed,
            Appointment.ended_at >= today_start,
        )
    )
    if hospital_id:
        consultation_stmt = consultation_stmt.where(Appointment.hospital_id == hospital_id)
    consultations_today = db.execute(consultation_stmt).scalar() or 0

    samples_stmt = (
        select(func.count())
        .select_from(DurationSample)
        .join(Doctor, DurationSample.doctor_id == Doctor.id)
    )
    if hospital_id:
        samples_stmt = samples_stmt.where(Doctor.hospital_id == hospital_id)
    total_samples = db.execute(samples_stmt).scalar() or 0

    return OpdSummaryOut(
        live_doctors=int(live_doctors),
        total_doctors=int(total_doctors),
        patients_in_queue=int(patients_in_queue),
        consultations_today=int(consultations_today),
        total_samples=int(total_samples),
    )





def _doctor_out(db: Session, d: Doctor) -> DoctorOut:
    cnt = db.execute(
        select(func.count()).select_from(DurationSample).where(DurationSample.doctor_id == d.id)
    ).scalar() or 0
    avg = db.execute(
        select(func.avg(DurationSample.duration_sec)).where(DurationSample.doctor_id == d.id)
    ).scalar()
    hosp = db.get(Hospital, d.hospital_id)
    slots = [s.strip() for s in (d.slots or "morning").split(",") if s.strip()]
    work_days = parse_work_days(getattr(d, "work_days", None))
    return DoctorOut(
        id=d.id,
        external_id=d.external_id,
        name=d.name,
        department=d.department,
        hospital_id=d.hospital_id,
        hospital_name=hosp.name if hosp else "",
        hospital_city=hosp.city if hosp else "",
        slots=slots or ["morning"],
        work_days=work_days,
        active_slot=d.active_slot,
        is_available=getattr(d, "is_available", True),
        is_on_break=getattr(d, "is_on_break", False),
        break_started_at=getattr(d, "break_started_at", None),
        delay_buffer_sec=int(getattr(d, "delay_buffer_sec", 0) or 0),
        works_today=works_today(work_days),
        sample_count=int(cnt),
        avg_duration_sec=float(avg) if avg is not None else None,
        is_live=d.is_live,
        went_live_at=d.went_live_at,
        consultation_fee=int(getattr(d, "consultation_fee", 500) or 500),
        follow_up_fee=int(getattr(d, "follow_up_fee", 300) or 300),
    )


@router.get("/v1/doctors", response_model=list[DoctorOut])
def list_doctors(
    hospital_id: Optional[int] = None,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    if principal.kind == "anonymous":
        if hospital_id is None:
            raise HTTPException(400, "hospital_id is required")
        hospital = db.get(Hospital, hospital_id)
        if not hospital or not hospital.is_active:
            raise HTTPException(404, "Hospital not found")
    else:
        hospital_id = scoped_hospital_id_optional(principal, hospital_id)
        if hospital_id is None and not is_platform_admin(principal) and not principal.is_service:
            raise HTTPException(400, "hospital_id is required")
    stmt = select(Doctor).order_by(Doctor.id)
    if hospital_id:
        stmt = stmt.where(Doctor.hospital_id == hospital_id)
    doctors = db.execute(stmt).scalars().all()
    return [_doctor_out(db, d) for d in doctors]


@router.post("/v1/hospitals/{hospital_ref}/doctors", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def create_doctor(
    hospital_ref: str,
    body: DoctorCreate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    import uuid
    h = _resolve_hospital(hospital_ref, db)
    assert_hospital_manage(principal, h.id)
    slots = [s for s in body.slots if s in ("morning", "afternoon", "evening")] or ["morning"]
    dept_name = body.department.strip()
    if not dept_name:
        raise HTTPException(400, "Department is required")
    existing_dept = db.execute(
        select(Department).where(
            Department.hospital_id == h.id,
            func.lower(Department.name) == dept_name.lower(),
        )
    ).scalar_one_or_none()
    if not existing_dept:
        existing_dept = Department(hospital_id=h.id, name=dept_name)
        db.add(existing_dept)
        db.flush()
    else:
        dept_name = existing_dept.name
    ext = body.external_id or f"DOC-{uuid.uuid4().hex[:6].upper()}"
    d = Doctor(
        hospital_id=h.id,
        external_id=ext,
        name=body.name.strip(),
        department=dept_name,
        slots=",".join(slots),
        work_days=format_work_days(body.work_days),
        is_available=body.is_available,
        consultation_fee=body.consultation_fee,
        follow_up_fee=body.follow_up_fee,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return _doctor_out(db, d)


@router.patch("/v1/doctors/{doctor_ref}", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def update_doctor(
    doctor_ref: str,
    body: DoctorUpdate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    d = _resolve_doctor(doctor_ref, db)
    if body.consultation_fee is not None or body.follow_up_fee is not None:
        assert_hospital_manage(principal, d.hospital_id)
    else:
        assert_hospital_operate(principal, d.hospital_id)
    if body.name is not None:
        d.name = body.name.strip()
    if body.department is not None:
        d.department = body.department.strip()
    if body.slots is not None:
        slots = [s for s in body.slots if s in ("morning", "afternoon", "evening")] or ["morning"]
        d.slots = ",".join(slots)
    if body.work_days is not None:
        d.work_days = format_work_days(body.work_days)
    if body.is_available is not None:
        d.is_available = body.is_available
        if not body.is_available and d.is_live:
            d.is_live = False
            d.active_slot = None
    if body.consultation_fee is not None:
        d.consultation_fee = body.consultation_fee
    if body.follow_up_fee is not None:
        d.follow_up_fee = body.follow_up_fee
    db.commit()
    db.refresh(d)
    recompute_doctor_queue_etas(db, d.id)
    return _doctor_out(db, d)


def _resolve_doctor(doctor_ref: str, db: Session) -> Doctor:
    """Accept either numeric DB id or stable external_id (e.g. DOC-001)."""
    if doctor_ref.isdigit():
        d = db.get(Doctor, int(doctor_ref))
    else:
        d = db.execute(select(Doctor).where(Doctor.external_id == doctor_ref)).scalar_one_or_none()
    if not d:
        raise HTTPException(404, "Doctor not found")
    return d


@router.get("/v1/doctors/{doctor_ref}", response_model=DoctorOut)
def get_doctor(
    doctor_ref: str,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    d = _resolve_doctor(doctor_ref, db)
    if principal.kind != "anonymous":
        assert_hospital_access(principal, d.hospital_id)
    return _doctor_out(db, d)


@router.post("/v1/doctors/{doctor_ref}/go-live", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def go_live(
    doctor_ref: str,
    slot: Optional[str] = None,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services.telegram_bot import notify_doctor_live
    from app.services.queue import clear_session_queues
    from app.models import AppointmentStatus, Prediction, SLOT_ORDER, SLOT_LABELS

    d = _resolve_doctor(doctor_ref, db)
    assert_doctor_access(principal, d.id, d.hospital_id)
    available = [s.strip() for s in (d.slots or "morning").split(",") if s.strip()] or ["morning"]
    if slot and slot not in available:
        raise HTTPException(400, f"Doctor does not offer {slot}. Available: {', '.join(available)}")
    active = slot or available[0]

    # New session: drop leftover queues from other slots / prior days
    clear_session_queues(
        db,
        d,
        keep_slot=active,
        reason=f"New {active} session started — previous queue cleared",
    )

    d.is_live = True
    d.is_on_break = False
    d.break_started_at = None
    d.delay_buffer_sec = 0
    d.active_slot = active
    d.went_live_at = datetime.now(timezone.utc)
    db.add(DoctorOpsEvent(doctor_id=d.id, event_type="go_live", timestamp=d.went_live_at))
    db.commit()
    db.refresh(d)

    from app.services.eta import recompute_doctor_queue_etas
    recompute_doctor_queue_etas(db, d.id)

    from app.services.queue import session_day_bounds_utc
    hospital = db.get(Hospital, d.hospital_id)
    day_start, day_end = session_day_bounds_utc(hospital)

    waiting = db.execute(
        select(Appointment).where(
            Appointment.doctor_id == d.id,
            Appointment.slot == active,
            Appointment.status.in_([AppointmentStatus.scheduled, AppointmentStatus.checked_in]),
            Appointment.scheduled_at >= day_start,
            Appointment.scheduled_at < day_end,
        ).order_by(Appointment.token.asc())
    ).scalars().all()

    for appt in waiting:
        pred = db.execute(
            select(Prediction).where(Prediction.appointment_id == appt.id)
        ).scalar_one_or_none()
        if not pred or not pred.eta_at or not appt.patient:
            continue
        eta_time = pred.eta_at.astimezone().strftime("%-I:%M %p")
        service = f"{d.name} · {SLOT_LABELS.get(active, active)}"
        if appt.telegram_chat_id:
            notify_doctor_live(
                appt.telegram_chat_id,
                appt.patient.name,
                appt.token,
                service,
                eta_time,
                pred.confidence_min or 10.0,
                pred.patients_ahead or 0,
                appt.public_token,
            )
        sms.notify_doctor_live(
            sms.phone_from_patient(appt.patient),
            appt.patient.name,
            appt.token,
            service,
            eta_time,
            pred.confidence_min or 10.0,
            pred.patients_ahead or 0,
            appt.public_token,
        )

    return _doctor_out(db, d)


@router.get("/v1/hospitals/{hospital_ref}/reception-board", response_model=ReceptionBoardOut)
def reception_board(
    hospital_ref: str,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    h = _resolve_hospital(hospital_ref, db)
    assert_hospital_access(principal, h.id)
    return build_reception_board(db, h.id, h.name)


@router.get(
    "/v1/hospitals/{hospital_ref}/insights",
    response_model=InsightsOut,
)
def hospital_insights(
    hospital_ref: str,
    days: int = 7,
    delay_threshold_min: int = 30,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    if days not in (1, 7, 30, 90):
        raise HTTPException(400, "days must be 1, 7, 30, or 90")
    if not 5 <= delay_threshold_min <= 180:
        raise HTTPException(400, "delay_threshold_min must be between 5 and 180")
    h = _resolve_hospital(hospital_ref, db)
    if not principal.is_service:
        role = effective_role(principal)
        if role != "hospital_admin":
            raise HTTPException(403, "Hospital admin access required for insights")
        assert_hospital_access(principal, h.id)
    return build_hospital_insights(db, h, days=days, delay_threshold_min=delay_threshold_min)


def _waiting_in_active_slot(db: Session, d: Doctor):
    from app.models import AppointmentStatus
    active = d.active_slot or "morning"
    return db.execute(
        select(Appointment).where(
            Appointment.doctor_id == d.id,
            Appointment.slot == active,
            Appointment.status.in_([
                AppointmentStatus.scheduled,
                AppointmentStatus.checked_in,
            ]),
        ).order_by(Appointment.token.asc())
    ).scalars().all()


@router.post("/v1/doctors/{doctor_ref}/break/start", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def start_break(
    doctor_ref: str,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services.telegram_bot import notify_break_started

    d = _resolve_doctor(doctor_ref, db)
    assert_doctor_access(principal, d.id, d.hospital_id)
    if not d.is_live:
        raise HTTPException(400, "Doctor must be live to start a break")
    if d.is_on_break:
        raise HTTPException(400, "Already on break")
    d.is_on_break = True
    d.break_started_at = datetime.now(timezone.utc)
    db.add(DoctorOpsEvent(doctor_id=d.id, event_type="break_start", timestamp=d.break_started_at))
    db.commit()
    db.refresh(d)
    recompute_doctor_queue_etas(db, d.id)
    for appt in _waiting_in_active_slot(db, d):
        if not appt.patient:
            continue
        if appt.telegram_chat_id:
            notify_break_started(appt.telegram_chat_id, appt.patient.name, appt.token, d.name, appt.public_token)
        sms.notify_break_started(sms.phone_from_patient(appt.patient), appt.patient.name, appt.token, d.name, appt.public_token)
    return _doctor_out(db, d)


@router.post("/v1/doctors/{doctor_ref}/break/end", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def end_break(
    doctor_ref: str,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services.telegram_bot import notify_break_ended
    from app.models import Prediction

    d = _resolve_doctor(doctor_ref, db)
    assert_doctor_access(principal, d.id, d.hospital_id)
    if not d.is_on_break:
        raise HTTPException(400, "Doctor is not on break")
    now = datetime.now(timezone.utc)
    started = d.break_started_at
    if started and started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    break_min = max(0, int((now - started).total_seconds() // 60)) if started else 0
    d.is_on_break = False
    d.break_started_at = None
    db.add(DoctorOpsEvent(
        doctor_id=d.id,
        event_type="break_end",
        value_min=break_min,
        timestamp=now,
    ))
    db.commit()
    db.refresh(d)
    recompute_doctor_queue_etas(db, d.id)
    for appt in _waiting_in_active_slot(db, d):
        if not appt.patient:
            continue
        pred = db.execute(select(Prediction).where(Prediction.appointment_id == appt.id)).scalar_one_or_none()
        eta_time = pred.eta_at.astimezone().strftime("%-I:%M %p") if pred and pred.eta_at else None
        if appt.telegram_chat_id:
            notify_break_ended(appt.telegram_chat_id, appt.patient.name, appt.token, d.name, eta_time, appt.public_token)
        sms.notify_break_ended(sms.phone_from_patient(appt.patient), appt.patient.name, appt.token, d.name, eta_time, appt.public_token)
    return _doctor_out(db, d)


@router.post("/v1/doctors/{doctor_ref}/running-late", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def running_late(
    doctor_ref: str,
    body: RunningLateBody,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from app.services.telegram_bot import notify_running_late
    from app.models import Prediction

    d = _resolve_doctor(doctor_ref, db)
    assert_doctor_access(principal, d.id, d.hospital_id)
    if not d.is_live:
        raise HTTPException(400, "Doctor must be live to broadcast running late")
    extra = body.minutes * 60
    d.delay_buffer_sec = int(getattr(d, "delay_buffer_sec", 0) or 0) + extra
    db.add(DoctorOpsEvent(doctor_id=d.id, event_type="running_late", value_min=body.minutes))
    db.commit()
    db.refresh(d)
    recompute_doctor_queue_etas(db, d.id)
    for appt in _waiting_in_active_slot(db, d):
        if not appt.patient:
            continue
        pred = db.execute(select(Prediction).where(Prediction.appointment_id == appt.id)).scalar_one_or_none()
        eta_time = pred.eta_at.astimezone().strftime("%-I:%M %p") if pred and pred.eta_at else None
        if appt.telegram_chat_id:
            notify_running_late(appt.telegram_chat_id, appt.patient.name, appt.token, d.name, body.minutes, eta_time, appt.public_token)
        sms.notify_running_late(
            sms.phone_from_patient(appt.patient), appt.patient.name, appt.token, d.name, body.minutes, eta_time,
            appt.public_token,
        )
    return _doctor_out(db, d)


@router.post("/v1/doctors/{doctor_ref}/go-offline", response_model=DoctorOut, dependencies=[Depends(require_staff_write)])
def go_offline(
    doctor_ref: str,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from app.services.queue import clear_session_queues

    d = _resolve_doctor(doctor_ref, db)
    assert_doctor_access(principal, d.id, d.hospital_id)
    ended_slot = d.active_slot or "session"
    # Session ended — empty leftover waiting queue
    clear_session_queues(
        db,
        d,
        clear_all_waiting=True,
        reason=f"{ended_slot.capitalize()} session ended — queue cleared",
    )
    db.add(DoctorOpsEvent(doctor_id=d.id, event_type="go_offline"))
    d.is_live = False
    d.active_slot = None
    d.is_on_break = False
    d.break_started_at = None
    d.delay_buffer_sec = 0
    db.commit()
    db.refresh(d)
    from app.services.eta import recompute_doctor_queue_etas
    recompute_doctor_queue_etas(db, d.id)
    return _doctor_out(db, d)


@router.get("/v1/hospitals/{hospital_ref}/availability", response_model=HospitalAvailabilityOut)
def hospital_availability(hospital_ref: str, date: Optional[str] = None, db: Session = Depends(get_db)):
    hospital = _resolve_hospital(hospital_ref, db)
    try:
        target = parse_appointment_date(date, hospital)
        validate_appointment_date(target, hospital)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return build_hospital_availability(db, hospital, target)


@router.get("/v1/doctors/{doctor_ref}/availability", response_model=DoctorAvailabilityOut)
def doctor_availability(doctor_ref: str, date: Optional[str] = None, db: Session = Depends(get_db)):
    doctor = _resolve_doctor(doctor_ref, db)
    hospital = db.get(Hospital, doctor.hospital_id)
    try:
        target = parse_appointment_date(date, hospital)
        validate_appointment_date(target, hospital)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return build_doctor_availability(db, doctor, hospital, target)


@router.get("/v1/doctors/{doctor_ref}/schedule", response_model=DoctorDayScheduleOut)
def doctor_schedule(
    doctor_ref: str,
    date: Optional[str] = None,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    doctor = _resolve_doctor(doctor_ref, db)
    assert_hospital_access(principal, doctor.hospital_id)
    assert_doctor_access(principal, doctor.id, doctor.hospital_id)
    hospital = db.get(Hospital, doctor.hospital_id)
    try:
        target = parse_schedule_date(date, hospital)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return build_doctor_day_schedule(
        db,
        doctor,
        hospital,
        target,
        appointment_mapper=lambda appt: appt_out(db, appt),
    )


@router.post("/v1/appointments", response_model=AppointmentOut, dependencies=[Depends(require_staff_write)])
def post_appointment(
    body: AppointmentCreate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    doctor = db.execute(
        select(Doctor).where(Doctor.external_id == body.doctor_external_id)
    ).scalar_one_or_none()
    if not doctor:
        raise HTTPException(400, f"Doctor not found: {body.doctor_external_id}")
    assert_hospital_operate(principal, doctor.hospital_id)
    if principal.is_his and principal.hospital_id != doctor.hospital_id:
        raise HTTPException(403, "HIS key cannot create appointments for another hospital")
    try:
        appt = create_appointment(
            db,
            doctor_external_id=body.doctor_external_id,
            age=body.age,
            patient_external_id=body.patient_external_id,
            patient_name=body.patient_name,
            patient_phone=body.patient_phone,
            external_id=body.external_id,
            token=body.token,
            appointment_type=body.appointment_type,
            slot=body.slot,
            scheduled_at=body.scheduled_at,
            appointment_date=body.appointment_date,
            priority=body.priority,
            priority_reason=body.priority_reason,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return appt_out(db, appt)


@router.get("/v1/appointments/{appointment_id}", response_model=AppointmentOut)
def get_appointment(
    appointment_id: int,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Not found")
    if principal.kind == "anonymous":
        raise HTTPException(401, "Authentication required")
    role = effective_role(principal)
    if role == "patient" and principal.patient_id == appt.patient_id:
        return appt_out(db, appt)
    if can_operate_hospital(principal, appt.hospital_id):
        return appt_out(db, appt)
    if principal.is_service or principal.is_his:
        if principal.is_his and principal.hospital_id != appt.hospital_id:
            raise HTTPException(403, "No access to this appointment")
        return appt_out(db, appt)
    raise HTTPException(403, "No access to this appointment")


@router.post("/v1/events", response_model=AppointmentOut, dependencies=[Depends(require_staff_write)])
def post_event(
    body: EventCreate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    appt = db.get(Appointment, body.appointment_id)
    if not appt:
        raise HTTPException(404, "Appointment not found")
    assert_doctor_access(principal, appt.doctor_id, appt.hospital_id)
    try:
        appt = apply_event(db, body.appointment_id, body.event_type)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return appt_out(db, appt)


@router.get("/v1/doctors/{doctor_ref}/queue", response_model=list[QueueItemOut])
def doctor_queue(
    doctor_ref: str,
    slot: Optional[str] = None,
    date: Optional[str] = None,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    doctor = _resolve_doctor(doctor_ref, db)
    assert_hospital_access(principal, doctor.hospital_id)
    assert_doctor_access(principal, doctor.id, doctor.hospital_id)
    doctor_id = doctor.id
    from app.models import AppointmentStatus, SLOT_ORDER
    from app.services.queue import session_day_bounds_utc

    hospital = db.get(Hospital, doctor.hospital_id)
    try:
        target = parse_appointment_date(date, hospital)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    when = day_anchor_utc(target, hospital)
    day_start, day_end = session_day_bounds_utc(hospital, when)
    if target == local_today(hospital):
        recompute_doctor_queue_etas(db, doctor_id)

    stmt = (
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
    if slot:
        stmt = stmt.where(Appointment.slot == slot)
    appts = db.execute(stmt).scalars().all()
    from app.models import PRIORITY_RANK, AppointmentStatus as AS
    # Sort: slot → in-progress first → priority → token
    appts = sorted(
        appts,
        key=lambda a: (
            SLOT_ORDER.get(a.slot or "morning", 9),
            0 if a.status == AS.in_progress else 1,
            PRIORITY_RANK.get(getattr(a, "priority", None) or "normal", 3),
            a.token,
        ),
    )

    # Bulk-fetch all predictions for these appointments in a single query
    appt_ids = [a.id for a in appts]
    pred_map: dict[int, Prediction] = {}
    if appt_ids:
        p_rows = db.execute(select(Prediction).where(Prediction.appointment_id.in_(appt_ids))).scalars().all()
        pred_map = {p.appointment_id: p for p in p_rows}

    # Cache predicted duration by age_band to avoid re-querying duration samples repeatedly
    duration_cache: dict[str, int] = {}

    items = []
    for a in appts:
        if a.age_band not in duration_cache:
            p_sec, _ = predict_duration_sec(db, doctor_id, a.age_band)
            duration_cache[a.age_band] = p_sec
        pred_sec = duration_cache[a.age_band]
        pred = pred_map.get(a.id)
        items.append(
            QueueItemOut(
                appointment_id=a.id,
                token=a.token,
                patient_name=a.patient.name,
                age=a.age,
                age_band=a.age_band,
                status=a.status.value,
                slot=a.slot or "morning",
                priority=getattr(a, "priority", None) or "normal",
                priority_reason=getattr(a, "priority_reason", None),
                predicted_duration_sec=pred_sec,
                eta_at=pred.eta_at if pred else None,
            )
        )
    return items


@router.patch("/v1/appointments/{appointment_id}/priority", response_model=AppointmentOut, dependencies=[Depends(require_staff_write)])
def set_appointment_priority(
    appointment_id: int,
    body: PriorityUpdate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from app.models import EventType, PRIORITY_LABELS, QueueEvent
    from datetime import datetime, timezone

    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Not found")
    assert_hospital_operate(principal, appt.hospital_id)
    p = body.priority.strip().lower()
    if p not in ("emergency", "senior", "urgent", "normal"):
        raise HTTPException(400, "priority must be emergency | senior | urgent | normal")
    reason = body.reason.strip()
    if p != "normal" and not reason:
        raise HTTPException(400, "reason required for non-normal priority")
    appt.priority = p
    appt.priority_reason = reason if p != "normal" else None
    db.add(
        QueueEvent(
            appointment_id=appt.id,
            event_type=EventType.priority_set.value,
            note=f"{PRIORITY_LABELS.get(p, p)}: {reason}" if p != "normal" else "Cleared to normal",
            timestamp=datetime.now(timezone.utc),
        )
    )
    db.commit()
    recompute_doctor_queue_etas(db, appt.doctor_id)
    db.refresh(appt)
    return appt_out(db, appt)


@router.get("/v1/appointments/{appointment_id}/eta", response_model=EtaOut)
def appointment_eta(
    appointment_id: int,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    from app.services.queue import current_serving_token

    appt = db.get(Appointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Not found")
    role = effective_role(principal)
    if role == "patient" and principal.patient_id == appt.patient_id:
        pass
    elif can_operate_hospital(principal, appt.hospital_id):
        pass
    elif principal.is_service or (principal.is_his and principal.hospital_id == appt.hospital_id):
        pass
    else:
        raise HTTPException(403, "No access to this appointment")
    recompute_doctor_queue_etas(db, appt.doctor_id)
    db.refresh(appt)
    pred_sec, conf = predict_duration_sec(db, appt.doctor_id, appt.age_band)
    pred = db.execute(select(Prediction).where(Prediction.appointment_id == appt.id)).scalar_one_or_none()
    doctor = appt.doctor
    slot = appt.slot or "morning"
    return EtaOut(
        appointment_id=appt.id,
        token=appt.token,
        patient_name=appt.patient.name,
        doctor_name=doctor.name if doctor else "",
        status=appt.status.value,
        patients_ahead=pred.patients_ahead if pred else 0,
        wait_seconds=pred.wait_seconds if pred else 0,
        eta_at=pred.eta_at if pred else None,
        confidence_min=pred.confidence_min if pred else conf,
        predicted_duration_sec=pred_sec,
        current_token=current_serving_token(db, appt.doctor_id, slot),
        slot=slot,
        doctor_live=bool(doctor and doctor.is_live and (doctor.active_slot in (None, slot))),
    )


@router.post(
    "/v1/train/bootstrap",
    response_model=TrainStartResponse,
    dependencies=[Depends(require_service)],
)
def start_training(fast: bool = False, db: Session = Depends(get_db)):
    doctors = db.execute(select(Doctor).limit(1)).scalar_one_or_none()
    if not doctors:
        raise HTTPException(400, "No doctors registered in hospital catalog")
    job = create_train_job(db)
    # UI demo: fast=false (~1 min). E2E: fast=true
    run_bootstrap_training.delay(job.id, fast=fast)
    return TrainStartResponse(
        job_id=job.id,
        status=job.status.value,
        message="Training job enqueued on Redis/Celery",
    )


@router.get("/v1/train/status/{job_id}", response_model=TrainStatusOut, dependencies=[Depends(require_service)])
def train_status(job_id: str, db: Session = Depends(get_db)):
    job = db.get(TrainJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return TrainStatusOut(
        job_id=job.id,
        status=job.status.value,
        progress_pct=job.progress_pct,
        current_doctor_name=job.current_doctor_name,
        current_doctor_external_id=job.current_doctor_external_id,
        current_department=job.current_department,
        current_patient_name=job.current_patient_name,
        current_seq=job.current_seq,
        consults_per_doctor=job.consults_per_doctor,
        doctors_total=job.doctors_total,
        doctors_done=job.doctors_done,
        samples_done=job.samples_done,
        samples_total=job.samples_total,
        doctor_progress=json.loads(job.doctor_progress_json or "{}"),
        recent_feed=json.loads(job.recent_feed_json or "[]"),
        error_message=job.error_message,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


@router.get("/v1/train/stats", response_model=TrainStatsOut, dependencies=[Depends(require_service)])
def train_stats(db: Session = Depends(get_db)):
    doctors = db.execute(select(Doctor).order_by(Doctor.id)).scalars().all()
    rows = []
    total = 0
    for d in doctors:
        cnt = db.execute(
            select(func.count()).select_from(DurationSample).where(DurationSample.doctor_id == d.id)
        ).scalar() or 0
        avg = db.execute(
            select(func.avg(DurationSample.duration_sec)).where(DurationSample.doctor_id == d.id)
        ).scalar()
        total += int(cnt)
        rows.append(
            {
                "doctor_id": d.id,
                "external_id": d.external_id,
                "name": d.name,
                "department": d.department,
                "sample_count": int(cnt),
                "avg_duration_sec": float(avg) if avg is not None else None,
            }
        )
    return TrainStatsOut(doctors=rows, total_samples=total, trained=bool(rows) and all(r["sample_count"] >= 100 for r in rows))


# ── Scan queue routes ──────────────────────────────────────────────────────────

def _machine_out(db: Session, m: ScanMachine) -> ScanMachineOut:
    cnt = db.execute(
        select(func.count()).select_from(ScanDurationSample).where(ScanDurationSample.machine_id == m.id)
    ).scalar() or 0
    avg = db.execute(
        select(func.avg(ScanDurationSample.duration_sec)).where(ScanDurationSample.machine_id == m.id)
    ).scalar()
    hosp = db.get(Hospital, m.hospital_id)
    return ScanMachineOut(
        id=m.id,
        external_id=m.external_id,
        name=m.name,
        scan_type=m.scan_type.value,
        hospital_id=m.hospital_id,
        hospital_name=hosp.name if hosp else "",
        hospital_city=hosp.city if hosp else "",
        is_live=m.is_live,
        went_live_at=m.went_live_at,
        sample_count=int(cnt),
        avg_duration_sec=float(avg) if avg is not None else None,
    )


def _resolve_machine(machine_ref: str, db: Session) -> ScanMachine:
    if machine_ref.isdigit():
        m = db.get(ScanMachine, int(machine_ref))
    else:
        m = db.execute(select(ScanMachine).where(ScanMachine.external_id == machine_ref)).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Scan machine not found")
    return m


@router.get("/v1/scans/machines", response_model=list[ScanMachineOut])
def list_machines(
    hospital_id: Optional[int] = None,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    hospital_id = scoped_hospital_id_optional(principal, hospital_id)
    if hospital_id is None and not is_platform_admin(principal) and not principal.is_service:
        raise HTTPException(400, "hospital_id is required")
    stmt = select(ScanMachine).order_by(ScanMachine.id)
    if hospital_id:
        stmt = stmt.where(ScanMachine.hospital_id == hospital_id)
    machines = db.execute(stmt).scalars().all()
    return [_machine_out(db, m) for m in machines]


@router.get("/v1/scans/machines/{machine_ref}", response_model=ScanMachineOut)
def get_machine(
    machine_ref: str,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    m = _resolve_machine(machine_ref, db)
    assert_hospital_access(principal, m.hospital_id)
    return _machine_out(db, m)


@router.post("/v1/scans/machines/{machine_ref}/go-live", response_model=ScanMachineOut, dependencies=[Depends(require_staff_write)])
def scan_go_live(
    machine_ref: str,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    from app.services.telegram_bot import notify_scan_live
    from app.models import ScanStatus, ScanPrediction

    m = _resolve_machine(machine_ref, db)
    assert_hospital_operate(principal, m.hospital_id)
    m.is_live = True
    m.went_live_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(m)

    from app.services.scan_eta import recompute_scan_queue_etas
    recompute_scan_queue_etas(db, m.id)

    waiting = db.execute(
        select(ScanAppointment).where(
            ScanAppointment.machine_id == m.id,
            ScanAppointment.status.in_([ScanStatus.scheduled, ScanStatus.arrived]),
        ).order_by(ScanAppointment.token.asc())
    ).scalars().all()

    for appt in waiting:
        pred = db.execute(
            select(ScanPrediction).where(ScanPrediction.scan_appointment_id == appt.id)
        ).scalar_one_or_none()
        if not pred or not pred.eta_at or not appt.patient:
            continue
        eta_time = pred.eta_at.astimezone().strftime("%-I:%M %p")
        if appt.telegram_chat_id:
            notify_scan_live(
                appt.telegram_chat_id,
                appt.patient.name,
                appt.token,
                m.name,
                eta_time,
                pred.confidence_min or 10.0,
                pred.patients_ahead or 0,
                appt.public_token,
            )
        sms.notify_scan_live(
            sms.phone_from_patient(appt.patient),
            appt.patient.name,
            appt.token,
            m.name,
            eta_time,
            pred.confidence_min or 10.0,
            pred.patients_ahead or 0,
            appt.public_token,
        )

    return _machine_out(db, m)


@router.post("/v1/scans/machines/{machine_ref}/go-offline", response_model=ScanMachineOut, dependencies=[Depends(require_staff_write)])
def scan_go_offline(
    machine_ref: str,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    m = _resolve_machine(machine_ref, db)
    assert_hospital_operate(principal, m.hospital_id)
    m.is_live = False
    db.commit()
    db.refresh(m)
    return _machine_out(db, m)


@router.get("/v1/scans/machines/{machine_ref}/queue", response_model=list[ScanQueueItemOut])
def scan_queue(
    machine_ref: str,
    principal: Principal = Depends(require_staff_read),
    db: Session = Depends(get_db),
):
    m = _resolve_machine(machine_ref, db)
    assert_hospital_access(principal, m.hospital_id)
    hospital = db.get(Hospital, m.hospital_id)
    today_date = local_today(hospital)
    when = day_anchor_utc(today_date, hospital)
    day_start, day_end = session_day_bounds_utc(hospital, when)

    recompute_scan_queue_etas(db, m.id)
    active = [ScanStatus.scheduled, ScanStatus.arrived, ScanStatus.in_progress]
    appts = db.execute(
        select(ScanAppointment)
        .where(
            ScanAppointment.machine_id == m.id,
            ScanAppointment.status.in_(active),
            ScanAppointment.scheduled_at >= day_start,
            ScanAppointment.scheduled_at < day_end,
        )
        .order_by(ScanAppointment.token, ScanAppointment.id)
    ).scalars().all()
    result = []
    for a in appts:
        pred = db.execute(
            select(ScanPrediction).where(ScanPrediction.scan_appointment_id == a.id)
        ).scalar_one_or_none()
        result.append(ScanQueueItemOut(
            appointment_id=a.id,
            token=a.token,
            patient_name=a.patient.name,
            age=a.age,
            age_band=a.age_band,
            status=a.status.value,
            predicted_duration_sec=pred.predicted_duration_sec if pred else 0,
            eta_at=pred.eta_at if pred else None,
        ))
    return result


@router.post("/v1/scans/appointments", response_model=ScanAppointmentOut, dependencies=[Depends(require_staff_write)])
def create_scan_appointment(
    body: ScanAppointmentCreate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    import uuid
    from app.services.age_bands import age_to_band

    m = db.execute(select(ScanMachine).where(ScanMachine.external_id == body.machine_external_id)).scalar_one_or_none()
    if not m:
        raise HTTPException(404, f"Machine {body.machine_external_id} not found")
    assert_hospital_operate(principal, m.hospital_id)

    patient_name = body.patient_name or "Walk-in patient"
    patient = Patient(
        hospital_id=m.hospital_id,
        external_id=f"PAT-SCAN-{uuid.uuid4().hex[:8].upper()}",
        name=patient_name,
        age=body.age,
        age_band=age_to_band(body.age),
    )
    db.add(patient)
    db.flush()

    last_token = db.execute(
        select(func.max(ScanAppointment.token)).where(ScanAppointment.machine_id == m.id)
    ).scalar() or 0

    from app.services.telegram_bot import notify_booked as tg_booked
    auto_chat = settings.telegram_test_recipient.strip() or None

    appt = ScanAppointment(
        external_id=f"SCAN-{uuid.uuid4().hex[:10].upper()}",
        machine_id=m.id,
        patient_id=patient.id,
        token=last_token + 1,
        age=body.age,
        age_band=age_to_band(body.age),
        status=ScanStatus.scheduled,
        telegram_chat_id=auto_chat,
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    recompute_scan_queue_etas(db, m.id)

    if auto_chat and settings.telegram_bot_token:
        ahead = db.execute(
            select(func.count()).where(
                ScanAppointment.machine_id == m.id,
                ScanAppointment.status.in_([ScanStatus.scheduled, ScanStatus.arrived]),
                ScanAppointment.token < appt.token,
            )
        ).scalar() or 0
        tg_booked(auto_chat, patient.name, appt.token, ahead, m.name, appt.public_token)

    return ScanAppointmentOut(
        id=appt.id,
        external_id=appt.external_id,
        machine_id=appt.machine_id,
        machine_name=m.name,
        scan_type=m.scan_type.value,
        patient_name=patient.name,
        token=appt.token,
        age=appt.age,
        age_band=appt.age_band,
        status=appt.status.value,
        public_token=appt.public_token,
    )


@router.post("/v1/scans/events")
def scan_event(
    body: ScanEventCreate,
    principal: Principal = Depends(require_staff_write),
    db: Session = Depends(get_db),
):
    from datetime import datetime, timezone
    appt = db.get(ScanAppointment, body.appointment_id)
    if not appt:
        raise HTTPException(404, "Scan appointment not found")
    machine = db.get(ScanMachine, appt.machine_id)
    if not machine:
        raise HTTPException(404, "Scan machine not found")
    assert_hospital_operate(principal, machine.hospital_id)

    from app.services import telegram_bot as tg_scan
    now = datetime.now(timezone.utc)
    et = body.event_type
    chat_id = appt.telegram_chat_id
    phone = sms.phone_from_patient(appt.patient)
    machine_name = machine.name if machine else "Scan"
    patient_name = appt.patient.name if appt.patient else "Patient"

    if et == "arrived":
        appt.status = ScanStatus.arrived
    elif et == "scan_started":
        appt.status = ScanStatus.in_progress
        appt.started_at = now
        if chat_id:
            tg_scan.notify_started(chat_id, patient_name, appt.token, machine_name, appt.public_token)
        sms.notify_started(phone, patient_name, appt.token, machine_name, appt.public_token)
    elif et == "scan_ended":
        appt.status = ScanStatus.completed
        appt.ended_at = now
        if appt.started_at:
            duration = int((now - appt.started_at.replace(tzinfo=timezone.utc)).total_seconds())
            record_scan_duration(db, appt.machine_id, machine.scan_type.value, appt.age_band, duration)
        if chat_id:
            tg_scan.notify_ended(chat_id, patient_name, machine_name, appt.public_token)
        sms.notify_ended(phone, patient_name, machine_name, appt.public_token)
    elif et == "no_show":
        appt.status = ScanStatus.no_show
        if chat_id:
            tg_scan.notify_no_show(chat_id, patient_name, appt.token, appt.public_token)
        sms.notify_no_show(phone, patient_name, appt.token, appt.public_token)
    else:
        raise HTTPException(400, f"Unknown event type: {et}")

    db.commit()
    db.refresh(appt)
    recompute_scan_queue_etas(db, appt.machine_id)

    m = db.get(ScanMachine, appt.machine_id)
    return ScanAppointmentOut(
        id=appt.id,
        external_id=appt.external_id,
        machine_id=appt.machine_id,
        machine_name=m.name,
        scan_type=m.scan_type.value,
        patient_name=appt.patient.name,
        token=appt.token,
        age=appt.age,
        age_band=appt.age_band,
        status=appt.status.value,
        started_at=appt.started_at,
        ended_at=appt.ended_at,
        public_token=appt.public_token,
    )


@router.get("/v1/public/tickets/{public_token}", response_model=PublicTicketOut)
def public_ticket_status(public_token: str, db: Session = Depends(get_db)):
    """Public live queue status — no login, unguessable token only."""
    from app.services.queue import current_serving_token

    appt = db.execute(
        select(Appointment).where(Appointment.public_token == public_token)
    ).scalar_one_or_none()
    if appt:
        recompute_doctor_queue_etas(db, appt.doctor_id)
        pred = db.execute(
            select(Prediction).where(Prediction.appointment_id == appt.id)
        ).scalar_one_or_none()
        doctor = appt.doctor
        slot = appt.slot or "morning"
        pred_sec, _ = predict_duration_sec(db, appt.doctor_id, appt.age_band)
        return PublicTicketOut(
            kind="opd",
            opd=EtaOut(
                appointment_id=appt.id,
                token=appt.token,
                patient_name=appt.patient.name,
                doctor_name=doctor.name if doctor else "",
                status=appt.status.value,
                patients_ahead=pred.patients_ahead if pred else 0,
                wait_seconds=pred.wait_seconds if pred else 0,
                eta_at=pred.eta_at if pred else None,
                confidence_min=pred.confidence_min if pred else 10.0,
                predicted_duration_sec=pred_sec,
                current_token=current_serving_token(db, appt.doctor_id, slot),
                slot=slot,
                doctor_live=bool(doctor and doctor.is_live and (doctor.active_slot in (None, slot))),
            ),
        )

    scan_appt = db.execute(
        select(ScanAppointment).where(ScanAppointment.public_token == public_token)
    ).scalar_one_or_none()
    if not scan_appt:
        raise HTTPException(404, "Ticket not found")
    m = db.get(ScanMachine, scan_appt.machine_id)
    if not m:
        raise HTTPException(404, "Scan machine not found")
    recompute_scan_queue_etas(db, scan_appt.machine_id)
    pred = db.execute(
        select(ScanPrediction).where(ScanPrediction.scan_appointment_id == scan_appt.id)
    ).scalar_one_or_none()
    return PublicTicketOut(
        kind="scan",
        scan=ScanEtaOut(
            appointment_id=scan_appt.id,
            token=scan_appt.token,
            patient_name=scan_appt.patient.name,
            machine_name=m.name,
            scan_type=m.scan_type.value,
            status=scan_appt.status.value,
            patients_ahead=pred.patients_ahead if pred else 0,
            wait_seconds=pred.wait_seconds if pred else 0,
            eta_at=pred.eta_at if pred else None,
            confidence_min=pred.confidence_min if pred else 5.0,
            predicted_duration_sec=pred.predicted_duration_sec if pred else 0,
        ),
    )


@router.get("/v1/scans/appointments/{appointment_id}/eta", response_model=ScanEtaOut)
def scan_eta(
    appointment_id: int,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    appt = db.get(ScanAppointment, appointment_id)
    if not appt:
        raise HTTPException(404, "Scan appointment not found")
    m = db.get(ScanMachine, appt.machine_id)
    if not m:
        raise HTTPException(404, "Scan machine not found")
    role = effective_role(principal)
    if role == "patient" and principal.patient_id == appt.patient_id:
        pass
    elif can_operate_hospital(principal, m.hospital_id):
        pass
    elif principal.is_service or (principal.is_his and principal.hospital_id == m.hospital_id):
        pass
    else:
        raise HTTPException(403, "No access to this scan appointment")
    recompute_scan_queue_etas(db, appt.machine_id)
    pred = db.execute(
        select(ScanPrediction).where(ScanPrediction.scan_appointment_id == appt.id)
    ).scalar_one_or_none()
    return ScanEtaOut(
        appointment_id=appt.id,
        token=appt.token,
        patient_name=appt.patient.name,
        machine_name=m.name,
        scan_type=m.scan_type.value,
        status=appt.status.value,
        patients_ahead=pred.patients_ahead if pred else 0,
        wait_seconds=pred.wait_seconds if pred else 0,
        eta_at=pred.eta_at if pred else None,
        confidence_min=pred.confidence_min if pred else 5.0,
        predicted_duration_sec=pred.predicted_duration_sec if pred else 0,
    )
