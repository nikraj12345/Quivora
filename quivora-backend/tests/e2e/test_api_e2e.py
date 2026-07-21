"""API e2e tests against a live Quivora stack."""
from __future__ import annotations

import os
import time

import httpx
import pytest

BASE = os.getenv("QUIVORA_API_BASE", "http://127.0.0.1:8100")
API_KEY = os.getenv("QUIVORA_API_KEY", "quivora-dev-key")
HEADERS = {"X-API-Key": API_KEY}


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE, timeout=60.0) as c:
        # wait for health
        for _ in range(30):
            try:
                r = c.get("/health")
                if r.status_code == 200 and r.json().get("postgres"):
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            pytest.fail("API not healthy")
        yield c


def test_health(client: httpx.Client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["postgres"] is True
    assert body["redis"] is True


def test_seed_doctors_and_patients(client: httpx.Client):
    r = client.post("/v1/admin/seed?reset=true", headers=HEADERS)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["doctors"] == 40
    assert body["patients"] >= 200

    # 5 hospitals
    hospitals = client.get("/v1/hospitals").json()
    assert len(hospitals) == 5
    assert all(h["name"] and h["city"] for h in hospitals)

    # 40 doctors total, 8 per hospital
    docs = client.get("/v1/doctors").json()
    assert len(docs) == 40
    assert all(d["name"] for d in docs)

    # hospital-scoped doctor filter
    first_hospital_id = hospitals[0]["id"]
    scoped = client.get(f"/v1/doctors?hospital_id={first_hospital_id}").json()
    assert len(scoped) == 8

    # patient search
    search = client.get(f"/v1/patients/search?q=a&hospital_id={first_hospital_id}").json()
    assert isinstance(search, list)


def test_opd_summary_can_be_scoped_to_hospital(client: httpx.Client):
    hospitals = client.get("/v1/hospitals").json()
    hospital_id = hospitals[0]["id"]
    doctors = client.get(f"/v1/doctors?hospital_id={hospital_id}").json()

    scoped = client.get(f"/v1/opd/summary?hospital_id={hospital_id}")
    assert scoped.status_code == 200
    body = scoped.json()
    assert body["total_doctors"] == len(doctors)
    assert body["live_doctors"] <= body["total_doctors"]

    global_summary = client.get("/v1/opd/summary").json()
    assert global_summary["total_doctors"] >= body["total_doctors"]


def test_bootstrap_training_100_per_doctor(client: httpx.Client):
    client.post("/v1/admin/seed?reset=true", headers=HEADERS)

    r = client.post("/v1/train/bootstrap?fast=true", headers=HEADERS)
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    # wait for completion (fast mode)
    status = None
    for _ in range(180):
        s = client.get(f"/v1/train/status/{job_id}")
        assert s.status_code == 200
        status = s.json()
        if status["status"] in ("completed", "failed"):
            break
        time.sleep(0.5)

    assert status is not None
    assert status["status"] == "completed", status
    assert status["samples_done"] == 4000   # 100 per doctor × 40 doctors
    assert status["progress_pct"] == 100.0

    stats = client.get("/v1/train/stats").json()
    assert stats["total_samples"] >= 4000   # 100 × 40 doctors
    for d in stats["doctors"]:
        assert d["sample_count"] >= 100, d


def test_appointment_flow_and_eta(client: httpx.Client):
    docs = client.get("/v1/doctors").json()
    doctor = docs[0]

    # doctor must be live for ETAs to compute
    r = client.post(f"/v1/doctors/{doctor['id']}/go-live", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["is_live"] is True

    # create a small queue
    created = []
    for i, age in enumerate([4, 35, 70]):
        r = client.post(
            "/v1/appointments",
            headers=HEADERS,
            json={
                "doctor_external_id": doctor["external_id"],
                "patient_name": f"E2E Patient {i}",
                "age": age,
                "appointment_type": "new",
            },
        )
        assert r.status_code == 200, r.text
        created.append(r.json())

    first = created[0]
    second = created[1]

    r = client.post(
        "/v1/events",
        headers=HEADERS,
        json={"appointment_id": first["id"], "event_type": "started"},
    )
    assert r.status_code == 200

    eta_before = client.get(f"/v1/appointments/{second['id']}/eta").json()
    assert eta_before["patients_ahead"] >= 1
    assert eta_before["wait_seconds"] > 0
    assert eta_before["eta_at"] is not None

    # end with a long consult to shift queue
    time.sleep(1)
    r = client.post(
        "/v1/events",
        headers=HEADERS,
        json={"appointment_id": first["id"], "event_type": "ended"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "completed"

    eta_after = client.get(f"/v1/appointments/{second['id']}/eta").json()
    assert eta_after["patients_ahead"] >= 0

    queue = client.get(f"/v1/doctors/{doctor['id']}/queue").json()
    assert isinstance(queue, list)
    assert all("predicted_duration_sec" in q for q in queue)


def test_scan_queue_flow(client: httpx.Client):
    # ensure seed (scan machines created during seed)
    client.post("/v1/admin/seed?reset=true", headers=HEADERS)

    # list machines
    r = client.get("/v1/scans/machines")
    assert r.status_code == 200, r.text
    machines = r.json()
    assert len(machines) == 25   # 5 machines × 5 hospitals
    scan_types = {m["scan_type"] for m in machines}
    assert "mri" in scan_types
    assert "xray" in scan_types

    machine = machines[0]
    ext = machine["external_id"]

    # go live
    r = client.post(f"/v1/scans/machines/{ext}/go-live", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["is_live"] is True

    # create 2 scan appointments
    appts = []
    for age in [25, 60]:
        r = client.post(
            "/v1/scans/appointments",
            headers=HEADERS,
            json={"machine_external_id": ext, "patient_name": "Scan Patient", "age": age},
        )
        assert r.status_code == 200, r.text
        appts.append(r.json())

    # check queue
    q = client.get(f"/v1/scans/machines/{ext}/queue").json()
    assert len(q) == 2
    assert all("predicted_duration_sec" in item for item in q)
    assert all(item["eta_at"] is not None for item in q)

    # start → end first scan
    first = appts[0]
    r = client.post("/v1/scans/events", headers=HEADERS,
                    json={"appointment_id": first["id"], "event_type": "scan_started"})
    assert r.status_code == 200

    time.sleep(1)
    r = client.post("/v1/scans/events", headers=HEADERS,
                    json={"appointment_id": first["id"], "event_type": "scan_ended"})
    assert r.status_code == 200
    assert r.json()["status"] == "completed"

    # ETA for second patient should update
    eta = client.get(f"/v1/scans/appointments/{appts[1]['id']}/eta").json()
    assert eta["patients_ahead"] >= 0
    assert eta["predicted_duration_sec"] > 0

    # check bootstrap samples were seeded
    m_detail = client.get(f"/v1/scans/machines/{ext}").json()
    assert m_detail["sample_count"] >= 100


def test_hospital_insights_endpoint(client: httpx.Client):
    hospitals = client.get("/v1/hospitals").json()
    assert hospitals, "expected seeded hospitals"
    hospital = hospitals[0]
    hid = hospital["id"]

    forbidden = client.get(f"/v1/hospitals/{hid}/insights")
    assert forbidden.status_code in (401, 403)

    bad_days = client.get(
        f"/v1/hospitals/{hid}/insights?days=14",
        headers=HEADERS,
    )
    assert bad_days.status_code == 400

    r = client.get(
        f"/v1/hospitals/{hid}/insights?days=7&delay_threshold_min=30",
        headers=HEADERS,
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["hospital_id"] == hid
    assert body["hospital_name"]
    assert body["range_days"] == 7
    assert body["delay_threshold_min"] == 30

    pulse = body["pulse"]
    for key in (
        "avg_wait_min",
        "patients_seen",
        "patients_waiting",
        "no_show_rate_pct",
        "priority_share_pct",
        "longest_bottleneck",
        "wait_source",
        "wait_observations",
    ):
        assert key in pulse
    assert pulse["wait_source"] in {"arrival-to-start", "current ETA", "unavailable"}
    assert {"type", "name", "department", "queue", "wait_min"} <= set(pulse["longest_bottleneck"])

    assert isinstance(body["recommendations"], list)
    assert body["recommendations"], "expected at least one recommendation"
    for rec in body["recommendations"]:
        assert {"id", "severity", "category", "title", "evidence", "action"} <= set(rec)
        assert rec["evidence"]
        assert rec["action"]
        assert rec["severity"] in {"critical", "warning", "opportunity", "info"}

    assert isinstance(body["doctors"], list)
    if body["doctors"]:
        doctor = body["doctors"][0]
        assert {
            "patients_seen",
            "avg_consult_min",
            "department_avg_min",
            "downstream_wait_min",
            "break_events",
            "delay_events",
            "priority_mix",
            "utilization_pct",
        } <= set(doctor)

    assert isinstance(body["machines"], list)
    if body["machines"]:
        machine = body["machines"][0]
        assert {
            "utilization_pct",
            "avg_scan_min",
            "utilization_by_hour",
            "current_backlog",
            "suggestion",
        } <= set(machine)
        assert len(machine["utilization_by_hour"]) == 12

    heatmap = body["heatmap"]
    assert "departments" in heatmap and "hours" in heatmap and "cells" in heatmap

    fairness = body["fairness"]
    for key in (
        "patients_delayed",
        "normal_patients_delayed",
        "priority_overrides",
        "returning_patient_ratio_pct",
        "override_log",
    ):
        assert key in fairness

    scoreboard = body["scoreboard"]
    assert len(scoreboard) == 5
    keys = {row["key"] for row in scoreboard}
    assert keys == {
        "wait_sla",
        "doctor_load",
        "machine_utilization",
        "no_show",
        "triage_fairness",
    }
    for row in scoreboard:
        assert row["status"] in {"green", "amber", "red"}
        assert row["explanation"]
        assert row["action"]

    quality = body["data_quality"]
    assert "actual_wait_observations" in quality
    assert "warnings" in quality

    # also accept hospital external_id as hospital_ref
    ext = hospital.get("external_id")
    if ext:
        by_ext = client.get(
            f"/v1/hospitals/{ext}/insights?days=1",
            headers=HEADERS,
        )
        assert by_ext.status_code == 200
        assert by_ext.json()["range_days"] == 1


def test_date_wise_availability_and_booking(client: httpx.Client):
    from datetime import date, timedelta

    hospitals = client.get("/v1/hospitals", headers=HEADERS).json()
    hospital = hospitals[0]
    doctors = client.get(f"/v1/doctors?hospital_id={hospital['id']}", headers=HEADERS).json()
    doctor = doctors[0]

    future = date.today() + timedelta(days=3)
    while future.weekday() == 6:
        future += timedelta(days=1)
    future_iso = future.isoformat()

    availability = client.get(
        f"/v1/doctors/{doctor['external_id']}/availability?date={future_iso}",
        headers=HEADERS,
    )
    assert availability.status_code == 200, availability.text
    body = availability.json()
    assert body["date"] == future_iso
    assert body["works_that_day"] is True
    assert len(body["slots"]) >= 1
    slot = body["slots"][0]["slot"]

    booked = client.post(
        "/v1/appointments",
        headers=HEADERS,
        json={
            "doctor_external_id": doctor["external_id"],
            "patient_name": "Future Booking",
            "age": 42,
            "appointment_type": "new",
            "slot": slot,
            "appointment_date": future_iso,
        },
    )
    assert booked.status_code == 200, booked.text
    appt = booked.json()
    assert appt["scheduled_at"] is not None
    assert appt["token"] == 1

    availability_after = client.get(
        f"/v1/doctors/{doctor['external_id']}/availability?date={future_iso}",
        headers=HEADERS,
    ).json()
    slot_after = next(s for s in availability_after["slots"] if s["slot"] == slot)
    assert slot_after["booked_count"] >= 1

    hospital_availability = client.get(
        f"/v1/hospitals/{hospital['id']}/availability?date={future_iso}",
        headers=HEADERS,
    )
    assert hospital_availability.status_code == 200
    assert any(d["doctor_external_id"] == doctor["external_id"] for d in hospital_availability.json()["doctors"])

