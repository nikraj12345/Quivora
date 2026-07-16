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
