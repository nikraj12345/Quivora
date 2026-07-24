from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Optional

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import HospitalApiKey, User, UserRole
from app.services.auth_tokens import decode_access_token


PrincipalKind = Literal["anonymous", "user", "service", "his"]


@dataclass
class Principal:
    kind: PrincipalKind
    user: Optional[User] = None
    hospital_id: Optional[int] = None
    doctor_id: Optional[int] = None
    patient_id: Optional[int] = None
    his_key_id: Optional[int] = None
    token_role: Optional[str] = None

    @property
    def is_service(self) -> bool:
        return self.kind == "service"

    @property
    def is_his(self) -> bool:
        return self.kind == "his"


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_hospital_api_key() -> tuple[str, str, str]:
    """Returns (full_key, prefix, hash)."""
    prefix = secrets.token_hex(4)
    secret = secrets.token_urlsafe(24)
    full = f"qiv_hosp_{prefix}_{secret}"
    return full, prefix, hash_api_key(full)


def _principal_from_bearer(token: str, db: Session) -> Optional[Principal]:
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        return None
    role = payload.get("role")
    if role == UserRole.patient.value and payload.get("patient_id"):
        return Principal(
            kind="user",
            hospital_id=payload.get("hospital_id"),
            patient_id=int(payload["patient_id"]),
            token_role=UserRole.patient.value,
        )
    if payload.get("doctor_room") and payload.get("doctor_id"):
        return Principal(
            kind="user",
            hospital_id=payload.get("hospital_id"),
            doctor_id=int(payload["doctor_id"]),
            token_role=UserRole.doctor.value,
        )
    sub = payload.get("sub")
    if not sub:
        return None
    user = db.get(User, int(sub))
    if not user or not user.is_active:
        return None
    return Principal(
        kind="user",
        user=user,
        hospital_id=user.hospital_id,
        doctor_id=user.doctor_id,
        patient_id=user.patient_id,
    )


def get_principal(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    x_api_key: Optional[str] = Header(default=None),
) -> Principal:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        principal = _principal_from_bearer(token, db)
        if principal:
            return principal

    if x_api_key:
        if x_api_key == settings.api_key:
            return Principal(kind="service")
        key_hash = hash_api_key(x_api_key)
        row = db.execute(
            select(HospitalApiKey).where(
                HospitalApiKey.key_hash == key_hash,
                HospitalApiKey.is_active.is_(True),
            )
        ).scalar_one_or_none()
        if row:
            row.last_used_at = datetime.now(timezone.utc)
            db.commit()
            return Principal(kind="his", hospital_id=row.hospital_id, his_key_id=row.id)

    return Principal(kind="anonymous")


def require_principal(principal: Principal = Depends(get_principal)) -> Principal:
    if principal.kind == "anonymous":
        raise HTTPException(status_code=401, detail="Authentication required")
    return principal


def effective_role(principal: Principal) -> Optional[str]:
    if principal.token_role:
        return principal.token_role
    if principal.user:
        return principal.user.role
    return None


def is_platform_admin_user(principal: Principal) -> bool:
    """True only for the platform_admin user role (not service keys)."""
    return effective_role(principal) == UserRole.platform_admin.value


def is_platform_admin(principal: Principal) -> bool:
    """Platform admin user or service key — hospital catalog / platform tooling."""
    if principal.is_service:
        return True
    return is_platform_admin_user(principal)


def can_access_hospital(principal: Principal, hospital_id: int) -> bool:
    """View access. Platform admin may view hospital records only (not ops data via staff deps)."""
    if principal.is_service:
        return True
    if principal.is_his:
        return principal.hospital_id == hospital_id
    role = effective_role(principal)
    if role == UserRole.platform_admin.value:
        return True
    if role in (UserRole.hospital_admin.value, UserRole.hospital_staff.value, UserRole.patient.value):
        return principal.hospital_id == hospital_id
    if role == UserRole.doctor.value and principal.hospital_id == hospital_id:
        return True
    return False


def assert_hospital_access(principal: Principal, hospital_id: int) -> None:
    if not can_access_hospital(principal, hospital_id):
        raise HTTPException(status_code=403, detail="No access to this hospital")


def allowed_hospital_ids(principal: Principal) -> Optional[list[int]]:
    """None = unrestricted (platform admin / service). Otherwise only listed hospital ids."""
    if is_platform_admin(principal):
        return None
    if principal.hospital_id is None:
        raise HTTPException(status_code=403, detail="Hospital scope required")
    return [principal.hospital_id]


def scoped_hospital_id(principal: Principal, requested: Optional[int] = None) -> int:
    """Resolve hospital_id for endpoints that require one. Non-admins cannot override their tenant."""
    if principal.is_service:
        if requested is None:
            raise HTTPException(status_code=400, detail="hospital_id is required")
        return requested
    if is_platform_admin_user(principal):
        raise HTTPException(status_code=403, detail="Platform admin can only manage hospital records")
    if principal.hospital_id is None:
        raise HTTPException(status_code=403, detail="Hospital scope required")
    if requested is not None and requested != principal.hospital_id:
        raise HTTPException(status_code=403, detail="No access to this hospital")
    return principal.hospital_id


def scoped_hospital_id_optional(principal: Principal, requested: Optional[int] = None) -> Optional[int]:
    """Service may omit hospital_id to query all; tenant users are pinned to their hospital.
    Platform admin cannot use hospital-scoped ops endpoints."""
    if principal.is_service:
        return requested
    if is_platform_admin_user(principal):
        raise HTTPException(status_code=403, detail="Platform admin can only manage hospital records")
    if principal.hospital_id is None:
        raise HTTPException(status_code=403, detail="Hospital scope required")
    if requested is not None and requested != principal.hospital_id:
        raise HTTPException(status_code=403, detail="No access to this hospital")
    return principal.hospital_id


def assert_authenticated_hospital_access(principal: Principal, hospital_id: int) -> None:
    if principal.kind == "anonymous":
        raise HTTPException(status_code=401, detail="Authentication required")
    assert_hospital_access(principal, hospital_id)


def can_crud_hospital(principal: Principal, hospital_id: int) -> bool:
    """Create/update/delete hospital entity — platform admin or that hospital's admin."""
    if principal.is_service:
        return True
    role = effective_role(principal)
    if role == UserRole.platform_admin.value:
        return True
    return role == UserRole.hospital_admin.value and principal.hospital_id == hospital_id


def assert_hospital_crud(principal: Principal, hospital_id: int) -> None:
    if not can_crud_hospital(principal, hospital_id):
        raise HTTPException(status_code=403, detail="Hospital CRUD access required")


def can_manage_hospital(principal: Principal, hospital_id: int) -> bool:
    """Hospital settings (doctors, departments, fees) — hospital admin only, not platform."""
    if principal.is_service:
        return True
    role = effective_role(principal)
    return role == UserRole.hospital_admin.value and principal.hospital_id == hospital_id


def assert_hospital_manage(principal: Principal, hospital_id: int) -> None:
    if not can_manage_hospital(principal, hospital_id):
        raise HTTPException(status_code=403, detail="Hospital admin access required")


def can_operate_hospital(principal: Principal, hospital_id: int) -> bool:
    """Day-to-day ops — hospital admin/staff/doctor. Platform admin excluded."""
    if can_manage_hospital(principal, hospital_id):
        return True
    role = effective_role(principal)
    if role == UserRole.hospital_staff.value and principal.hospital_id == hospital_id:
        return True
    if role == UserRole.doctor.value and principal.hospital_id == hospital_id:
        return True
    return False


def assert_hospital_operate(principal: Principal, hospital_id: int) -> None:
    if not can_operate_hospital(principal, hospital_id):
        raise HTTPException(status_code=403, detail="Hospital staff access required")


def can_use_doctor(principal: Principal, doctor_id: int, hospital_id: int) -> bool:
    if can_operate_hospital(principal, hospital_id):
        return True
    role = effective_role(principal)
    if role == UserRole.doctor.value and principal.doctor_id == doctor_id:
        return True
    return False


def assert_doctor_access(principal: Principal, doctor_id: int, hospital_id: int) -> None:
    if not can_use_doctor(principal, doctor_id, hospital_id):
        raise HTTPException(status_code=403, detail="Doctor room access required")


def require_platform_admin(principal: Principal = Depends(require_principal)) -> Principal:
    if not is_platform_admin(principal):
        raise HTTPException(status_code=403, detail="Platform admin required")
    return principal


def require_service(principal: Principal = Depends(require_principal)) -> Principal:
    if not principal.is_service:
        raise HTTPException(status_code=403, detail="Service API key required")
    return principal


def require_staff_write(principal: Principal = Depends(require_principal)) -> Principal:
    """Hospital ops write access — excludes platform_admin (hospital CRUD only)."""
    if principal.is_service or principal.is_his:
        return principal
    if is_platform_admin_user(principal):
        raise HTTPException(status_code=403, detail="Platform admin can only manage hospital records")
    role = effective_role(principal)
    allowed = {
        UserRole.hospital_admin.value,
        UserRole.hospital_staff.value,
        UserRole.doctor.value,
    }
    if role in allowed:
        return principal
    raise HTTPException(status_code=403, detail="Staff access required")


def require_staff_read(principal: Principal = Depends(require_principal)) -> Principal:
    return require_staff_write(principal)
