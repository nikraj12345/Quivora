from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt

from app.config import settings


def create_access_token(
    *,
    subject: str,
    role: str,
    hospital_id: Optional[int] = None,
    doctor_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    extra: Optional[Dict[str, Any]] = None,
    expires_hours: Optional[float] = None,
) -> str:
    now = datetime.now(timezone.utc)
    exp_hours = expires_hours if expires_hours is not None else settings.jwt_expire_hours
    payload: Dict[str, Any] = {
        "sub": subject,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=exp_hours)).timestamp()),
    }
    if hospital_id is not None:
        payload["hospital_id"] = hospital_id
    if doctor_id is not None:
        payload["doctor_id"] = doctor_id
    if patient_id is not None:
        payload["patient_id"] = patient_id
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
