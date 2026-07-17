"""Deterministic accuracy tests for Insights calculations."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services.insights import (
    _doctor_available_minutes,
    _machine_available_minutes,
    _mean,
    _overlap_minutes,
    _pct,
    _prediction_wait_minutes,
    _range_start,
    _reconstructed_peak_backlog,
)


IST = ZoneInfo("Asia/Kolkata")


def test_range_start_today_uses_hospital_local_midnight():
    now = datetime(2026, 7, 17, 8, 30, tzinfo=timezone.utc)  # 14:00 IST
    since = _range_start(now, 1, IST)
    assert since == datetime(2026, 7, 17, 0, 0, tzinfo=IST).astimezone(timezone.utc)


def test_available_minutes_do_not_count_future_slots():
    now = datetime(2026, 7, 17, 5, 30, tzinfo=timezone.utc)  # 11:00 IST
    since = _range_start(now, 1, IST)
    doctor = SimpleNamespace(work_days="mon,tue,wed,thu,fri,sat", slots="morning,afternoon")
    available = _doctor_available_minutes(doctor, since, now, IST)
    # Morning started at 09:00 IST, so only 2 hours have elapsed by 11:00 IST.
    assert available == 120.0

    machine_available = _machine_available_minutes(since, now, IST)
    assert machine_available == 120.0


def test_overlap_minutes_clips_to_window():
    start = datetime(2026, 7, 17, 8, 0, tzinfo=timezone.utc)
    end = datetime(2026, 7, 17, 10, 0, tzinfo=timezone.utc)
    since = datetime(2026, 7, 17, 8, 30, tzinfo=timezone.utc)
    now = datetime(2026, 7, 17, 9, 30, tzinfo=timezone.utc)
    assert _overlap_minutes(start, end, since, now) == 60.0


def test_prediction_wait_prefers_eta_at_over_stale_wait_seconds():
    now = datetime(2026, 7, 17, 10, 0, tzinfo=timezone.utc)
    prediction = SimpleNamespace(
        eta_at=now + timedelta(minutes=12),
        wait_seconds=9999,  # stale absolute wait must not win
    )
    assert _prediction_wait_minutes(prediction, now) == 12.0


def test_reconstructed_peak_backlog_is_event_based():
    t0 = datetime(2026, 7, 17, 9, 0, tzinfo=timezone.utc)
    items = [
        SimpleNamespace(id=1, scheduled_at=t0, created_at=t0, started_at=t0 + timedelta(minutes=20)),
        SimpleNamespace(id=2, scheduled_at=t0 + timedelta(minutes=5), created_at=t0, started_at=t0 + timedelta(minutes=25)),
        SimpleNamespace(id=3, scheduled_at=t0 + timedelta(minutes=10), created_at=t0, started_at=None),
    ]
    assert _reconstructed_peak_backlog(items) == 3


def test_mean_and_pct_are_stable():
    assert _mean([10, 20, 30]) == 20.0
    assert _pct(1, 4) == 25.0
    assert _pct(1, 0) == 0.0
