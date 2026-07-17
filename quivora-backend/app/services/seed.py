from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    Appointment,
    AppointmentStatus,
    AppointmentType,
    Department,
    Doctor,
    DoctorOpsEvent,
    DurationSample,
    Hospital,
    Patient,
    Prediction,
    QueueEvent,
    ScanAppointment,
    ScanDurationSample,
    ScanMachine,
    ScanPrediction,
    ScanStatus,
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
        db.execute(delete(DoctorOpsEvent))
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


def seed_insights_demo(db: Session, hospital: Hospital, days: int = 21) -> Dict[str, Any]:
    """Create deterministic, timestamp-consistent operational history for Insights demos."""
    prefix = f"INS-{hospital.external_id}"
    existing = db.execute(
        select(Appointment).where(
            Appointment.hospital_id == hospital.id,
            Appointment.external_id.like(f"{prefix}-%"),
        )
    ).scalars().all()
    if existing:
        return {
            "hospital_id": hospital.id,
            "appointments": len(existing),
            "message": "Insights demo data already loaded",
        }

    doctors = db.execute(
        select(Doctor).where(Doctor.hospital_id == hospital.id).order_by(Doctor.id)
    ).scalars().all()
    patients = db.execute(
        select(Patient).where(Patient.hospital_id == hospital.id).order_by(Patient.id)
    ).scalars().all()
    machines = db.execute(
        select(ScanMachine).where(ScanMachine.hospital_id == hospital.id).order_by(ScanMachine.id)
    ).scalars().all()
    if not doctors or not patients:
        raise ValueError("Seed hospitals, doctors, and patients before Insights demo data")

    try:
        hospital_tz = ZoneInfo(getattr(hospital, "timezone", None) or "Asia/Kolkata")
    except ZoneInfoNotFoundError:
        hospital_tz = ZoneInfo("Asia/Kolkata")
    now = datetime.now(timezone.utc)
    local_now = now.astimezone(hospital_tz)
    rng = random.Random(20260717 + hospital.id)

    appointment_count = completed_count = no_show_count = 0
    scan_count = completed_scan_count = 0
    token_by_doctor: Dict[int, int] = {doctor.id: 0 for doctor in doctors}
    patient_index = 0

    # Historical OPD: realistic check-in, start and end timestamps.
    for day_offset in range(days, 0, -1):
        local_day = (local_now - timedelta(days=day_offset)).date()
        if local_day.weekday() == 6:
            continue
        for doctor_index, doctor in enumerate(doctors):
            daily_volume = 5 + ((day_offset + doctor_index) % 4)
            pace = 0.78 + doctor_index * 0.09
            for seq in range(daily_volume):
                patient = patients[patient_index % len(patients)]
                patient_index += 1
                token_by_doctor[doctor.id] += 1
                hour = 9 + min(7, seq + (2 if doctor_index % 3 == 0 else 0))
                minute = (seq * 11 + doctor_index * 7) % 50
                scheduled = datetime(
                    local_day.year, local_day.month, local_day.day, hour, minute,
                    tzinfo=hospital_tz,
                ).astimezone(timezone.utc)
                is_no_show = (seq + day_offset + doctor_index) % 11 == 0
                is_emergency = seq == 0 and (day_offset + doctor_index) % 6 == 0
                is_urgent = not is_emergency and (seq + doctor_index) % 9 == 0
                is_senior = not is_emergency and not is_urgent and patient.age >= 60
                priority = (
                    "emergency" if is_emergency else
                    "urgent" if is_urgent else
                    "senior" if is_senior else
                    "normal"
                )
                appt = Appointment(
                    hospital_id=hospital.id,
                    external_id=f"{prefix}-OPD-{day_offset:02d}-{doctor.id}-{seq:02d}",
                    doctor_id=doctor.id,
                    patient_id=patient.id,
                    token=token_by_doctor[doctor.id],
                    appointment_type=(
                        AppointmentType.follow_up if (seq + day_offset) % 3 == 0
                        else AppointmentType.new
                    ),
                    status=AppointmentStatus.no_show if is_no_show else AppointmentStatus.completed,
                    age=patient.age,
                    age_band=patient.age_band,
                    slot="morning" if hour < 13 else "afternoon",
                    priority=priority,
                    priority_reason=(
                        "Clinical emergency escalation" if is_emergency else
                        "Nurse marked clinically urgent" if is_urgent else
                        "Age-based senior priority" if is_senior else None
                    ),
                    scheduled_at=scheduled,
                    created_at=scheduled - timedelta(hours=20),
                )
                db.add(appt)
                db.flush()
                appointment_count += 1

                if is_no_show:
                    no_show_at = scheduled + timedelta(minutes=25)
                    db.add(QueueEvent(
                        appointment_id=appt.id,
                        event_type="no_show",
                        note="Patient did not arrive",
                        timestamp=no_show_at,
                    ))
                    no_show_count += 1
                    continue

                check_in = scheduled + timedelta(minutes=rng.randint(-5, 8))
                peak_delay = 12 if 10 <= hour < 12 else 3
                doctor_delay = int(doctor_index * 1.8)
                wait_min = max(2, peak_delay + doctor_delay + rng.randint(-3, 8))
                started = check_in + timedelta(minutes=wait_min)
                consult_min = max(5, int((8 + (patient.age / 18) + rng.randint(-2, 4)) * pace))
                ended = started + timedelta(minutes=consult_min)
                appt.started_at = started
                appt.ended_at = ended
                db.add_all([
                    QueueEvent(appointment_id=appt.id, event_type="checked_in", timestamp=check_in),
                    QueueEvent(appointment_id=appt.id, event_type="started", timestamp=started),
                    QueueEvent(appointment_id=appt.id, event_type="ended", timestamp=ended),
                ])
                if priority != "normal":
                    db.add(QueueEvent(
                        appointment_id=appt.id,
                        event_type="priority_set",
                        note=f"Initial triage: {priority}",
                        timestamp=check_in,
                    ))
                if is_emergency:
                    db.add(QueueEvent(
                        appointment_id=appt.id,
                        event_type="emergency_insert",
                        note="Escalated after nurse assessment",
                        timestamp=check_in + timedelta(minutes=2),
                    ))
                completed_count += 1

    # Live OPD queue: generates current waits, bottlenecks and fairness metrics.
    today = local_now.date()
    for seq in range(min(18, len(patients))):
        doctor = doctors[seq % min(4, len(doctors))]
        patient = patients[(patient_index + seq) % len(patients)]
        token_by_doctor[doctor.id] += 1
        arrival = now - timedelta(minutes=8 + seq * 3)
        priority = "emergency" if seq in {0, 9} else "senior" if patient.age >= 60 else "normal"
        appt = Appointment(
            hospital_id=hospital.id,
            external_id=f"{prefix}-LIVE-{seq:03d}",
            doctor_id=doctor.id,
            patient_id=patient.id,
            token=token_by_doctor[doctor.id],
            appointment_type=AppointmentType.follow_up if seq % 4 == 0 else AppointmentType.new,
            status=AppointmentStatus.checked_in,
            age=patient.age,
            age_band=patient.age_band,
            slot="morning" if local_now.hour < 13 else "afternoon",
            priority=priority,
            priority_reason="Live emergency escalation" if priority == "emergency" else (
                "Age-based senior priority" if priority == "senior" else None
            ),
            scheduled_at=arrival,
            created_at=arrival - timedelta(hours=2),
        )
        db.add(appt)
        db.flush()
        wait_min = 8 + (seq % 6) * 9
        db.add(QueueEvent(
            appointment_id=appt.id,
            event_type="checked_in",
            timestamp=arrival,
        ))
        if priority == "emergency":
            db.add_all([
                QueueEvent(
                    appointment_id=appt.id,
                    event_type="priority_set",
                    note="Initial triage: normal",
                    timestamp=arrival,
                ),
                QueueEvent(
                    appointment_id=appt.id,
                    event_type="emergency_insert",
                    note="Escalated from triage desk",
                    timestamp=arrival + timedelta(minutes=1),
                ),
            ])
        db.add(Prediction(
            appointment_id=appt.id,
            eta_at=now + timedelta(minutes=wait_min),
            confidence_min=6.0,
            patients_ahead=max(0, wait_min // 10),
            wait_seconds=wait_min * 60,
            algorithm_version="insights-demo",
            updated_at=now,
        ))
        appointment_count += 1

    for index, doctor in enumerate(doctors):
        doctor.is_live = index < min(4, len(doctors))
        doctor.active_slot = "morning" if local_now.hour < 13 else "afternoon"
        for event_day in (3, 8, 13):
            at = now - timedelta(days=event_day, hours=index % 3)
            db.add(DoctorOpsEvent(
                doctor_id=doctor.id,
                event_type="break_start",
                value_min=0,
                timestamp=at,
            ))
            if (index + event_day) % 2 == 0:
                db.add(DoctorOpsEvent(
                    doctor_id=doctor.id,
                    event_type="running_late",
                    value_min=10 + (index % 3) * 5,
                    timestamp=at + timedelta(hours=1),
                ))

    # Historical machine activity with intentionally different hourly demand.
    if machines:
        for day_offset in range(days, 0, -1):
            local_day = (local_now - timedelta(days=day_offset)).date()
            if local_day.weekday() == 6:
                continue
            for machine_index, machine in enumerate(machines):
                base_min = {"mri": 32, "ct": 13, "xray": 6, "ultrasound": 19}.get(
                    getattr(machine.scan_type, "value", str(machine.scan_type)), 12
                )
                daily_scans = 3 if "MRI" in machine.name else 5 + machine_index % 2
                for seq in range(daily_scans):
                    patient = patients[(patient_index + scan_count) % len(patients)]
                    hour = 9 + seq * 2 + (machine_index % 2)
                    scheduled = datetime(
                        local_day.year, local_day.month, local_day.day, min(hour, 19),
                        (seq * 7) % 45, tzinfo=hospital_tz,
                    ).astimezone(timezone.utc)
                    started = scheduled + timedelta(minutes=rng.randint(2, 14))
                    duration = max(3, base_min + rng.randint(-3, 5))
                    ended = started + timedelta(minutes=duration)
                    scan = ScanAppointment(
                        external_id=f"{prefix}-SCAN-{day_offset:02d}-{machine.id}-{seq:02d}",
                        machine_id=machine.id,
                        patient_id=patient.id,
                        token=scan_count + 1,
                        age=patient.age,
                        age_band=patient.age_band,
                        status=ScanStatus.completed,
                        scheduled_at=scheduled,
                        started_at=started,
                        ended_at=ended,
                        created_at=scheduled - timedelta(days=1),
                    )
                    db.add(scan)
                    scan_count += 1
                    completed_scan_count += 1

        for seq in range(min(6, len(patients))):
            machine = machines[seq % min(2, len(machines))]
            patient = patients[(patient_index + seq + 30) % len(patients)]
            scheduled = now - timedelta(minutes=10 + seq * 4)
            scan = ScanAppointment(
                external_id=f"{prefix}-SCAN-LIVE-{seq:02d}",
                machine_id=machine.id,
                patient_id=patient.id,
                token=scan_count + 1,
                age=patient.age,
                age_band=patient.age_band,
                status=ScanStatus.arrived,
                scheduled_at=scheduled,
                created_at=scheduled - timedelta(hours=1),
            )
            db.add(scan)
            db.flush()
            wait_min = 14 + seq * 8
            db.add(ScanPrediction(
                scan_appointment_id=scan.id,
                eta_at=now + timedelta(minutes=wait_min),
                confidence_min=7.0,
                patients_ahead=seq // 2,
                wait_seconds=wait_min * 60,
                predicted_duration_sec=20 * 60,
                updated_at=now,
            ))
            machine.is_live = True
            scan_count += 1

    db.commit()
    return {
        "hospital_id": hospital.id,
        "appointments": appointment_count,
        "completed_consultations": completed_count,
        "no_shows": no_show_count,
        "scans": scan_count,
        "completed_scans": completed_scan_count,
        "message": "Insights demo data loaded",
    }
