from __future__ import annotations

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import (
    Appointment,
    Doctor,
    DurationSample,
    Hospital,
    Patient,
    Prediction,
    QueueEvent,
    ScanAppointment,
    ScanMachine,
    ScanPrediction,
)
from app.services.seed import seed_database, seed_random_history


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_seed_random_history_fills_related_tables(db):
    seed_database(db, reset=True)
    result = seed_random_history(db, days_past=7, days_future=3, reset=True)

    assert result["appointments"] > 0
    assert result["completed"] > 0
    assert result["events"] > 0
    assert result["predictions"] > 0
    assert result["duration_samples"] > 0
    assert result["scans"] > 0

    appt_count = db.execute(select(func.count()).select_from(Appointment)).scalar()
    event_count = db.execute(select(func.count()).select_from(QueueEvent)).scalar()
    pred_count = db.execute(select(func.count()).select_from(Prediction)).scalar()
    sample_count = db.execute(select(func.count()).select_from(DurationSample)).scalar()
    scan_count = db.execute(select(func.count()).select_from(ScanAppointment)).scalar()
    scan_pred_count = db.execute(select(func.count()).select_from(ScanPrediction)).scalar()

    assert appt_count == result["appointments"]
    assert event_count == result["events"]
    assert pred_count + scan_pred_count == result["predictions"]
    assert sample_count >= result["duration_samples"]
    assert scan_count == result["scans"]
    assert scan_pred_count > 0

    dated = db.execute(
        select(Appointment.scheduled_at).where(Appointment.external_id.like("HIST-%")).limit(20)
    ).scalars().all()
    assert len(dated) > 0
    assert all(d is not None for d in dated)
