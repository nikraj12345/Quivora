"""Hospital-local time helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models import Hospital


def hospital_zone(hospital: Optional[Hospital]) -> ZoneInfo:
    name = (getattr(hospital, "timezone", None) or "Asia/Kolkata").strip() or "Asia/Kolkata"
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Kolkata")


def session_day_bounds_utc(
    hospital: Optional[Hospital],
    when: Optional[datetime] = None,
) -> tuple[datetime, datetime]:
    """Return [day_start, day_end) in UTC for the hospital's local calendar day."""
    tz = hospital_zone(hospital)
    now = (when or datetime.now(timezone.utc)).astimezone(tz)
    start_local = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)
