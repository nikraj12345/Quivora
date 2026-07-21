from __future__ import annotations

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Appointment, AppointmentStatus, Doctor, Hospital
from app.services.availability import parse_appointment_date, works_on_date
from app.services.queue import apply_end_consult_flow, apply_event, create_appointment
from app.services.reception_board import parse_work_days


@pytest.fixture()
def db():
    from sqlalchemy import create_engine

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    hospital = Hospital(
        external_id="HOSP-TEST",
        name="Test Hospital",
        city="Mumbai",
        timezone="Asia/Kolkata",
    )
    session.add(hospital)
    session.flush()
    doctor = Doctor(
        hospital_id=hospital.id,
        external_id="DOC-TEST",
        name="Dr Test",
        department="General",
        slots="morning",
        work_days="mon,tue,wed,thu,fri,sat,sun",
        is_available=True,
        is_live=True,
        active_slot="morning",
    )
    session.add(doctor)
    session.commit()
    yield session
    session.close()


def _book(db, doctor, name: str, age: int = 35):
    return create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=age,
        patient_name=name,
        slot="morning",
    )


def test_end_consult_and_next_starts_next_patient(db):
    doctor = db.execute(select(Doctor)).scalar_one()
    first = _book(db, doctor, "Patient One")
    second = _book(db, doctor, "Patient Two")

    apply_event(db, first.id, "started")
    apply_end_consult_flow(db, first.id, "ended_and_next")

    db.refresh(first)
    db.refresh(second)
    assert first.status == AppointmentStatus.completed
    assert second.status == AppointmentStatus.in_progress
    assert second.started_at is not None


def test_end_consult_and_break_does_not_call_next(db):
    doctor = db.execute(select(Doctor)).scalar_one()
    first = _book(db, doctor, "Patient One")
    second = _book(db, doctor, "Patient Two")

    apply_event(db, first.id, "started")
    apply_end_consult_flow(db, first.id, "ended_and_break")

    db.refresh(doctor)
    db.refresh(first)
    db.refresh(second)
    assert first.status == AppointmentStatus.completed
    assert second.status == AppointmentStatus.scheduled
    assert doctor.is_on_break is True


def test_plain_ended_also_calls_next(db):
    doctor = db.execute(select(Doctor)).scalar_one()
    first = _book(db, doctor, "Patient One")
    second = _book(db, doctor, "Patient Two")

    apply_event(db, first.id, "started")
    apply_event(db, first.id, "ended")

    db.refresh(second)
    assert second.status == AppointmentStatus.in_progress
