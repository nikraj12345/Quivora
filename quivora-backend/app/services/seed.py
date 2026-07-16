from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Dict, List

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Appointment,
    Department,
    Doctor,
    DurationSample,
    Hospital,
    Patient,
    Prediction,
    QueueEvent,
    ScanAppointment,
    ScanDurationSample,
    ScanMachine,
    ScanPrediction,
    ScanType,
    TrainJob,
)
from app.services.age_bands import age_to_band

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"

HOSPITALS = [
    {"external_id": "HOSP-001", "name": "Quivora General Hospital",    "city": "Mumbai"},
    {"external_id": "HOSP-002", "name": "Quivora Medical Center",      "city": "Delhi"},
    {"external_id": "HOSP-003", "name": "Quivora Specialty Clinic",    "city": "Bangalore"},
    {"external_id": "HOSP-004", "name": "Quivora Heart Institute",     "city": "Chennai"},
    {"external_id": "HOSP-005", "name": "Quivora Children's Hospital", "city": "Hyderabad"},
]

# 8 doctors per hospital — different specialty mixes per hospital
HOSPITAL_DOCTORS = {
    "HOSP-001": [
        {"external_id": "DOC-001", "name": "Dr. Ananya Sharma",  "department": "General Medicine",  "pace": 1.0},
        {"external_id": "DOC-002", "name": "Dr. Rohan Mehta",    "department": "Pediatrics",         "pace": 0.75},
        {"external_id": "DOC-003", "name": "Dr. Priya Nair",     "department": "Cardiology",         "pace": 1.35},
        {"external_id": "DOC-004", "name": "Dr. Vikram Singh",   "department": "Orthopedics",        "pace": 1.15},
        {"external_id": "DOC-005", "name": "Dr. Sneha Kapoor",   "department": "Dermatology",        "pace": 0.85},
        {"external_id": "DOC-006", "name": "Dr. Arjun Reddy",    "department": "ENT",                "pace": 0.9},
        {"external_id": "DOC-007", "name": "Dr. Meera Iyer",     "department": "Gynecology",         "pace": 1.1},
        {"external_id": "DOC-008", "name": "Dr. Kabir Khan",     "department": "Neurology",          "pace": 1.4},
    ],
    "HOSP-002": [
        {"external_id": "DOC-009", "name": "Dr. Ishita Bose",    "department": "Pulmonology",        "pace": 1.05},
        {"external_id": "DOC-010", "name": "Dr. Dev Patel",      "department": "General Surgery",    "pace": 1.2},
        {"external_id": "DOC-011", "name": "Dr. Ritu Sharma",    "department": "Oncology",           "pace": 1.5},
        {"external_id": "DOC-012", "name": "Dr. Sanjay Gupta",   "department": "Nephrology",         "pace": 1.3},
        {"external_id": "DOC-013", "name": "Dr. Deepa Rao",      "department": "Endocrinology",      "pace": 1.1},
        {"external_id": "DOC-014", "name": "Dr. Anil Verma",     "department": "Psychiatry",         "pace": 1.6},
        {"external_id": "DOC-015", "name": "Dr. Kavya Menon",    "department": "Ophthalmology",      "pace": 0.8},
        {"external_id": "DOC-016", "name": "Dr. Rahul Joshi",    "department": "General Medicine",   "pace": 0.95},
    ],
    "HOSP-003": [
        {"external_id": "DOC-017", "name": "Dr. Pooja Pillai",   "department": "Dermatology",        "pace": 0.9},
        {"external_id": "DOC-018", "name": "Dr. Neel Desai",     "department": "Orthopedics",        "pace": 1.2},
        {"external_id": "DOC-019", "name": "Dr. Simran Kaur",    "department": "Gynecology",         "pace": 1.0},
        {"external_id": "DOC-020", "name": "Dr. Aryan Das",      "department": "Cardiology",         "pace": 1.4},
        {"external_id": "DOC-021", "name": "Dr. Tanya Malhotra", "department": "Pediatrics",         "pace": 0.7},
        {"external_id": "DOC-022", "name": "Dr. Vivek Chopra",   "department": "ENT",                "pace": 0.85},
        {"external_id": "DOC-023", "name": "Dr. Leena Banerjee", "department": "Neurology",          "pace": 1.35},
        {"external_id": "DOC-024", "name": "Dr. Manish Yadav",   "department": "General Surgery",    "pace": 1.1},
    ],
    "HOSP-004": [
        {"external_id": "DOC-025", "name": "Dr. Suresh Krishnan","department": "Cardiology",         "pace": 1.3},
        {"external_id": "DOC-026", "name": "Dr. Nalini Subramanian","department": "Cardiothoracic",  "pace": 1.7},
        {"external_id": "DOC-027", "name": "Dr. Ramesh Iyer",    "department": "Interventional Cardiology","pace": 1.45},
        {"external_id": "DOC-028", "name": "Dr. Usha Venkat",    "department": "Cardiac Rehab",      "pace": 1.0},
        {"external_id": "DOC-029", "name": "Dr. Karthik Rajan",  "department": "General Medicine",   "pace": 0.9},
        {"external_id": "DOC-030", "name": "Dr. Preethi Srinivas","department": "Endocrinology",     "pace": 1.15},
        {"external_id": "DOC-031", "name": "Dr. Balaji Murugan",  "department": "Nephrology",        "pace": 1.2},
        {"external_id": "DOC-032", "name": "Dr. Chitra Nair",     "department": "Nutrition",         "pace": 0.7},
    ],
    "HOSP-005": [
        {"external_id": "DOC-033", "name": "Dr. Priya Reddy",    "department": "Pediatrics",         "pace": 0.7},
        {"external_id": "DOC-034", "name": "Dr. Sunil Kumar",    "department": "Neonatology",        "pace": 1.3},
        {"external_id": "DOC-035", "name": "Dr. Anita Sharma",   "department": "Pediatric Surgery",  "pace": 1.4},
        {"external_id": "DOC-036", "name": "Dr. Raj Malhotra",   "department": "Pediatric Cardiology","pace": 1.5},
        {"external_id": "DOC-037", "name": "Dr. Neha Jain",      "department": "Child Psychiatry",   "pace": 1.2},
        {"external_id": "DOC-038", "name": "Dr. Sachin Rao",     "department": "Pediatric Neurology","pace": 1.35},
        {"external_id": "DOC-039", "name": "Dr. Deepika Pillai", "department": "Pediatric Orthopedics","pace": 1.0},
        {"external_id": "DOC-040", "name": "Dr. Amit Kapoor",    "department": "General Pediatrics", "pace": 0.8},
    ],
}

SCAN_MACHINES_PER_HOSPITAL = [
    {"external_id_suffix": "MRI-1",  "name": "MRI Suite 1",    "scan_type": "mri",        "base_sec": 32 * 60},
    {"external_id_suffix": "CT-1",   "name": "CT Scanner A",   "scan_type": "ct",         "base_sec": 12 * 60},
    {"external_id_suffix": "XRAY-1", "name": "X-Ray Room 1",   "scan_type": "xray",       "base_sec":  5 * 60},
    {"external_id_suffix": "XRAY-2", "name": "X-Ray Room 2",   "scan_type": "xray",       "base_sec":  5 * 60},
    {"external_id_suffix": "USG-1",  "name": "Ultrasound Lab", "scan_type": "ultrasound", "base_sec": 18 * 60},
]

ALL_SLOTS = ["morning", "afternoon", "evening"]


def _random_slots(rng: random.Random) -> str:
    """Each doctor gets 1 or 2 random session slots."""
    n = rng.choice([1, 1, 2, 2, 3])  # bias toward 1–2 slots
    chosen = sorted(rng.sample(ALL_SLOTS, n), key=lambda s: ALL_SLOTS.index(s))
    return ",".join(chosen)

FIRST_NAMES = [
    "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
    "Ananya", "Aadhya", "Diya", "Myra", "Sara", "Anika", "Pari", "Aarohi", "Navya", "Kiara",
    "Kabir", "Rohan", "Neel", "Yash", "Harsh", "Om", "Laksh", "Atharv", "Dhruv", "Rudra",
    "Isha", "Nisha", "Pooja", "Riya", "Sana", "Tanya", "Urvi", "Veda", "Zara", "Mira",
    "Amit", "Raj", "Suresh", "Vikram", "Sunil", "Ramesh", "Kiran", "Deepak", "Manoj", "Nikhil",
    "Priya", "Sneha", "Kavya", "Divya", "Shreya", "Anjali", "Neha", "Swati", "Rashmi", "Sunita",
    "Rahul", "Rohit", "Aman", "Nitin", "Saurabh", "Gaurav", "Vishal", "Akash", "Ashish", "Sandeep",
]

LAST_NAMES = [
    "Sharma", "Patel", "Singh", "Reddy", "Nair", "Iyer", "Kapoor", "Mehta", "Khan", "Bose",
    "Gupta", "Joshi", "Malhotra", "Chopra", "Desai", "Banerjee", "Rao", "Pillai", "Verma", "Das",
    "Mishra", "Tiwari", "Pandey", "Shukla", "Saxena", "Agarwal", "Srivastava", "Chauhan", "Yadav", "Patil",
]

PHONE_PREFIXES = ["98", "87", "76", "99", "90", "91", "88", "77"]


def _synthetic_duration(age: int, pace: float, rng: random.Random) -> int:
    band = age_to_band(age)
    base = {
        "child_0_5": 4 * 60, "child_6_12": 5 * 60, "teen_13_17": 7 * 60,
        "adult_18_40": 9 * 60, "adult_41_60": 11 * 60, "senior_60_plus": 13 * 60,
    }[band]
    jitter = rng.randint(-90, 180)
    return max(90, int(base * pace) + jitter)


def _random_phone(rng: random.Random) -> str:
    prefix = rng.choice(PHONE_PREFIXES)
    return f"+91 {prefix}{rng.randint(10000000, 99999999)}"


def generate_seed_files(force: bool = False) -> Dict[str, Any]:
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    training_path = SEED_DIR / "training_consults.json"

    if force or not training_path.exists():
        rng = random.Random(42)
        patients_pool = []
        for i in range(1, 1001):
            age = rng.choice(
                list(range(1, 6)) * 3 + list(range(6, 13)) * 2 + list(range(13, 18))
                + list(range(18, 41)) * 3 + list(range(41, 61)) * 2 + list(range(61, 86))
            )
            patients_pool.append({
                "external_id": f"PAT-{i:04d}",
                "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
                "age": age,
                "age_band": age_to_band(age),
            })

        all_doctors = [d for docs in HOSPITAL_DOCTORS.values() for d in docs]
        doctors_block = []
        p_idx = 0
        for doc in all_doctors:
            consults = []
            for seq in range(1, 101):
                p = patients_pool[p_idx % len(patients_pool)]
                p_idx += 1
                duration = _synthetic_duration(p["age"], doc["pace"], rng)
                consults.append({
                    "seq": seq,
                    "patient_external_id": p["external_id"],
                    "patient_name": p["name"],
                    "age": p["age"],
                    "age_band": p["age_band"],
                    "appointment_type": "follow_up" if seq % 3 == 0 else "new",
                    "duration_sec": duration,
                    "hour_of_day": 9 + ((seq - 1) % 8),
                    "day_of_week": 1 + ((seq - 1) % 5),
                })
            doctors_block.append({
                "doctor_external_id": doc["external_id"],
                "doctor_name": doc["name"],
                "department": doc["department"],
                "consultations": consults,
            })
        training_path.write_text(json.dumps({
            "version": 1,
            "hospital": "multi",
            "consults_per_doctor": 100,
            "doctors": doctors_block,
        }, indent=2))

    return {"training": training_path}


def clear_bootstrap_samples(db: Session) -> None:
    """Clear learned timing samples + train jobs only — never touches live queues."""
    db.execute(delete(DurationSample).where(DurationSample.source == "bootstrap"))
    db.execute(delete(TrainJob))
    db.commit()


def seed_database(db: Session, reset: bool = True) -> Dict[str, Any]:
    generate_seed_files(force=False)

    if reset:
        # Full wipe — used only by explicit "Re-seed data" admin action
        db.execute(delete(ScanPrediction))
        db.execute(delete(ScanDurationSample))
        db.execute(delete(ScanAppointment))
        db.execute(delete(ScanMachine))
        db.execute(delete(Prediction))
        db.execute(delete(QueueEvent))
        db.execute(delete(DurationSample))
        db.execute(delete(Appointment))
        db.execute(delete(TrainJob))
        db.execute(delete(Patient))
        db.execute(delete(Doctor))
        db.execute(delete(Department))
        db.execute(delete(Hospital))
        db.commit()

    rng = random.Random(42)
    rng_scan = random.Random(99)
    total_doctors = 0
    total_patients = 0

    for hosp_data in HOSPITALS:
        hospital = db.execute(
            select(Hospital).where(Hospital.external_id == hosp_data["external_id"])
        ).scalar_one_or_none()
        if not hospital:
            hospital = Hospital(
                external_id=hosp_data["external_id"],
                name=hosp_data["name"],
                city=hosp_data["city"],
            )
            db.add(hospital)
            db.flush()

        # Doctors
        for d in HOSPITAL_DOCTORS[hosp_data["external_id"]]:
            existing = db.execute(
                select(Doctor).where(Doctor.hospital_id == hospital.id, Doctor.external_id == d["external_id"])
            ).scalar_one_or_none()
            if not existing:
                db.add(Doctor(
                    hospital_id=hospital.id,
                    external_id=d["external_id"],
                    name=d["name"],
                    department=d["department"],
                    slots=_random_slots(rng),
                ))
            elif not existing.slots:
                existing.slots = _random_slots(rng)
        # Departments from this hospital's doctors
        dept_names = {d["department"] for d in HOSPITAL_DOCTORS[hosp_data["external_id"]]}
        for dname in sorted(dept_names):
            existing_dept = db.execute(
                select(Department).where(
                    Department.hospital_id == hospital.id,
                    Department.name == dname,
                )
            ).scalar_one_or_none()
            if not existing_dept:
                db.add(Department(hospital_id=hospital.id, name=dname))
        total_doctors += len(HOSPITAL_DOCTORS[hosp_data["external_id"]])

        # 200 patients per hospital
        for i in range(1, 201):
            ext = f"{hosp_data['external_id']}-PAT-{i:03d}"
            gender = ["female", "male", "other", "prefer_not_to_say"][i % 4]
            address = f"{i}, Health Avenue, {hosp_data['city']}"
            emergency_contact = f"+91 8{hospital.id % 10}{i:08d}"
            existing = db.execute(
                select(Patient).where(Patient.hospital_id == hospital.id, Patient.external_id == ext)
            ).scalar_one_or_none()
            if not existing:
                age = rng.choice(
                    list(range(1, 6)) * 3 + list(range(6, 13)) * 2 + list(range(13, 18))
                    + list(range(18, 41)) * 3 + list(range(41, 61)) * 2 + list(range(61, 86))
                )
                db.add(Patient(
                    hospital_id=hospital.id,
                    external_id=ext,
                    name=f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
                    age=age,
                    age_band=age_to_band(age),
                    phone=_random_phone(rng),
                    address=address,
                    gender=gender,
                    emergency_contact=emergency_contact,
                ))
            else:
                # Backfill newly introduced registration fields without resetting queues.
                existing.address = existing.address or address
                existing.gender = existing.gender or gender
                existing.emergency_contact = existing.emergency_contact or emergency_contact
        total_patients += 200
        db.flush()

        # Scan machines + bootstrap samples
        patients_list = db.execute(
            select(Patient).where(Patient.hospital_id == hospital.id)
        ).scalars().all()

        for sm_tmpl in SCAN_MACHINES_PER_HOSPITAL:
            ext_id = f"{hosp_data['external_id']}-{sm_tmpl['external_id_suffix']}"
            machine = db.execute(
                select(ScanMachine).where(
                    ScanMachine.hospital_id == hospital.id,
                    ScanMachine.external_id == ext_id,
                )
            ).scalar_one_or_none()
            if not machine:
                machine = ScanMachine(
                    hospital_id=hospital.id,
                    external_id=ext_id,
                    name=sm_tmpl["name"],
                    scan_type=ScanType(sm_tmpl["scan_type"]),
                )
                db.add(machine)
                db.flush()
            # Bootstrap samples
            existing_samples = db.execute(
                select(ScanDurationSample).where(ScanDurationSample.machine_id == machine.id)
            ).scalars().all()
            if not existing_samples:
                for i in range(100):
                    p = patients_list[i % len(patients_list)]
                    jitter = rng_scan.randint(
                        -int(sm_tmpl["base_sec"] * 0.2),
                        int(sm_tmpl["base_sec"] * 0.25)
                    )
                    db.add(ScanDurationSample(
                        machine_id=machine.id,
                        scan_type=sm_tmpl["scan_type"],
                        age_band=p.age_band,
                        duration_sec=max(60, sm_tmpl["base_sec"] + jitter),
                        source="bootstrap",
                    ))

    db.commit()
    return {
        "hospital": f"{len(HOSPITALS)} hospitals",
        "doctors": total_doctors,
        "patients": total_patients,
        "message": "Seed complete",
    }


def load_training_json() -> Dict[str, Any]:
    generate_seed_files(force=False)
    return json.loads((SEED_DIR / "training_consults.json").read_text())
