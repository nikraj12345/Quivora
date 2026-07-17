"""Hospital-scoped operational analytics and evidence-backed recommendations."""

from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Appointment,
    AppointmentStatus,
    AppointmentType,
    Doctor,
    DoctorOpsEvent,
    DurationSample,
    Hospital,
    Prediction,
    QueueEvent,
    ScanAppointment,
    ScanDurationSample,
    ScanMachine,
    ScanPrediction,
    ScanStatus,
    WEEKDAYS,
)
from app.services.reception_board import parse_work_days


ACTIVE_APPOINTMENT_STATUSES = {
    AppointmentStatus.scheduled,
    AppointmentStatus.checked_in,
    AppointmentStatus.in_progress,
}
ACTIVE_SCAN_STATUSES = {
    ScanStatus.scheduled,
    ScanStatus.arrived,
    ScanStatus.in_progress,
}
SLOT_MINUTES = 4 * 60
MACHINE_DAY_MINUTES = 12 * 60  # v1 assumption: 9 AM–9 PM
SLOT_HOURS = {
    "morning": (9, 13),
    "afternoon": (13, 17),
    "evening": (17, 21),
}


def _aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _event_time(obj: Any) -> Optional[datetime]:
    return _aware(getattr(obj, "scheduled_at", None) or getattr(obj, "created_at", None))


def _timestamp_in_range(value: Optional[datetime], since: datetime, now: datetime) -> bool:
    value = _aware(value)
    return bool(value and since <= value <= now)


def _in_range(obj: Any, since: datetime, now: datetime) -> bool:
    value = _event_time(obj)
    return bool(value and since <= value <= now)


def _duration_minutes(started: Optional[datetime], ended: Optional[datetime]) -> Optional[float]:
    start = _aware(started)
    end = _aware(ended)
    if not start or not end or end < start:
        return None
    return max(0.0, (end - start).total_seconds() / 60.0)


def _mean(values: Iterable[float]) -> float:
    vals = list(values)
    return round(statistics.mean(vals), 1) if vals else 0.0


def _pct(part: float, total: float) -> float:
    return round((part / total) * 100.0, 1) if total else 0.0


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value))


def _range_start(now: datetime, days: int, hospital_tz: ZoneInfo) -> datetime:
    if days == 1:
        local_now = now.astimezone(hospital_tz)
        return local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    return now - timedelta(days=days)


def _days_in_range(since: datetime, now: datetime, hospital_tz: ZoneInfo = ZoneInfo("UTC")) -> list[date]:
    current = since.astimezone(hospital_tz).date()
    final_day = now.astimezone(hospital_tz).date()
    result: list[date] = []
    while current <= final_day:
        result.append(current)
        current += timedelta(days=1)
    return result


def _overlap_minutes(start: datetime, end: datetime, since: datetime, now: datetime) -> float:
    overlap_start = max(_aware(start), since)
    overlap_end = min(_aware(end), now)
    return max(0.0, (overlap_end - overlap_start).total_seconds() / 60.0)


def _doctor_available_minutes(
    doctor: Doctor,
    since: datetime,
    now: datetime,
    hospital_tz: ZoneInfo = ZoneInfo("UTC"),
) -> float:
    work_days = set(parse_work_days(doctor.work_days))
    slots = [s.strip() for s in (doctor.slots or "morning").split(",") if s.strip()]
    available = 0.0
    for day in _days_in_range(since, now, hospital_tz):
        if WEEKDAYS[day.weekday()] not in work_days:
            continue
        for slot in slots:
            start_hour, end_hour = SLOT_HOURS.get(slot, SLOT_HOURS["morning"])
            start = datetime.combine(day, time(start_hour), tzinfo=hospital_tz).astimezone(timezone.utc)
            end = datetime.combine(day, time(end_hour), tzinfo=hospital_tz).astimezone(timezone.utc)
            available += _overlap_minutes(start, end, since, now)
    return available


def _machine_available_minutes(
    since: datetime,
    now: datetime,
    hospital_tz: ZoneInfo = ZoneInfo("UTC"),
) -> float:
    available = 0.0
    for day in _days_in_range(since, now, hospital_tz):
        start = datetime.combine(day, time(9), tzinfo=hospital_tz).astimezone(timezone.utc)
        end = datetime.combine(day, time(21), tzinfo=hospital_tz).astimezone(timezone.utc)
        available += _overlap_minutes(start, end, since, now)
    return available


def _prediction_wait_minutes(prediction: Any, now: datetime) -> float:
    eta_at = _aware(getattr(prediction, "eta_at", None))
    if eta_at:
        return max(0.0, (eta_at - now).total_seconds() / 60.0)
    return max(0.0, float(getattr(prediction, "wait_seconds", 0) or 0) / 60.0)


def _reconstructed_peak_backlog(
    items: list[Any],
    exit_times: Optional[dict[int, datetime]] = None,
) -> int:
    """Reconstruct waiting backlog from queue-entry and queue-exit boundaries."""
    boundaries: list[tuple[datetime, int]] = []
    exit_times = exit_times or {}
    for item in items:
        entered = _event_time(item)
        if not entered:
            continue
        exited = _aware(getattr(item, "started_at", None)) or _aware(exit_times.get(item.id))
        boundaries.append((entered, 1))
        if exited and exited >= entered:
            boundaries.append((exited, -1))
    current = peak = 0
    for _, delta in sorted(boundaries, key=lambda pair: (pair[0], pair[1])):
        current = max(0, current + delta)
        peak = max(peak, current)
    return peak


def _score(
    key: str,
    label: str,
    status: str,
    value: str,
    explanation: str,
    action: str,
) -> dict[str, str]:
    return {
        "key": key,
        "label": label,
        "status": status,
        "value": value,
        "explanation": explanation,
        "action": action,
    }


def _recommendation(
    key: str,
    severity: str,
    category: str,
    title: str,
    evidence: str,
    action: str,
) -> dict[str, str]:
    return {
        "id": key,
        "severity": severity,
        "category": category,
        "title": title,
        "evidence": evidence,
        "action": action,
    }


def build_hospital_insights(
    db: Session,
    hospital: Hospital,
    days: int = 7,
    delay_threshold_min: int = 30,
) -> dict[str, Any]:
    days = max(1, min(int(days), 90))
    delay_threshold_min = max(5, min(int(delay_threshold_min), 180))
    now = datetime.now(timezone.utc)
    try:
        hospital_tz = ZoneInfo(getattr(hospital, "timezone", None) or "Asia/Kolkata")
    except ZoneInfoNotFoundError:
        hospital_tz = ZoneInfo("UTC")
    since = _range_start(now, days, hospital_tz)

    doctors = db.execute(
        select(Doctor).where(Doctor.hospital_id == hospital.id).order_by(Doctor.department, Doctor.name)
    ).scalars().all()
    doctor_ids = [d.id for d in doctors]
    machines = db.execute(
        select(ScanMachine).where(ScanMachine.hospital_id == hospital.id).order_by(ScanMachine.name)
    ).scalars().all()
    machine_ids = [m.id for m in machines]

    all_appts = db.execute(
        select(Appointment).where(Appointment.hospital_id == hospital.id)
    ).scalars().all()
    appts = [a for a in all_appts if _in_range(a, since, now)]
    appointment_ids = [a.id for a in all_appts]
    queue_events = (
        db.execute(
            select(QueueEvent)
            .where(QueueEvent.appointment_id.in_(appointment_ids))
            .order_by(QueueEvent.timestamp.asc())
        ).scalars().all()
        if appointment_ids else []
    )
    events_by_appt: dict[int, list[QueueEvent]] = defaultdict(list)
    for event in queue_events:
        events_by_appt[event.appointment_id].append(event)

    def event_timestamp(appt_id: int, event_type: str) -> Optional[datetime]:
        return next(
            (_aware(e.timestamp) for e in events_by_appt[appt_id] if e.event_type == event_type),
            None,
        )

    scan_all = (
        db.execute(select(ScanAppointment).where(ScanAppointment.machine_id.in_(machine_ids))).scalars().all()
        if machine_ids else []
    )
    scan_appts = [a for a in scan_all if _in_range(a, since, now)]

    # "Waiting now" excludes future bookings and stale scheduled rows from prior days.
    today_start = (
        now.astimezone(hospital_tz)
        .replace(hour=0, minute=0, second=0, microsecond=0)
        .astimezone(timezone.utc)
    )

    def queue_entry(appt: Appointment) -> Optional[datetime]:
        return event_timestamp(appt.id, "checked_in") or _event_time(appt)

    active_appts = [
        a for a in all_appts
        if a.status in ACTIVE_APPOINTMENT_STATUSES
        and (
            _timestamp_in_range(queue_entry(a), today_start, now)
            or _timestamp_in_range(a.started_at, today_start, now)
        )
    ]
    active_scans = [
        a for a in scan_all
        if a.status in ACTIVE_SCAN_STATUSES
        and (
            _timestamp_in_range(_event_time(a), today_start, now)
            or _timestamp_in_range(a.started_at, today_start, now)
        )
    ]
    active_appt_ids = [a.id for a in active_appts]
    active_scan_ids = [a.id for a in active_scans]

    predictions = {
        p.appointment_id: p
        for p in (
            db.execute(select(Prediction).where(Prediction.appointment_id.in_(active_appt_ids))).scalars().all()
            if active_appt_ids else []
        )
    }
    scan_predictions = {
        p.scan_appointment_id: p
        for p in (
            db.execute(select(ScanPrediction).where(ScanPrediction.scan_appointment_id.in_(active_scan_ids))).scalars().all()
            if active_scan_ids else []
        )
    }

    duration_samples = (
        db.execute(select(DurationSample).where(DurationSample.doctor_id.in_(doctor_ids))).scalars().all()
        if doctor_ids else []
    )
    scan_samples = (
        db.execute(select(ScanDurationSample).where(ScanDurationSample.machine_id.in_(machine_ids))).scalars().all()
        if machine_ids else []
    )
    ops_events = (
        db.execute(
            select(DoctorOpsEvent).where(
                DoctorOpsEvent.doctor_id.in_(doctor_ids),
                DoctorOpsEvent.timestamp >= since,
            )
        ).scalars().all()
        if doctor_ids else []
    )

    priority_events = [
        event for event in reversed(queue_events)
        if event.event_type in {"priority_set", "emergency_insert"}
        and _timestamp_in_range(event.timestamp, since, now)
    ]

    completed = [
        a for a in all_appts
        if a.status == AppointmentStatus.completed
        and _timestamp_in_range(a.ended_at, since, now)
    ]
    completed_scans_range = [
        a for a in scan_all
        if a.status == ScanStatus.completed
        and _timestamp_in_range(a.ended_at, since, now)
    ]
    no_shows = [
        a for a in all_appts
        if a.status == AppointmentStatus.no_show
        and _timestamp_in_range(event_timestamp(a.id, "no_show") or _event_time(a), since, now)
    ]
    wait_observations: list[tuple[Appointment, float, str]] = []
    for appt in all_appts:
        started = _aware(appt.started_at)
        if not _timestamp_in_range(started, since, now):
            continue
        checked_in = event_timestamp(appt.id, "checked_in")
        arrival = checked_in or _event_time(appt)
        if arrival and started and arrival <= started:
            wait_observations.append((
                appt,
                max(0.0, (started - arrival).total_seconds() / 60.0),
                "check-in" if checked_in else "scheduled",
            ))
    actual_waits = [
        wait for _, wait, _ in wait_observations
    ]
    predicted_waits = [
        _prediction_wait_minutes(p, now) for p in predictions.values()
    ] + [
        _prediction_wait_minutes(p, now) for p in scan_predictions.values()
    ]
    avg_wait_min = _mean(actual_waits or predicted_waits)
    considered_outcomes = len(completed) + len(no_shows)
    no_show_rate = _pct(len(no_shows), considered_outcomes)
    priority_count = sum(1 for a in appts if (a.priority or "normal") in {"emergency", "urgent"})
    priority_share = _pct(priority_count, len(appts))

    bottlenecks: list[dict[str, Any]] = []
    for doctor in doctors:
        queue = [a for a in active_appts if a.doctor_id == doctor.id]
        wait = max(
            [_prediction_wait_minutes(predictions[a.id], now) for a in queue if a.id in predictions] or [0.0]
        )
        bottlenecks.append({
            "type": "doctor",
            "name": doctor.name,
            "department": doctor.department,
            "queue": len(queue),
            "wait_min": round(wait, 1),
        })
    for machine in machines:
        queue = [a for a in active_scans if a.machine_id == machine.id]
        wait = max(
            [_prediction_wait_minutes(scan_predictions[a.id], now) for a in queue if a.id in scan_predictions] or [0.0]
        )
        bottlenecks.append({
            "type": "machine",
            "name": machine.name,
            "department": _enum_value(machine.scan_type).replace("_", " ").title(),
            "queue": len(queue),
            "wait_min": round(wait, 1),
        })
    longest_bottleneck = max(
        bottlenecks,
        key=lambda x: (x["wait_min"], x["queue"]),
        default={"type": "none", "name": "No active bottleneck", "department": "", "queue": 0, "wait_min": 0.0},
    )

    # Doctor analytics
    samples_by_doctor: dict[int, list[DurationSample]] = defaultdict(list)
    for sample in duration_samples:
        samples_by_doctor[sample.doctor_id].append(sample)
    appts_by_doctor: dict[int, list[Appointment]] = defaultdict(list)
    for appt in appts:
        appts_by_doctor[appt.doctor_id].append(appt)
    completed_by_doctor: dict[int, list[Appointment]] = defaultdict(list)
    for appt in completed:
        completed_by_doctor[appt.doctor_id].append(appt)
    active_by_doctor: dict[int, list[Appointment]] = defaultdict(list)
    for appt in active_appts:
        active_by_doctor[appt.doctor_id].append(appt)
    ops_by_doctor: dict[int, list[DoctorOpsEvent]] = defaultdict(list)
    for event in ops_events:
        ops_by_doctor[event.doctor_id].append(event)

    doctor_avg: dict[int, float] = {}
    doctor_source: dict[int, str] = {}
    doctor_observations: dict[int, int] = {}
    actual_durations_by_doctor: dict[int, list[float]] = defaultdict(list)
    for doctor in doctors:
        actual = [
            value for value in (
                _duration_minutes(a.started_at, a.ended_at) for a in completed_by_doctor[doctor.id]
            ) if value is not None
        ]
        actual_durations_by_doctor[doctor.id] = actual
        live_samples = [
            s.duration_sec / 60.0 for s in samples_by_doctor[doctor.id]
            if s.source == "live" and _timestamp_in_range(s.created_at, since, now)
        ]
        baseline = [
            s.duration_sec / 60.0 for s in samples_by_doctor[doctor.id]
            if s.source != "live"
        ]
        values = actual or live_samples or baseline
        doctor_avg[doctor.id] = _mean(values)
        doctor_observations[doctor.id] = len(actual or live_samples)
        if actual:
            doctor_source[doctor.id] = "completed consultations"
        elif live_samples:
            doctor_source[doctor.id] = "live duration samples"
        elif baseline:
            doctor_source[doctor.id] = "learned baseline"
        else:
            doctor_source[doctor.id] = "no duration data"
    dept_values: dict[str, list[float]] = defaultdict(list)
    dept_live_observations: Counter[str] = Counter()
    for doctor in doctors:
        actual = actual_durations_by_doctor[doctor.id]
        if actual:
            dept_values[doctor.department].extend(actual)
            dept_live_observations[doctor.department] += len(actual)
        elif doctor_avg[doctor.id] > 0:
            dept_values[doctor.department].append(doctor_avg[doctor.id])
    dept_avg = {dept: _mean(values) for dept, values in dept_values.items()}

    doctor_rows: list[dict[str, Any]] = []
    for doctor in doctors:
        doctor_appts = appts_by_doctor[doctor.id]
        doctor_completed = completed_by_doctor[doctor.id]
        actual_minutes = [
            value for value in (
                _duration_minutes(a.started_at, a.ended_at) for a in doctor_completed
            ) if value is not None
        ]
        available_min = _doctor_available_minutes(doctor, since, now, hospital_tz)
        consultation_min = sum(actual_minutes)
        utilization = min(100.0, _pct(consultation_min, available_min))
        priority_mix = Counter((a.priority or "normal") for a in doctor_appts)
        doctor_events = ops_by_doctor[doctor.id]
        break_starts = sum(1 for e in doctor_events if e.event_type == "break_start")
        delay_events = [e for e in doctor_events if e.event_type == "running_late"]
        queue = active_by_doctor[doctor.id]
        downstream_wait = sum(
            _prediction_wait_minutes(predictions[a.id], now) for a in queue if a.id in predictions
        )
        department_average = dept_avg.get(doctor.department, 0.0)
        variance_pct = (
            round(((doctor_avg[doctor.id] - department_average) / department_average) * 100.0, 1)
            if department_average else 0.0
        )
        doctor_rows.append({
            "id": doctor.id,
            "external_id": doctor.external_id,
            "name": doctor.name,
            "department": doctor.department,
            "patients_seen": len(doctor_completed),
            "patients_per_day": round(
                len(doctor_completed) / max(1, len(_days_in_range(since, now, hospital_tz))),
                1,
            ),
            "avg_consult_min": doctor_avg[doctor.id],
            "department_avg_min": department_average,
            "variance_vs_department_pct": variance_pct,
            "downstream_wait_min": round(downstream_wait, 1),
            "break_events": break_starts,
            "delay_events": len(delay_events),
            "delay_minutes": sum(e.value_min or 0 for e in delay_events),
            "priority_mix": {
                "emergency": priority_mix.get("emergency", 0),
                "senior": priority_mix.get("senior", 0),
                "urgent": priority_mix.get("urgent", 0),
                "normal": priority_mix.get("normal", 0),
            },
            "utilization_pct": utilization,
            "queue_now": len(queue),
            "is_live": doctor.is_live,
            "is_on_break": doctor.is_on_break,
            "data_source": doctor_source[doctor.id],
            "consult_observations": doctor_observations[doctor.id],
        })

    # Machine analytics
    scan_by_machine: dict[int, list[ScanAppointment]] = defaultdict(list)
    for appt in scan_appts:
        scan_by_machine[appt.machine_id].append(appt)
    active_scan_by_machine: dict[int, list[ScanAppointment]] = defaultdict(list)
    for appt in active_scans:
        active_scan_by_machine[appt.machine_id].append(appt)
    scan_samples_by_machine: dict[int, list[ScanDurationSample]] = defaultdict(list)
    for sample in scan_samples:
        scan_samples_by_machine[sample.machine_id].append(sample)

    machine_rows: list[dict[str, Any]] = []
    total_machine_busy = 0.0
    total_machine_available = 0.0
    for machine in machines:
        machine_appts = scan_by_machine[machine.id]
        completed_scans = [
            a for a in scan_all
            if a.machine_id == machine.id
            and a.status == ScanStatus.completed
            and _timestamp_in_range(a.ended_at, since, now)
        ]
        intervals = [
            (max(_aware(a.started_at), since), min(_aware(a.ended_at), now))
            for a in completed_scans
            if _aware(a.started_at) and _aware(a.ended_at) and _aware(a.ended_at) >= _aware(a.started_at)
        ]
        durations = [
            value for value in (
                _duration_minutes(a.started_at, a.ended_at) for a in completed_scans
            ) if value is not None
        ]
        # Ignore sub-30s completions for averages (usually test/mis-clicks); keep them in busy time.
        valid_durations = [value for value in durations if value >= 0.5]
        baseline = [s.duration_sec / 60.0 for s in scan_samples_by_machine[machine.id]]
        avg_duration = _mean(valid_durations or baseline)
        busy_min = sum(
            value for value in (_duration_minutes(start, end) for start, end in intervals)
            if value is not None
        )
        available_min = max(1.0, _machine_available_minutes(since, now, hospital_tz))
        utilization = min(100.0, _pct(busy_min, available_min))
        total_machine_busy += busy_min
        total_machine_available += available_min

        hour_busy: Counter[int] = Counter()
        for start, end in intervals:
            if not start or not end:
                continue
            cursor = start
            while cursor < end:
                local_cursor = cursor.astimezone(hospital_tz)
                hour_end = (
                    local_cursor.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
                ).astimezone(timezone.utc)
                segment_end = min(end, hour_end)
                hour_busy[local_cursor.hour] += max(0.0, (segment_end - cursor).total_seconds() / 60.0)
                cursor = segment_end
        operating_days = [
            day for day in _days_in_range(since, now, hospital_tz)
            if _overlap_minutes(
                datetime.combine(day, time(9), tzinfo=hospital_tz).astimezone(timezone.utc),
                datetime.combine(day, time(21), tzinfo=hospital_tz).astimezone(timezone.utc),
                since,
                now,
            ) > 0
        ]
        day_count = max(1, len(operating_days))
        utilization_by_hour = [
            {"hour": hour, "utilization_pct": min(100.0, round(hour_busy[hour] / (60 * day_count) * 100.0, 1))}
            for hour in range(9, 21)
        ]

        sorted_intervals = sorted(intervals, key=lambda pair: pair[0])
        gaps = [
            max(0.0, (sorted_intervals[i][0] - sorted_intervals[i - 1][1]).total_seconds() / 60.0)
            for i in range(1, len(sorted_intervals))
            if sorted_intervals[i][0] and sorted_intervals[i - 1][1]
            and sorted_intervals[i][0].date() == sorted_intervals[i - 1][1].date()
            and sorted_intervals[i][0] > sorted_intervals[i - 1][1]
        ]
        morning = _mean([x["utilization_pct"] for x in utilization_by_hour if x["hour"] < 15])
        afternoon = _mean([x["utilization_pct"] for x in utilization_by_hour if x["hour"] >= 15])
        if len(valid_durations) < 5:
            suggestion = "Collect at least 5 completed live scans before redistributing slots."
        elif morning > 75 and afternoon < 45:
            suggestion = "Shift suitable bookings to afternoon to balance utilization."
        elif afternoon > 75 and morning < 45:
            suggestion = "Move suitable demand into morning capacity."
        elif len(active_scan_by_machine[machine.id]) >= 4:
            suggestion = "Open an additional block or redirect overflow to another machine."
        else:
            suggestion = "Current slot distribution is balanced."

        machine_rows.append({
            "id": machine.id,
            "external_id": machine.external_id,
            "name": machine.name,
            "scan_type": _enum_value(machine.scan_type),
            "is_live": machine.is_live,
            "completed_scans": len(completed_scans),
            "avg_scan_min": avg_duration,
            "utilization_pct": utilization,
            "utilization_by_hour": utilization_by_hour,
            "current_backlog": len(active_scan_by_machine[machine.id]),
            "historical_peak_backlog": _reconstructed_peak_backlog(machine_appts),
            "avg_idle_gap_min": _mean(gaps),
            "max_idle_gap_min": round(max(gaps), 1) if gaps else 0.0,
            "suggestion": suggestion,
            "data_source": (
                "live" if valid_durations
                else "learned baseline" if baseline
                else "no duration data"
            ),
        })

    # Flow heatmap
    departments = sorted({d.department for d in doctors})
    hours = list(range(8, 21))
    heat_counts: Counter[tuple[str, int]] = Counter()
    for appt in appts:
        when = _event_time(appt)
        if when and appt.doctor:
            heat_counts[(appt.doctor.department, when.astimezone(hospital_tz).hour)] += 1
    heatmap_cells = [
        {"department": dept, "hour": hour, "count": heat_counts[(dept, hour)]}
        for dept in departments for hour in hours
    ]
    max_heat = max((cell["count"] for cell in heatmap_cells), default=0)
    peak_cell = max(heatmap_cells, key=lambda x: x["count"], default=None)

    # Fairness
    delayed_active = [
        a for a in active_appts
        if a.id in predictions and _prediction_wait_minutes(predictions[a.id], now) >= delay_threshold_min
    ]
    normal_active = [a for a in active_appts if (a.priority or "normal") == "normal"]
    delayed_normal = [a for a in delayed_active if (a.priority or "normal") == "normal"]
    delayed_normal_rate = _pct(len(delayed_normal), len(normal_active))
    return_count = sum(1 for a in appts if a.appointment_type == AppointmentType.follow_up)

    # The first priority_set is initial triage, not an override. Later changes and
    # emergency inserts are true overrides. emergency_insert emits a paired
    # priority_set at the same timestamp, which is intentionally de-duplicated.
    priority_by_appt: dict[int, list[QueueEvent]] = defaultdict(list)
    for event in reversed(priority_events):
        priority_by_appt[event.appointment_id].append(event)
    override_events: list[QueueEvent] = []
    for appt_events in priority_by_appt.values():
        seen_initial_priority = False
        emergency_times = {
            _aware(event.timestamp)
            for event in appt_events
            if event.event_type == "emergency_insert"
        }
        for event in appt_events:
            event_at = _aware(event.timestamp)
            if event.event_type == "emergency_insert":
                override_events.append(event)
                continue
            if event_at in emergency_times:
                continue
            if seen_initial_priority:
                override_events.append(event)
            seen_initial_priority = True
    override_events.sort(key=lambda event: _aware(event.timestamp), reverse=True)

    override_log: list[dict[str, Any]] = []
    appt_lookup = {a.id: a for a in all_appts}
    for event in override_events[:25]:
        appt = appt_lookup.get(event.appointment_id)
        if not appt:
            continue
        override_log.append({
            "timestamp": event.timestamp,
            "event_type": event.event_type,
            "patient_name": appt.patient.name if appt.patient else "Patient",
            "doctor_name": appt.doctor.name if appt.doctor else "Doctor",
            "priority": appt.priority or "normal",
            "reason": event.note or appt.priority_reason or "No reason recorded",
        })
    fairness = {
        "delayed_threshold_min": delay_threshold_min,
        "patients_delayed": len(delayed_active),
        "normal_patients_delayed": len(delayed_normal),
        "normal_delayed_rate_pct": delayed_normal_rate,
        "priority_overrides": len(override_events),
        "emergency_inserts": sum(1 for e in override_events if e.event_type == "emergency_insert"),
        "returning_patients": return_count,
        "new_patients": max(0, len(appts) - return_count),
        "returning_patient_ratio_pct": _pct(return_count, len(appts)),
        "override_log": override_log,
    }

    # Scoreboard
    if not actual_waits and not predicted_waits:
        wait_status = "amber"
    elif avg_wait_min <= 20:
        wait_status = "green"
    elif avg_wait_min <= 35:
        wait_status = "amber"
    else:
        wait_status = "red"

    doctor_loads = [row["patients_seen"] for row in doctor_rows]
    if not any(doctor_loads):
        doctor_loads = [row["queue_now"] for row in doctor_rows]
    load_mean = statistics.mean(doctor_loads) if doctor_loads else 0.0
    load_cv = (statistics.pstdev(doctor_loads) / load_mean) if load_mean else 0.0
    if not any(doctor_loads):
        load_status = "amber"
    else:
        load_status = "green" if load_cv <= 0.25 else "amber" if load_cv <= 0.5 else "red"

    avg_machine_util = _pct(total_machine_busy, total_machine_available)
    if total_machine_busy <= 0:
        machine_status = "amber"
    elif 55 <= avg_machine_util <= 80:
        machine_status = "green"
    elif 40 <= avg_machine_util <= 90:
        machine_status = "amber"
    else:
        machine_status = "red"
    no_show_status = (
        "amber" if considered_outcomes == 0
        else "green" if no_show_rate <= 8
        else "amber" if no_show_rate <= 15
        else "red"
    )
    fairness_status = (
        "amber" if not normal_active
        else "green" if delayed_normal_rate <= 10
        else "amber" if delayed_normal_rate <= 25
        else "red"
    )

    scoreboard = [
        _score(
            "wait_sla", "Wait-time SLA", wait_status, f"{avg_wait_min:.1f} min avg",
            (
                f"Average arrival-to-start wait is {avg_wait_min:.1f} minutes across {len(actual_waits)} observations."
                if actual_waits else
                f"Current ETA-based wait is {avg_wait_min:.1f} minutes across {len(predicted_waits)} queued patients."
                if predicted_waits else
                "No measured or current ETA wait observations are available."
            ),
            "Keep average wait below 20 minutes; rebalance peak-hour coverage when it rises.",
        ),
        _score(
            "doctor_load", "Doctor load balance", load_status, f"{load_cv * 100:.0f}% variation",
            (
                f"Patient load variation across doctors is {load_cv * 100:.0f}%."
                if any(doctor_loads) else
                "No completed consultations or current queue load are available."
            ),
            "Shift walk-ins or slots toward lower-load doctors in the same department.",
        ),
        _score(
            "machine_utilization", "Machine utilization", machine_status, f"{avg_machine_util:.1f}%",
            (
                f"Measured live machine utilization is {avg_machine_util:.1f}%."
                if total_machine_busy > 0 else
                "No completed live scans in this range; baseline duration data is available but not counted as utilization."
            ),
            "Target 55–80% utilization and move bookings away from overloaded hours.",
        ),
        _score(
            "no_show", "No-show control", no_show_status, f"{no_show_rate:.1f}%",
            f"{len(no_shows)} of {considered_outcomes} completed/no-show outcomes were no-shows.",
            "Use earlier reminders for time blocks where no-shows exceed 12%.",
        ),
        _score(
            "triage_fairness", "Triage fairness", fairness_status, f"{delayed_normal_rate:.1f}% delayed",
            f"{len(delayed_normal)} of {len(normal_active)} normal active patients exceed {delay_threshold_min} minutes.",
            "Review repeated overrides and protect normal-patient capacity when delay exceeds 25%.",
        ),
    ]

    # Recommendations
    recommendations: list[dict[str, str]] = []
    if longest_bottleneck["queue"] >= 3 or longest_bottleneck["wait_min"] > delay_threshold_min:
        recommendations.append(_recommendation(
            "current-bottleneck", "critical" if longest_bottleneck["wait_min"] > 45 else "warning",
            "Patient flow",
            f"{longest_bottleneck['name']} is the current bottleneck",
            f"{longest_bottleneck['queue']} waiting; longest estimated wait {longest_bottleneck['wait_min']:.0f} min.",
            "Open extra capacity, redirect suitable patients, or publish a delay update.",
        ))

    if peak_cell and peak_cell["count"] >= 5:
        total_heat = sum(cell["count"] for cell in heatmap_cells if cell["department"] == peak_cell["department"])
        avg_hour = total_heat / max(1, len(hours))
        if total_heat >= 10 and peak_cell["count"] >= max(5, avg_hour * 1.5):
            hour_label = datetime.combine(date.today(), time(peak_cell["hour"])).strftime("%I %p").lstrip("0")
            recommendations.append(_recommendation(
                "department-peak", "opportunity", "Staffing",
                f"{peak_cell['department']} peaks around {hour_label}",
                f"{peak_cell['count']} registrations in the peak hour vs {avg_hour:.1f} per tracked hour.",
                "Add overlapping coverage or move flexible slots outside this hour.",
            ))

    for row in sorted(doctor_rows, key=lambda x: x["variance_vs_department_pct"], reverse=True):
        if (
            row["department_avg_min"]
            and row["variance_vs_department_pct"] >= 30
            and row["consult_observations"] >= 5
            and dept_live_observations[row["department"]] >= 10
        ):
            recommendations.append(_recommendation(
                f"doctor-duration-{row['id']}", "warning", "Doctor flow",
                f"{row['name']} may create ETA drift",
                f"{row['avg_consult_min']:.1f} min avg vs {row['department_avg_min']:.1f} min department avg (+{row['variance_vs_department_pct']:.0f}%).",
                "Adjust this doctor’s slot duration or reduce bookings per session; do not treat speed alone as quality.",
            ))
            break

    senior_count = sum(1 for a in appts if (a.priority or "normal") == "senior")
    senior_share = _pct(senior_count, len(appts))
    if len(appts) >= 10 and senior_count >= 5 and senior_share >= 25:
        recommendations.append(_recommendation(
            "senior-capacity", "opportunity", "Triage",
            "Protect capacity for senior patients",
            f"Senior priority represents {senior_share:.1f}% of registrations ({senior_count}/{len(appts)}).",
            "Reserve two morning positions for seniors, then review utilization after one week.",
        ))

    monday_am = [
        a for a in appts
        if _event_time(a)
        and _event_time(a).astimezone(hospital_tz).weekday() == 0
        and _event_time(a).astimezone(hospital_tz).hour < 12
        and a.status in {AppointmentStatus.completed, AppointmentStatus.no_show}
    ]
    monday_no_shows = sum(1 for a in monday_am if a.status == AppointmentStatus.no_show)
    monday_rate = _pct(monday_no_shows, len(monday_am))
    if len(monday_am) >= 10 and monday_rate > 12:
        recommendations.append(_recommendation(
            "monday-noshow", "warning", "Attendance",
            "Monday morning no-shows need attention",
            f"{monday_rate:.1f}% no-show rate ({monday_no_shows}/{len(monday_am)}) before noon on Mondays.",
            "Send Telegram reminders the previous evening and again two hours before the visit.",
        ))
    elif no_show_rate > 12 and considered_outcomes >= 20:
        recommendations.append(_recommendation(
            "overall-noshow", "warning", "Attendance",
            "No-show rate is above target",
            f"{no_show_rate:.1f}% no-show rate ({len(no_shows)}/{considered_outcomes}) in this range.",
            "Start reminders with the highest no-show time block and measure the next seven days.",
        ))

    for row in sorted(machine_rows, key=lambda x: x["current_backlog"], reverse=True):
        if row["current_backlog"] >= 4:
            recommendations.append(_recommendation(
                f"machine-backlog-{row['id']}", "warning", "Diagnostics",
                f"{row['name']} has scan backlog",
                f"{row['current_backlog']} currently waiting; reconstructed peak backlog {row['historical_peak_backlog']}.",
                row["suggestion"],
            ))
            break
    emergency_override_count = sum(
        1 for event in override_events if event.event_type == "emergency_insert"
    )
    if emergency_override_count >= 3 and delayed_normal_rate > 25:
        recommendations.append(_recommendation(
            "repeated-emergency-delay", "warning", "Triage fairness",
            "Repeated emergencies are delaying normal-priority patients",
            (
                f"{emergency_override_count} emergency inserts occurred while "
                f"{delayed_normal_rate:.1f}% of normal active patients exceed "
                f"the {delay_threshold_min}-minute threshold."
            ),
            "Review emergency capacity and protect a parallel normal-priority lane where clinically safe.",
        ))
    if not recommendations:
        recommendations.append(_recommendation(
            "stable-flow", "info", "Operations",
            "No major operational exception detected",
            f"Wait {avg_wait_min:.1f} min; no-show {no_show_rate:.1f}%; {len(active_appts)} patients currently active.",
            "Continue collecting live Start/End events so recommendations become more specific.",
        ))

    data_quality_warnings: list[str] = []
    demo_records = sum(
        1 for appt in all_appts
        if (appt.external_id or "").startswith(f"INS-{hospital.external_id}-")
    )
    if demo_records:
        data_quality_warnings.append(
            f"Demo dataset active ({demo_records} OPD records); replace with production events before operational use."
        )
    if len(actual_waits) < 5:
        data_quality_warnings.append(
            "Fewer than 5 arrival-to-start wait observations; wait status has limited confidence."
        )
    scheduled_wait_count = sum(1 for _, _, source in wait_observations if source == "scheduled")
    if scheduled_wait_count:
        data_quality_warnings.append(
            f"{scheduled_wait_count} wait observation(s) use scheduled time because no check-in event was recorded."
        )
    live_doctor_samples = sum(doctor_observations.values())
    baseline_doctor_samples = sum(1 for s in duration_samples if s.source != "live")
    if live_doctor_samples < 5:
        if baseline_doctor_samples:
            data_quality_warnings.append(
                "Doctor averages mostly use learned baselines until more consultations are completed."
            )
        else:
            data_quality_warnings.append(
                "No doctor duration samples yet; run training or complete live consultations for consult metrics."
            )
    if total_machine_busy <= 0:
        data_quality_warnings.append("Machine utilization needs completed live scans with Start and End timestamps.")
    data_quality_warnings.append(
        "Machine capacity assumes a 9 AM–9 PM operating day in the hospital timezone."
    )
    if not ops_events:
        data_quality_warnings.append("Break/delay frequency starts accumulating after this Insights release.")

    return {
        "hospital_id": hospital.id,
        "hospital_name": hospital.name,
        "generated_at": now,
        "range_days": days,
        "delay_threshold_min": delay_threshold_min,
        "pulse": {
            "avg_wait_min": avg_wait_min,
            "patients_seen": len(completed) + len(completed_scans_range),
            "patients_waiting": len(active_appts) + len(active_scans),
            "no_show_rate_pct": no_show_rate,
            "no_show_count": len(no_shows),
            "priority_share_pct": priority_share,
            "priority_count": priority_count,
            "longest_bottleneck": longest_bottleneck,
            "wait_source": "arrival-to-start" if actual_waits else "current ETA" if predicted_waits else "unavailable",
            "wait_observations": len(actual_waits) if actual_waits else len(predicted_waits),
        },
        "recommendations": recommendations[:8],
        "doctors": doctor_rows,
        "machines": machine_rows,
        "heatmap": {
            "departments": departments,
            "hours": hours,
            "cells": heatmap_cells,
            "max_count": max_heat,
        },
        "fairness": fairness,
        "scoreboard": scoreboard,
        "data_quality": {
            "actual_wait_observations": len(actual_waits),
            "live_doctor_samples": live_doctor_samples,
            "completed_live_scans": sum(row["completed_scans"] for row in machine_rows),
            "warnings": data_quality_warnings,
        },
    }
