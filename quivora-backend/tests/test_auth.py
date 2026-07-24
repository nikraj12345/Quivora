"""Authentication API tests."""
from __future__ import annotations

import os

import httpx
import pytest

BASE = os.getenv("QUIVORA_API_BASE", "http://127.0.0.1:8100")
API_KEY = os.getenv("QUIVORA_API_KEY", "quivora-dev-key")
HEADERS = {"X-API-Key": API_KEY}


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE, timeout=60.0) as c:
        for _ in range(30):
            try:
                if c.get("/health").status_code == 200:
                    break
            except Exception:
                pass
        c.post("/v1/admin/seed?reset=true", headers=HEADERS)
        yield c


def test_login_platform_admin(client: httpx.Client):
    r = client.post("/v1/auth/login", json={
        "email": "admin@quivora.local",
        "password": "Quivora@123",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["user"]["role"] == "platform_admin"


def test_patient_search_requires_auth(client: httpx.Client):
    hospitals = client.get("/v1/hospitals").json()
    hid = hospitals[0]["id"]
    denied = client.get(f"/v1/patients/search?q=a&hospital_id={hid}")
    assert denied.status_code == 401

    headers = _bearer(client, "admin-hosp001@quivora.local", "Hospital@123")
    ok = client.get(f"/v1/patients/search?q=a&hospital_id={hid}", headers=headers)
    assert ok.status_code == 200


def test_service_api_key_still_works(client: httpx.Client):
    hospitals = client.get("/v1/hospitals").json()
    hid = hospitals[0]["id"]
    r = client.get(f"/v1/patients/search?q=a&hospital_id={hid}", headers=HEADERS)
    assert r.status_code == 200


def _bearer(client: httpx.Client, email: str, password: str) -> dict[str, str]:
    login = client.post("/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_platform_admin_hospital_crud_only(client: httpx.Client):
    headers = _bearer(client, "admin@quivora.local", "Quivora@123")
    hospitals = client.get("/v1/hospitals", headers=headers)
    assert hospitals.status_code == 200
    assert len(hospitals.json()) >= 1
    hid = hospitals.json()[0]["id"]

    # Can update hospital record
    patched = client.patch(
        f"/v1/hospitals/{hid}",
        headers=headers,
        json={"city": hospitals.json()[0]["city"]},
    )
    assert patched.status_code == 200, patched.text

    # Cannot access hospital ops / PII
    denied_patients = client.get(f"/v1/patients?hospital_id={hid}", headers=headers)
    assert denied_patients.status_code == 403

    denied_doctors = client.get(f"/v1/doctors?hospital_id={hid}", headers=headers)
    assert denied_doctors.status_code == 403

    denied_seed = client.post("/v1/admin/seed?reset=false", headers=headers)
    assert denied_seed.status_code == 403

    denied_insights = client.get(f"/v1/hospitals/{hid}/insights", headers=headers)
    assert denied_insights.status_code == 403


def test_hospital_admin_tenant_isolation(client: httpx.Client):
    all_hospitals = client.get("/v1/hospitals").json()
    assert len(all_hospitals) >= 2, "seed should include multiple hospitals"

    headers = _bearer(client, "admin-hosp001@quivora.local", "Hospital@123")
    scoped = client.get("/v1/hospitals", headers=headers).json()
    assert len(scoped) == 1
    own_id = scoped[0]["id"]

    other = next(h for h in all_hospitals if h["id"] != own_id)
    denied_hospital = client.get(f"/v1/hospitals/{other['id']}", headers=headers)
    assert denied_hospital.status_code == 403

    denied_patients = client.get(f"/v1/patients?hospital_id={other['id']}", headers=headers)
    assert denied_patients.status_code == 403

    denied_summary = client.get(f"/v1/opd/summary?hospital_id={other['id']}", headers=headers)
    assert denied_summary.status_code == 403

    # Patient identity is hospital-scoped — no cross-tenant phone lookup or schedule peek
    other_patients = client.get(f"/v1/patients?hospital_id={other['id']}", headers=HEADERS).json()
    if other_patients and other_patients[0].get("phone"):
        denied_by_phone = client.get(
            f"/v1/hospitals/{other['id']}/patients/by-phone",
            params={"phone": other_patients[0]["phone"]},
            headers=headers,
        )
        assert denied_by_phone.status_code == 403

    other_doctors = client.get(f"/v1/doctors?hospital_id={other['id']}", headers=HEADERS).json()
    assert other_doctors
    denied_schedule = client.get(
        f"/v1/doctors/{other_doctors[0]['id']}/schedule",
        headers=headers,
    )
    assert denied_schedule.status_code == 403

    # Anonymous cannot pull full patient identity
    anon_by_phone = client.get(
        f"/v1/hospitals/{own_id}/patients/by-phone",
        params={"phone": "9999999999"},
    )
    assert anon_by_phone.status_code == 401

    own_patients = client.get(f"/v1/patients?hospital_id={own_id}", headers=headers)
    assert own_patients.status_code == 200

    own_doctors = client.get(f"/v1/doctors?hospital_id={own_id}", headers=headers).json()
    assert own_doctors
    other_doctor = client.get(
        f"/v1/doctors?hospital_id={other['id']}",
        headers=headers,
    )
    assert other_doctor.status_code == 403

    queue = client.get(f"/v1/doctors/{own_doctors[0]['id']}/queue", headers=headers)
    assert queue.status_code == 200

    # Cross-tenant appointment create must fail before write
    other_docs = client.get(f"/v1/doctors?hospital_id={other['id']}", headers=HEADERS).json()
    denied_create = client.post(
        "/v1/appointments",
        headers=headers,
        json={
            "doctor_external_id": other_docs[0]["external_id"],
            "patient_name": "Cross Tenant",
            "age": 30,
            "patient_phone": "9888777666",
            "slot": other_docs[0]["slots"][0] if other_docs[0].get("slots") else "morning",
        },
    )
    assert denied_create.status_code == 403

    # Self-checkin cannot book a doctor from another hospital
    denied_checkin = client.post(
        f"/v1/hospitals/{own_id}/self-checkin",
        json={
            "phone": "9777666555",
            "doctor_external_id": other_docs[0]["external_id"],
            "name": "Bad Cross",
            "age": 25,
            "slot": other_docs[0]["slots"][0] if other_docs[0].get("slots") else "morning",
        },
    )
    assert denied_checkin.status_code == 400
    assert "belong" in denied_checkin.text.lower() or "hospital" in denied_checkin.text.lower()
