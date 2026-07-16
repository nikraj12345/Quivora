"""Hospital self-check-in via phone + QR."""

from __future__ import annotations

import io
import re
from typing import Optional, Tuple
from urllib.parse import quote

import qrcode
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Hospital, Patient
from app.services.age_bands import age_to_band
from app.services.queue import create_appointment


def normalize_phone(phone: str) -> str:
    """Keep digits only (prefer last 10 for Indian mobiles)."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) > 10:
        digits = digits[-10:]
    return digits


def format_phone_display(digits: str) -> str:
    d = normalize_phone(digits)
    if len(d) == 10:
        return f"+91 {d}"
    return digits.strip()


def find_patient_by_phone(db: Session, hospital_id: int, phone: str) -> Optional[Patient]:
    needle = normalize_phone(phone)
    if len(needle) < 8:
        return None
    patients = db.execute(
        select(Patient).where(Patient.hospital_id == hospital_id, Patient.phone.isnot(None))
    ).scalars().all()
    for p in patients:
        if normalize_phone(p.phone or "") == needle:
            return p
    return None


def checkin_url_for_hospital(hospital: Hospital) -> str:
    base = settings.frontend_base_url.rstrip("/")
    return f"{base}/checkin?hospital={quote(str(hospital.id))}"


def generate_hospital_qr_png(hospital: Hospital) -> bytes:
    url = checkin_url_for_hospital(hospital)
    qr = qrcode.QRCode(version=None, box_size=8, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def self_checkin(
    db: Session,
    hospital: Hospital,
    phone: str,
    doctor_external_id: str,
    slot: Optional[str] = None,
    name: Optional[str] = None,
    age: Optional[int] = None,
    address: Optional[str] = None,
    gender: Optional[str] = None,
    emergency_contact: Optional[str] = None,
) -> Tuple[Patient, object, bool]:
    """
    Look up patient by phone or register new; book doctor.
    Returns (patient, appointment, is_new_patient).
    """
    digits = normalize_phone(phone)
    if len(digits) < 10:
        raise ValueError("Enter a valid 10-digit mobile number")

    patient = find_patient_by_phone(db, hospital.id, digits)
    is_new = False
    if not patient:
        if not name or not name.strip():
            raise ValueError("Name is required for new patients")
        if age is None or age < 0 or age > 120:
            raise ValueError("Age is required for new patients (0–120)")
        if not address or not address.strip():
            raise ValueError("Address is required for new patients")
        gender_value = (gender or "").strip().lower()
        if gender_value not in {"female", "male", "other", "prefer_not_to_say"}:
            raise ValueError("Select a valid gender")
        emergency_digits = normalize_phone(emergency_contact or "")
        if len(emergency_digits) < 10:
            raise ValueError("Enter a valid 10-digit emergency contact")
        patient = Patient(
            hospital_id=hospital.id,
            external_id=f"QR-{digits[-8:]}",
            name=name.strip(),
            age=int(age),
            age_band=age_to_band(int(age)),
            phone=format_phone_display(digits),
            address=address.strip(),
            gender=gender_value,
            emergency_contact=format_phone_display(emergency_digits),
        )
        # Avoid external_id clash
        existing_ext = db.execute(
            select(Patient).where(
                Patient.hospital_id == hospital.id,
                Patient.external_id == patient.external_id,
            )
        ).scalar_one_or_none()
        if existing_ext:
            patient.external_id = f"QR-{digits}-{int(age)}"
        db.add(patient)
        db.flush()
        is_new = True
    else:
        # Keep phone formatted
        if not patient.phone:
            patient.phone = format_phone_display(digits)

    appt = create_appointment(
        db,
        doctor_external_id=doctor_external_id,
        age=patient.age,
        patient_external_id=patient.external_id,
        patient_name=patient.name,
        slot=slot,
        appointment_type="follow_up" if not is_new else "new",
    )
    return patient, appt, is_new
