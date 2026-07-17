"""Unit coverage for insights recommendation helpers and scoreboard shape."""
from __future__ import annotations

from app.services.insights import _mean, _pct, _recommendation, _score


def test_mean_and_pct_helpers():
    assert _mean([]) == 0.0
    assert _mean([10, 20, 30]) == 20.0
    assert _pct(1, 0) == 0.0
    assert _pct(3, 12) == 25.0


def test_recommendation_requires_evidence_and_action():
    rec = _recommendation(
        "idle-mri",
        "opportunity",
        "Diagnostics",
        "MRI idle after 3 PM",
        "Utilization falls to 40% after 15:00 across the last 7 days.",
        "Shift suitable bookings later in the day.",
    )
    assert rec["id"] == "idle-mri"
    assert rec["severity"] == "opportunity"
    assert rec["evidence"]
    assert rec["action"]


def test_score_row_shape():
    row = _score(
        "wait_sla",
        "Wait-time SLA",
        "amber",
        "24.0 min avg",
        "Average measured/predicted wait is 24.0 minutes.",
        "Add afternoon capacity in Cardiology.",
    )
    assert row["key"] == "wait_sla"
    assert row["status"] == "amber"
    assert row["explanation"]
    assert row["action"]
