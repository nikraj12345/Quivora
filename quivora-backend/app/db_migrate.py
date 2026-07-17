"""Lightweight column sync for dev — add new columns without Alembic."""

from sqlalchemy import inspect, text

from app.db import engine


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
    ]
    with engine.begin() as conn:
        for col, typedef in alters:
            if col not in existing:
                conn.execute(text(f"ALTER TABLE appointments ADD COLUMN {col} {typedef}"))

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


def ensure_schema() -> None:
    ensure_hospital_columns()
    ensure_doctor_columns()
    ensure_appointment_columns()
    ensure_patient_columns()
