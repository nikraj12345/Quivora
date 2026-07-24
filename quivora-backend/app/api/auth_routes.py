from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Optional

import redis
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    Principal,
    assert_hospital_manage,
    effective_role,
    generate_hospital_api_key,
    get_principal,
    require_principal,
)
from app.config import settings
from app.db import get_db
from app.models import Doctor, Hospital, HospitalApiKey, Patient, User, UserRole
from app.schemas import (
    AuthLoginIn,
    AuthMeOut,
    DoctorRoomLoginIn,
    HospitalApiKeyCreateOut,
    HospitalApiKeyOut,
    PatientOtpRequestIn,
    PatientOtpVerifyIn,
    TokenOut,
    UserCreateIn,
    UserOut,
)
from app.services.auth_tokens import create_access_token
from app.services.hospital_ref import resolve_hospital
from app.services.passwords import hash_password, verify_password

router = APIRouter(tags=["auth"])

_redis = None


def _redis_client():
    global _redis
    if _redis is None:
        _redis = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        hospital_id=user.hospital_id,
        doctor_id=user.doctor_id,
        patient_id=user.patient_id,
        is_active=user.is_active,
    )


def _auth_me(principal: Principal, db: Session) -> AuthMeOut:
    if principal.user:
        user = principal.user
        hospital_name = user.hospital.name if user.hospital else None
        doctor_name = user.doctor.name if user.doctor else None
        return AuthMeOut(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role,
            hospital_id=user.hospital_id,
            hospital_name=hospital_name,
            doctor_id=user.doctor_id,
            doctor_name=doctor_name,
            patient_id=user.patient_id,
            auth_kind="user",
        )
    if principal.patient_id:
        patient = db.get(Patient, principal.patient_id)
        if not patient:
            raise HTTPException(404, "Patient not found")
        return AuthMeOut(
            id=patient.id,
            email=None,
            name=patient.name,
            role=UserRole.patient.value,
            hospital_id=patient.hospital_id,
            hospital_name=patient.hospital.name if patient.hospital else None,
            patient_id=patient.id,
            auth_kind="patient_token",
        )
    if principal.is_service:
        return AuthMeOut(
            id=0,
            email=None,
            name="Service",
            role="service",
            auth_kind="service",
        )
    if principal.is_his:
        hospital = db.get(Hospital, principal.hospital_id) if principal.hospital_id else None
        return AuthMeOut(
            id=principal.his_key_id or 0,
            email=None,
            name="HIS Integration",
            role="his",
            hospital_id=principal.hospital_id,
            hospital_name=hospital.name if hospital else None,
            auth_kind="his",
        )
    raise HTTPException(401, "Not authenticated")


@router.post("/v1/auth/login", response_model=TokenOut)
def login(body: AuthLoginIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    token = create_access_token(
        subject=str(user.id),
        role=user.role,
        hospital_id=user.hospital_id,
        doctor_id=user.doctor_id,
        patient_id=user.patient_id,
    )
    return TokenOut(access_token=token, user=_user_out(user))


@router.post("/v1/auth/doctor-room", response_model=TokenOut)
def doctor_room_login(body: DoctorRoomLoginIn, db: Session = Depends(get_db)):
    if body.doctor_ref.isdigit():
        doctor = db.get(Doctor, int(body.doctor_ref))
    else:
        doctor = db.execute(
            select(Doctor).where(Doctor.external_id == body.doctor_ref)
        ).scalar_one_or_none()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    if not doctor.room_pin_hash:
        raise HTTPException(401, "Doctor room PIN is not configured")
    if not verify_password(body.pin, doctor.room_pin_hash):
        raise HTTPException(401, "Invalid room PIN")
    user = db.execute(
        select(User).where(User.doctor_id == doctor.id, User.role == UserRole.doctor.value)
    ).scalar_one_or_none()
    if user and user.is_active:
        user.last_login_at = datetime.now(timezone.utc)
        db.commit()
        token = create_access_token(
            subject=str(user.id),
            role=user.role,
            hospital_id=user.hospital_id,
            doctor_id=user.doctor_id,
            expires_hours=settings.doctor_room_token_hours,
        )
        return TokenOut(access_token=token, user=_user_out(user))
    token = create_access_token(
        subject=f"doctor-room:{doctor.id}",
        role=UserRole.doctor.value,
        hospital_id=doctor.hospital_id,
        doctor_id=doctor.id,
        expires_hours=settings.doctor_room_token_hours,
        extra={"doctor_room": True},
    )
    return TokenOut(
        access_token=token,
        user=UserOut(
            id=doctor.id,
            email=None,
            name=doctor.name,
            role=UserRole.doctor.value,
            hospital_id=doctor.hospital_id,
            doctor_id=doctor.id,
            is_active=True,
        ),
    )


@router.post("/v1/auth/patient/otp/request")
def patient_otp_request(body: PatientOtpRequestIn, db: Session = Depends(get_db)):
    phone = "".join(c for c in body.phone if c.isdigit())
    if len(phone) != 10:
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    hospital = db.get(Hospital, body.hospital_id)
    if not hospital:
        raise HTTPException(404, "Hospital not found")
    code = f"{secrets.randbelow(900000) + 100000:06d}"
    key = f"otp:{body.hospital_id}:{phone}"
    _redis_client().setex(key, 300, code)
    if settings.env != "production":
        return {"ok": True, "message": "OTP sent", "debug_code": code}
    # Production: integrate SMS provider
    return {"ok": True, "message": "OTP sent to your mobile"}


@router.post("/v1/auth/patient/otp/verify", response_model=TokenOut)
def patient_otp_verify(body: PatientOtpVerifyIn, db: Session = Depends(get_db)):
    phone = "".join(c for c in body.phone if c.isdigit())
    key = f"otp:{body.hospital_id}:{phone}"
    stored = _redis_client().get(key)
    if not stored or stored != body.code.strip():
        raise HTTPException(401, "Invalid or expired OTP")
    _redis_client().delete(key)
    patient = db.execute(
        select(Patient).where(Patient.hospital_id == body.hospital_id, Patient.phone == phone)
    ).scalar_one_or_none()
    if not patient:
        raise HTTPException(404, "No patient profile found for this number at this hospital")
    token = create_access_token(
        subject=f"patient:{patient.id}",
        role=UserRole.patient.value,
        hospital_id=patient.hospital_id,
        patient_id=patient.id,
        expires_hours=settings.patient_token_hours,
    )
    return TokenOut(
        access_token=token,
        user=UserOut(
            id=patient.id,
            email=None,
            name=patient.name,
            role=UserRole.patient.value,
            hospital_id=patient.hospital_id,
            patient_id=patient.id,
            is_active=True,
        ),
    )


@router.get("/v1/auth/me", response_model=AuthMeOut)
def auth_me(principal: Principal = Depends(require_principal), db: Session = Depends(get_db)):
    return _auth_me(principal, db)


@router.get("/v1/auth/users", response_model=list[UserOut])
def list_users(
    hospital_id: Optional[int] = None,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    role = effective_role(principal)
    if role != UserRole.hospital_admin.value:
        raise HTTPException(403, "Hospital admin access required")
    if not principal.hospital_id:
        raise HTTPException(403, "Hospital admin not linked to a hospital")
    q = select(User).where(User.hospital_id == principal.hospital_id).order_by(User.id)
    if hospital_id is not None and hospital_id != principal.hospital_id:
        raise HTTPException(403, "No access to this hospital")
    users = db.execute(q).scalars().all()
    return [_user_out(u) for u in users]


@router.post("/v1/auth/users", response_model=UserOut)
def create_user(
    body: UserCreateIn,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    role = effective_role(principal)
    if body.role == UserRole.platform_admin.value:
        raise HTTPException(403, "Cannot create platform admins via API")
    if body.role not in (UserRole.hospital_staff.value, UserRole.doctor.value):
        raise HTTPException(403, "Hospital admin can only create staff or doctor users")
    if role != UserRole.hospital_admin.value:
        raise HTTPException(403, "Hospital admin access required")
    if not body.hospital_id:
        raise HTTPException(400, "hospital_id required")
    assert_hospital_manage(principal, body.hospital_id)
    if body.role == UserRole.doctor.value:
        if not body.doctor_id:
            raise HTTPException(400, "doctor_id required for doctor users")
        doctor = db.get(Doctor, body.doctor_id)
        if not doctor or doctor.hospital_id != body.hospital_id:
            raise HTTPException(400, "doctor_id must belong to the same hospital")
    elif body.doctor_id is not None:
        raise HTTPException(400, "doctor_id only allowed for doctor users")
    if body.patient_id is not None:
        raise HTTPException(400, "patient_id cannot be set when creating staff users")
    email = body.email.strip().lower()
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise HTTPException(400, "Email already registered")
    user = User(
        email=email,
        name=body.name.strip(),
        password_hash=hash_password(body.password),
        role=body.role,
        hospital_id=body.hospital_id,
        doctor_id=body.doctor_id if body.role == UserRole.doctor.value else None,
        patient_id=None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@router.get("/v1/hospitals/{hospital_ref}/api-keys", response_model=list[HospitalApiKeyOut])
def list_hospital_api_keys(
    hospital_ref: str,
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    h = resolve_hospital(hospital_ref, db)
    assert_hospital_manage(principal, h.id)
    rows = db.execute(
        select(HospitalApiKey).where(HospitalApiKey.hospital_id == h.id).order_by(HospitalApiKey.id)
    ).scalars().all()
    return [
        HospitalApiKeyOut(
            id=r.id,
            hospital_id=r.hospital_id,
            name=r.name,
            key_prefix=r.key_prefix,
            is_active=r.is_active,
            created_at=r.created_at,
            last_used_at=r.last_used_at,
        )
        for r in rows
    ]


@router.post("/v1/hospitals/{hospital_ref}/api-keys", response_model=HospitalApiKeyCreateOut)
def create_hospital_api_key(
    hospital_ref: str,
    name: str = "HIS",
    principal: Principal = Depends(require_principal),
    db: Session = Depends(get_db),
):
    h = resolve_hospital(hospital_ref, db)
    assert_hospital_manage(principal, h.id)
    full, prefix, key_hash = generate_hospital_api_key()
    row = HospitalApiKey(
        hospital_id=h.id,
        name=name.strip() or "HIS",
        key_prefix=prefix,
        key_hash=key_hash,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return HospitalApiKeyCreateOut(
        id=row.id,
        hospital_id=row.hospital_id,
        name=row.name,
        key_prefix=row.key_prefix,
        api_key=full,
        is_active=row.is_active,
        created_at=row.created_at,
    )
