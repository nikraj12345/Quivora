from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import Appointment, AppointmentStatus, Doctor, Hospital, Patient
from app.services.availability import (
    build_doctor_availability,
    build_doctor_day_schedule,
    estimated_slot_capacity,
    occupancy_pct,
    parse_appointment_date,
    slot_scheduled_at,
    validate_appointment_date,
    works_on_date,
)
from app.services.queue import create_appointment
from app.services.reception_board import parse_work_days


@pytest.fixture()
def db():
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
        slots="morning,evening",
        work_days="mon,tue,wed,thu,fri,sat",
        is_available=True,
    )
    session.add(doctor)
    session.commit()
    yield session
    session.close()


def test_validate_appointment_date_rejects_past(db):
    hospital = db.execute(select(Hospital)).scalar_one()
    today = parse_appointment_date(None, hospital)
    with pytest.raises(ValueError, match="past"):
        validate_appointment_date(today - timedelta(days=1), hospital)


def test_works_on_date_respects_schedule(db):
    hospital = db.execute(select(Hospital)).scalar_one()
    doctor = db.execute(select(Doctor)).scalar_one()
    work_days = parse_work_days(doctor.work_days)
    monday = date(2026, 7, 20)  # Monday
    sunday = date(2026, 7, 19)
    assert works_on_date(work_days, monday, hospital) is True
    assert works_on_date(work_days, sunday, hospital) is False


def test_build_doctor_availability_marks_off_days(db):
    hospital = db.execute(select(Hospital)).scalar_one()
    doctor = db.execute(select(Doctor)).scalar_one()
    sunday = date(2026, 7, 19)
    payload = build_doctor_availability(db, doctor, hospital, sunday)
    assert payload["works_that_day"] is False
    assert all(slot["available"] is False for slot in payload["slots"])


def test_create_appointment_scopes_token_by_date(db):
    hospital = db.execute(select(Hospital)).scalar_one()
    doctor = db.execute(select(Doctor)).scalar_one()
    future = parse_appointment_date(None, hospital) + timedelta(days=3)
    while not works_on_date(parse_work_days(doctor.work_days), future, hospital):
        future += timedelta(days=1)

    first = create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=35,
        patient_name="Future One",
        appointment_date=future,
        slot="morning",
    )
    second = create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=40,
        patient_name="Future Two",
        appointment_date=future,
        slot="morning",
    )
    assert first.token == 1
    assert second.token == 2

    today_appt = create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=28,
        patient_name="Today One",
        slot="morning",
    )
    assert today_appt.token == 1

    scheduled = slot_scheduled_at(hospital, future, "morning")
    count = db.execute(
        select(func.count())
        .select_from(Appointment)
        .where(
            Appointment.doctor_id == doctor.id,
            Appointment.slot == "morning",
            Appointment.scheduled_at == scheduled,
            Appointment.status == AppointmentStatus.scheduled,
        )
    ).scalar()
    assert count == 2


def test_estimated_slot_capacity_uses_avg_duration():
    assert estimated_slot_capacity(900, "morning") == 16
    assert estimated_slot_capacity(None, "morning") == 16


def test_occupancy_pct_caps_at_100():
    assert occupancy_pct(20, 16) == 100
    assert occupancy_pct(8, 16) == 50


def test_build_doctor_day_schedule_counts_and_occupancy(db):
    hospital = db.execute(select(Hospital)).scalar_one()
    doctor = db.execute(select(Doctor)).scalar_one()
    future = parse_appointment_date(None, hospital) + timedelta(days=3)
    while not works_on_date(parse_work_days(doctor.work_days), future, hospital):
        future += timedelta(days=1)

    create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=35,
        patient_name="Morning One",
        appointment_date=future,
        slot="morning",
    )
    create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=40,
        patient_name="Morning Two",
        appointment_date=future,
        slot="morning",
    )
    create_appointment(
        db,
        doctor_external_id=doctor.external_id,
        age=28,
        patient_name="Evening One",
        appointment_date=future,
        slot="evening",
    )

    payload = build_doctor_day_schedule(
        db,
        doctor,
        hospital,
        future,
        appointment_mapper=lambda appt: {
            "id": appt.id,
            "token": appt.token,
            "slot": appt.slot,
            "status": appt.status.value,
        },
    )

    assert payload["works_that_day"] is True
    assert payload["total_appointments"] == 3
    morning = next(s for s in payload["slots"] if s["slot"] == "morning")
    evening = next(s for s in payload["slots"] if s["slot"] == "evening")
    assert morning["active_count"] == 2
    assert evening["active_count"] == 1
    assert morning["occupancy_pct"] > 0
    assert len(payload["appointments"]) == 3
