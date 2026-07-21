from __future__ import annotations

import json

from app.services.seed import (
    CONSULTS_PER_DOCTOR,
    PATIENT_POOL_SIZE,
    PATIENTS_PER_HOSPITAL,
    generate_seed_files,
)


def test_generate_seed_files_writes_1000_patients_and_40_doctors(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.seed.SEED_DIR", tmp_path)
    meta = generate_seed_files(force=True)

    patients = json.loads(meta["patients"].read_text())
    doctors = json.loads(meta["doctors"].read_text())
    training = json.loads(meta["training"].read_text())

    assert len(patients) == PATIENT_POOL_SIZE
    assert len(doctors) == 40
    assert meta["patient_count"] == PATIENT_POOL_SIZE
    assert meta["doctor_count"] == 40
    assert training["consults_per_doctor"] == CONSULTS_PER_DOCTOR
    assert training["patient_pool_size"] == PATIENT_POOL_SIZE
    assert len(training["doctors"]) == 40
    assert sum(len(d["consultations"]) for d in training["doctors"]) == 40 * CONSULTS_PER_DOCTOR

    # Each hospital slice in DB seed uses 200 unique patients from the pool.
    assert PATIENTS_PER_HOSPITAL * 5 == PATIENT_POOL_SIZE

    phones = {p["phone"] for p in patients}
    assert len(phones) == PATIENT_POOL_SIZE
    assert all(p["phone"].startswith("+91 ") for p in patients)
