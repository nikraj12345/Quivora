"""Lightweight column sync for dev — add new columns without Alembic."""

import secrets
import uuid

from sqlalchemy import inspect, select, text

from app.db import SessionLocal, engine
from app.services.public_tokens import generate_public_token


def _new_public_token() -> str:
    return generate_public_token()


def ensure_hospital_columns() -> None:
    insp = inspect(engine)
    if "hospitals" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("hospitals")}
    if "timezone" not in existing:
        with engine.begin() as conn:
            conn.execute(text(
                "ALTER TABLE hospitals ADD COLUMN timezone VARCHAR(64) "
                "NOT NULL DEFAULT 'Asia/Kolkata'"
            ))


def ensure_doctor_columns() -> None:
    insp = inspect(engine)
    if "doctors" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("doctors")}
    alters = [
        ("work_days", "VARCHAR(64) DEFAULT 'mon,tue,wed,thu,fri,sat'"),
        ("is_on_break", "BOOLEAN DEFAULT false"),
        ("break_started_at", "TIMESTAMP WITH TIME ZONE"),
        ("delay_buffer_sec", "INTEGER DEFAULT 0"),
        ("queue_epoch_at", "TIMESTAMP WITH TIME ZONE"),
        ("consultation_fee", "INTEGER DEFAULT 500"),
        ("follow_up_fee", "INTEGER DEFAULT 300"),
        ("room_pin_hash", "VARCHAR(255)"),
    ]
    with engine.begin() as conn:
        for col, typedef in alters:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE doctors ADD COLUMN {col} {typedef}"))
        # Fresh session tokens after upgrade / missing epoch
        if "queue_epoch_at" not in existing or True:
            conn.execute(text(
                "UPDATE doctors SET queue_epoch_at = NOW() WHERE queue_epoch_at IS NULL"
            ))


def ensure_appointment_columns() -> None:
    insp = inspect(engine)
    if "appointments" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("appointments")}
    alters = [
        ("priority", "VARCHAR(32) DEFAULT 'normal'"),
        ("priority_reason", "VARCHAR(300)"),
        ("public_token", "VARCHAR(96)"),
    ]
    with engine.begin() as conn:
        for col, typedef in alters:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE appointments ADD COLUMN {col} {typedef}"))

    if "public_token" not in existing:
        with SessionLocal() as db:
            from app.models import Appointment
            rows = db.execute(select(Appointment).where(Appointment.public_token.is_(None))).scalars().all()
            for row in rows:
                row.public_token = _new_public_token()
            if rows:
                db.commit()
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE appointments ALTER COLUMN public_token SET NOT NULL"))
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_appointments_public_token "
                "ON appointments (public_token)"
            ))

    if "events" in insp.get_table_names():
        ev_cols = {c["name"]: c for c in insp.get_columns("events")}
        with engine.begin() as conn:
            if "note" not in ev_cols:
                conn.execute(text("ALTER TABLE events ADD COLUMN note VARCHAR(300)"))
            # Convert event_type from Postgres ENUM / short VARCHAR ENUM to VARCHAR(32)
            try:
                typ = ev_cols.get("event_type", {}).get("type")
                typ_s = str(typ).lower()
                if "enum" in typ_s or "eventtype" in typ_s or (hasattr(typ, "length") and typ.length and typ.length < 32):
                    conn.execute(text(
                        "ALTER TABLE events ALTER COLUMN event_type TYPE VARCHAR(32) USING event_type::text"
                    ))
            except Exception:
                pass


def ensure_patient_columns() -> None:
    insp = inspect(engine)
    if "patients" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("patients")}
    alters = [
        ("address", "VARCHAR(500)"),
        ("gender", "VARCHAR(32)"),
        ("emergency_contact", "VARCHAR(20)"),
    ]
    with engine.begin() as conn:
        for col, typedef in alters:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE patients ADD COLUMN {col} {typedef}"))


def ensure_scan_appointment_columns() -> None:
    insp = inspect(engine)
    if "scan_appointments" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("scan_appointments")}
    if "public_token" not in existing:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE scan_appointments ADD COLUMN public_token VARCHAR(96)"))
        with SessionLocal() as db:
            from app.models import ScanAppointment
            rows = db.execute(
                select(ScanAppointment).where(ScanAppointment.public_token.is_(None))
            ).scalars().all()
            for row in rows:
                row.public_token = _new_public_token()
            if rows:
                db.commit()
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE scan_appointments ALTER COLUMN public_token SET NOT NULL"))
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_scan_appointments_public_token "
                "ON scan_appointments (public_token)"
            ))


def ensure_schema() -> None:
    ensure_hospital_columns()
    ensure_doctor_columns()
    ensure_appointment_columns()
    ensure_scan_appointment_columns()
    ensure_patient_columns()
