from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Hospital


def resolve_hospital(hospital_ref: str, db: Session) -> Hospital:
    if hospital_ref.isdigit():
        h = db.get(Hospital, int(hospital_ref))
    else:
        h = db.execute(select(Hospital).where(Hospital.external_id == hospital_ref)).scalar_one_or_none()
    if not h:
        raise HTTPException(404, "Hospital not found")
    return h
