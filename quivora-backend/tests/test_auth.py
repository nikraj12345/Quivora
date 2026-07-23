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

    login = client.post("/v1/auth/login", json={
        "email": "admin@quivora.local",
        "password": "Quivora@123",
    }).json()
    token = login["access_token"]
    ok = client.get(
        f"/v1/patients/search?q=a&hospital_id={hid}",
        headers={"Authorization": f"Bearer {token}"},
    )
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
