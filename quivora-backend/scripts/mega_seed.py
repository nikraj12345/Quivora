#!/usr/bin/env python3
"""
mega_seed.py — One-shot comprehensive data seeder for Quivora.

Run from the quivora-backend directory:
    python -m scripts.mega_seed

Populates:
  • 20 hospitals
  • 15 departments per hospital (300 total)
  • 2-5 doctors per department per hospital (~900-1200 doctors)
  • 10,000+ patients
  • 5,000+ completed appointments (past)
  • 1,000-2,000 in-progress / checked-in appointments (today)
  • 5,000+ future scheduled appointments
  • scan_machines (3-5 per hospital, various types)
  • scan_appointments: completed / in-progress / future (similar ratios)
  • duration_samples derived from completed appointments
  • users: platform_admin x1, hospital_admin x1 per hospital, hospital_staff x2 per hospital,
           doctor users x5 sample, patient users x5 sample
"""

import os
import random
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import bcrypt
from sqlalchemy.orm import Session

from app.db import SessionLocal, engine
from app.models import (
    Appointment,
    AppointmentStatus,
    AppointmentType,
    Department,
    Doctor,
    DurationSample,
    Hospital,
    Patient,
    Priority,
    QueueEvent,
    ScanAppointment,
    ScanDurationSample,
    ScanMachine,
    ScanStatus,
    ScanType,
    User,
    UserRole,
    Base,
)
from app.services.public_tokens import generate_public_token

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS / LOOKUP DATA
# ─────────────────────────────────────────────────────────────────────────────

HOSPITAL_DATA = [
    ("HOSP-101", "Apollo Hospitals Delhi",            "Delhi",      "Sarita Vihar, Mathura Road, New Delhi",            "+91-11-26925858"),
    ("HOSP-102", "Fortis Memorial Research Institute","Gurgaon",    "Sector 44, Opposite HUDA City Centre, Gurugram",   "+91-124-4921021"),
    ("HOSP-103", "Max Super Speciality Hospital",     "Delhi",      "1, Press Enclave Road, Saket, New Delhi",          "+91-11-26515050"),
    ("HOSP-104", "AIIMS New Delhi",                   "Delhi",      "Ansari Nagar, New Delhi",                          "+91-11-26588500"),
    ("HOSP-105", "Medanta The Medicity",              "Gurgaon",    "CH Baktawar Singh Road, Sector 38, Gurugram",      "+91-124-4141414"),
    ("HOSP-106", "Kokilaben Dhirubhai Ambani Hospital","Mumbai",    "Rao Saheb Achutrao Patwardhan Marg, Mumbai",       "+91-22-30999999"),
    ("HOSP-107", "Lilavati Hospital",                 "Mumbai",     "A-791, Bandra Reclamation, Bandra West, Mumbai",   "+91-22-26551000"),
    ("HOSP-108", "Narayana Health City",              "Bengaluru",  "258/A, Bommasandra Industrial Area, Bengaluru",    "+91-80-71222222"),
    ("HOSP-109", "Manipal Hospital Bengaluru",        "Bengaluru",  "98, HAL Airport Road, Kodihalli, Bengaluru",       "+91-80-25024444"),
    ("HOSP-110", "Christian Medical College",         "Vellore",    "IDA Scudder Road, Vellore, Tamil Nadu",            "+91-416-2281000"),
    ("HOSP-111", "KIMS Hospital",                     "Hyderabad",  "1-8-31/1, Minister Road, Secunderabad",            "+91-40-44885000"),
    ("HOSP-112", "Care Hospitals",                    "Hyderabad",  "Exhibition Road, Nampally, Hyderabad",             "+91-40-30418000"),
    ("HOSP-113", "Ruby Hall Clinic",                  "Pune",       "40, Sassoon Road, Pune",                           "+91-20-26163391"),
    ("HOSP-114", "Sahyadri Hospitals",                "Pune",       "Plot 30-C, Karve Road, Deccan Gymkhana, Pune",     "+91-20-67218888"),
    ("HOSP-115", "Sri Ramachandra Institute",         "Chennai",    "No.1, Ramachandra Nagar, Porur, Chennai",          "+91-44-45928600"),
    ("HOSP-116", "Global Hospitals Chennai",          "Chennai",    "439, Cheran Nagar, Perumbakkam, Chennai",          "+91-44-44777000"),
    ("HOSP-117", "Amrita Institute of Medical Sciences","Kochi",    "AIMS Ponekkara P.O., Ernakulam, Kochi",            "+91-484-2801234"),
    ("HOSP-118", "PGIMER",                            "Chandigarh", "Sector 12, Chandigarh",                            "+91-172-2756565"),
    ("HOSP-119", "NIMHANS",                           "Bengaluru",  "Hosur Road, Lakkasandra, Bengaluru",               "+91-80-46110007"),
    ("HOSP-120", "Tata Memorial Hospital",            "Mumbai",     "Dr E Borges Rd, Parel, Mumbai",                    "+91-22-24177000"),
]

DEPARTMENT_NAMES = [
    "General Medicine", "Cardiology", "Orthopedics", "Pediatrics", "Gynecology",
    "Neurology", "Dermatology", "ENT", "Pulmonology", "Gastroenterology",
    "Nephrology", "Oncology", "Ophthalmology", "Psychiatry", "Endocrinology",
]

DOCTOR_FIRST_NAMES = [
    "Aarav","Aditi","Ajay","Amrita","Ananya","Anil","Anita","Anjali","Arjun","Aryan",
    "Deepa","Deepika","Dev","Divya","Gaurav","Geeta","Ishaan","Ishita","Kabir","Kavya",
    "Kiran","Komal","Lakshmi","Leena","Mahesh","Manish","Meera","Neel","Neha","Nikhil",
    "Pallavi","Pooja","Preethi","Priya","Rahul","Raj","Ravi","Rekha","Ritu","Rohan",
    "Sachin","Samir","Sanjay","Seema","Simran","Sneha","Sunil","Suresh","Swati","Tanvi",
    "Usha","Varun","Vikram","Vikas","Vivek","Yamini","Yogesh","Zara","Bhavna","Chitra",
]

DOCTOR_LAST_NAMES = [
    "Sharma","Verma","Singh","Kumar","Gupta","Patel","Joshi","Nair","Iyer","Mehta",
    "Reddy","Rao","Pillai","Menon","Kapoor","Malhotra","Chopra","Bose","Das","Banerjee",
    "Krishnan","Murugan","Subramanian","Venkat","Rajan","Srinivas","Yadav","Tiwari","Pandey","Shah",
    "Desai","Jain","Agarwal","Mishra","Dubey","Chauhan","Bhatt","Trivedi","Srivastava","Saxena",
]

PATIENT_FIRST_NAMES = [
    "Aarav","Aditya","Akash","Amit","Amita","Ananya","Anjali","Ankur","Ankit","Anup",
    "Arjun","Arya","Ashish","Ashok","Astha","Atul","Ayesha","Bharat","Bhavna","Deepak",
    "Deepika","Dev","Dhruv","Divya","Farhan","Fatima","Gaurav","Geeta","Hari","Heena",
    "Ishaan","Ishita","Jaya","Jitendra","Kabir","Karan","Kavita","Kiran","Komal","Kritika",
    "Lakshmi","Lalit","Leena","Mahesh","Manish","Maya","Meera","Mohit","Monika","Mukesh",
    "Naveen","Neha","Nikhil","Nilesh","Nisha","Om","Pallavi","Pooja","Pradeep","Priya",
    "Rahul","Raj","Rajesh","Rakesh","Ramesh","Ravi","Reena","Rekha","Rita","Rohan",
    "Sachin","Salma","Samir","Sanjay","Sara","Seema","Shiva","Shruti","Simran","Sneha",
    "Sunil","Sunita","Suresh","Swati","Tanvi","Tanya","Usha","Varun","Vikram","Vipul",
    "Vivek","Yamini","Yogesh","Yusuf","Zara","Gaurang","Chetan","Himani","Kirti","Mona",
]

PATIENT_LAST_NAMES = [
    "Sharma","Verma","Singh","Kumar","Gupta","Patel","Joshi","Nair","Iyer","Mehta",
    "Reddy","Rao","Pillai","Menon","Kapoor","Malhotra","Chopra","Bose","Das","Banerjee",
    "Krishnan","Murugan","Subramanian","Venkat","Rajan","Srinivas","Yadav","Tiwari","Pandey","Shah",
    "Desai","Jain","Agarwal","Mishra","Dubey","Chauhan","Bhatt","Trivedi","Srivastava","Saxena",
    "Chaudhary","Pal","Rawat","Bisht","Bhandari","Negi","Thakur","Ahuja","Anand","Arora",
]

GENDER_OPTIONS  = ["male", "female", "other", "prefer_not_to_say"]
GENDER_WEIGHTS  = [45, 45, 5, 5]

AGE_BANDS = [
    ("child_0_5",       0,  5),
    ("child_6_12",      6, 12),
    ("teen_13_17",     13, 17),
    ("adult_18_40",    18, 40),
    ("adult_41_59",    41, 59),
    ("senior_60_plus", 60, 90),
]
AGE_BAND_WEIGHTS = [5, 8, 7, 35, 25, 20]

SLOTS_OPTIONS = [
    "morning", "afternoon", "evening",
    "morning,afternoon", "morning,evening", "afternoon,evening",
    "morning,afternoon,evening",
]
WORK_DAYS_OPTIONS = [
    "mon,tue,wed,thu,fri",
    "mon,tue,wed,thu,fri,sat",
    "mon,wed,fri",
    "tue,thu,sat",
    "mon,tue,wed,thu,fri,sat,sun",
]

PRIORITY_OPTIONS = [p.value for p in Priority]
PRIORITY_WEIGHTS = [3, 7, 15, 75]   # emergency, senior, urgent, normal

SCAN_MACHINE_NAMES = {
    "mri":        ["MRI Scanner 1.5T", "MRI Scanner 3T Siemens", "MRI Suite A", "MRI Suite B"],
    "ct":         ["CT Scanner 64-slice", "CT Suite Trauma", "CT Scanner GE Revolution", "CT Suite B"],
    "xray":       ["X-Ray Room 1", "X-Ray Room 2", "Digital X-Ray Unit", "Portable X-Ray"],
    "ultrasound": ["USG Machine 1", "Ultrasound Suite", "Portable USG", "Color Doppler Unit"],
    "blood_test": ["Lab Analyzer A", "Haematology Lab", "Biochemistry Lab", "POCT Station"],
}

TODAY = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

rng = random.Random(42)


def _phone():
    return f"+91 {rng.randint(6,9)}{rng.randint(100000000,999999999)}"


def _hash_password(plain):
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def _rand_age_band():
    band_name, lo, hi = rng.choices(AGE_BANDS, weights=AGE_BAND_WEIGHTS)[0]
    age = rng.randint(lo, hi)
    return age, band_name


def _past_dt(days_ago_max=365, days_ago_min=1):
    days  = rng.randint(days_ago_min, days_ago_max)
    hour  = rng.randint(8, 20)
    minute = rng.choice([0, 15, 30, 45])
    return TODAY - timedelta(days=days) + timedelta(hours=hour, minutes=minute)


def _future_dt(days_ahead_max=90, days_ahead_min=1):
    days  = rng.randint(days_ahead_min, days_ahead_max)
    hour  = rng.randint(8, 20)
    minute = rng.choice([0, 15, 30, 45])
    return TODAY + timedelta(days=days, hours=hour, minutes=minute)


def _today_dt():
    hour  = rng.randint(8, 20)
    minute = rng.choice([0, 15, 30, 45])
    return TODAY + timedelta(hours=hour, minutes=minute)


def _counter_str(prefix, n, width=6):
    return f"{prefix}{str(n).zfill(width)}"


def _slot_for_hour(hour):
    if 9 <= hour < 13:
        return "morning"
    elif 13 <= hour < 17:
        return "afternoon"
    return "evening"


# ─────────────────────────────────────────────────────────────────────────────
# SEEDING
# ─────────────────────────────────────────────────────────────────────────────

def seed_hospitals(db):
    print("  -> Seeding hospitals ...")
    hosp_ext_ids = [r[0] for r in HOSPITAL_DATA]
    existing = {h.external_id for h in db.query(Hospital).filter(Hospital.external_id.in_(hosp_ext_ids)).all()}
    for ext_id, name, city, address, phone in HOSPITAL_DATA:
        if ext_id in existing:
            continue
        db.add(Hospital(
            external_id=ext_id, name=name, city=city,
            address=address, phone=phone, timezone="Asia/Kolkata", is_active=True,
        ))
    db.commit()
    hospitals = db.query(Hospital).filter(Hospital.external_id.in_(hosp_ext_ids)).all()
    print(f"     {len(hospitals)} hospitals ready.")
    return hospitals


def seed_departments(db, hospitals):
    print("  -> Seeding departments ...")
    dept_map = {}
    for h in hospitals:
        existing_names = {d.name for d in db.query(Department).filter_by(hospital_id=h.id).all()}
        for dname in DEPARTMENT_NAMES:
            if dname not in existing_names:
                db.add(Department(hospital_id=h.id, name=dname))
        db.commit()
        dept_map[h.id] = db.query(Department).filter_by(hospital_id=h.id).all()
    total = sum(len(v) for v in dept_map.values())
    print(f"     {total} departments ready.")
    return dept_map


def seed_doctors(db, hospitals, dept_map):
    print("  -> Seeding doctors ...")
    doc_counter = 101
    # find highest existing counter to avoid conflicts
    last = db.query(Doctor).filter(Doctor.external_id.like("DOC-%")).order_by(Doctor.id.desc()).first()
    if last:
        try:
            last_num = int(last.external_id.split("-")[1])
            if last_num >= doc_counter:
                doc_counter = last_num + 1
        except Exception:
            pass

    for h in hospitals:
        existing_ext = {d.external_id for d in db.query(Doctor).filter_by(hospital_id=h.id).all()}
        for dept in dept_map[h.id]:
            count = rng.randint(2, 5)
            for _ in range(count):
                ext_id = _counter_str("DOC-", doc_counter)
                doc_counter += 1
                if ext_id in existing_ext:
                    continue
                cons_fee = rng.choice([300, 400, 500, 600, 700, 800, 1000, 1200, 1500])
                db.add(Doctor(
                    hospital_id=h.id,
                    external_id=ext_id,
                    name=f"Dr. {rng.choice(DOCTOR_FIRST_NAMES)} {rng.choice(DOCTOR_LAST_NAMES)}",
                    department=dept.name,
                    slots=rng.choice(SLOTS_OPTIONS),
                    work_days=rng.choice(WORK_DAYS_OPTIONS),
                    is_available=True,
                    is_live=False,
                    consultation_fee=cons_fee,
                    follow_up_fee=int(cons_fee * rng.uniform(0.4, 0.7)),
                    delay_buffer_sec=rng.choice([0, 0, 0, 60, 120, 180]),
                ))
        db.commit()

    all_doctors = db.query(Doctor).all()
    print(f"     {len(all_doctors)} doctors ready.")
    return all_doctors


def seed_patients(db, hospitals, target=10000):
    print(f"  -> Seeding patients (target {target}) ...")
    existing_count = db.query(Patient).count()
    needed = max(0, target - existing_count)

    # find next external id counter
    pat_counter = existing_count + 1
    last = db.query(Patient).filter(Patient.external_id.like("PAT-%")).order_by(Patient.id.desc()).first()
    if last:
        try:
            last_num = int(last.external_id.split("-")[1])
            if last_num >= pat_counter:
                pat_counter = last_num + 1
        except Exception:
            pass

    batch = []
    hosp_cycle = hospitals * (needed // max(len(hospitals), 1) + 1)
    for i in range(needed):
        h = hosp_cycle[i % len(hosp_cycle)]
        age, age_band = _rand_age_band()
        batch.append(Patient(
            hospital_id=h.id,
            external_id=_counter_str("PAT-", pat_counter),
            name=f"{rng.choice(PATIENT_FIRST_NAMES)} {rng.choice(PATIENT_LAST_NAMES)}",
            age=age,
            age_band=age_band,
            phone=_phone(),
            gender=rng.choices(GENDER_OPTIONS, weights=GENDER_WEIGHTS)[0],
            address=f"{rng.randint(1,999)}, Sector {rng.randint(1,50)}, {h.city}",
            emergency_contact=_phone() if rng.random() > 0.3 else None,
        ))
        pat_counter += 1
        if len(batch) >= 500:
            db.add_all(batch); db.commit(); batch = []
    if batch:
        db.add_all(batch); db.commit()

    all_patients = db.query(Patient).all()
    print(f"     {len(all_patients)} patients ready.")
    return all_patients


def seed_appointments(db, hospitals, doctors, patients):
    print("  -> Seeding appointments ...")

    doc_by_hosp = {}
    for d in doctors:
        doc_by_hosp.setdefault(d.hospital_id, []).append(d)

    pat_by_hosp = {}
    for p in patients:
        pat_by_hosp.setdefault(p.hospital_id, []).append(p)

    existing_count = db.query(Appointment).count()
    apt_counter = existing_count + 1
    last = db.query(Appointment).filter(Appointment.external_id.like("APT-%")).order_by(Appointment.id.desc()).first()
    if last:
        try:
            last_num = int(last.external_id.split("-")[1])
            if last_num >= apt_counter:
                apt_counter = last_num + 1
        except Exception:
            pass

    token_tracker = {}

    def get_token_for_slot_and_date(doctor_id, slot, scheduled_at):
        d_str = scheduled_at.strftime("%Y-%m-%d")
        key = (doctor_id, slot, d_str)
        token_tracker[key] = token_tracker.get(key, 0) + 1
        return token_tracker[key]

    def make_apt(h, doc, pat, status, scheduled_at, started_at=None, ended_at=None):
        nonlocal apt_counter
        priority = rng.choices(PRIORITY_OPTIONS, weights=PRIORITY_WEIGHTS)[0]
        apt_type = rng.choices(
            [AppointmentType.new, AppointmentType.follow_up], weights=[65, 35]
        )[0]
        slot = _slot_for_hour(scheduled_at.hour)
        tok = get_token_for_slot_and_date(doc.id, slot, scheduled_at)
        a = Appointment(
            hospital_id=h.id,
            external_id=_counter_str("APT-", apt_counter),
            doctor_id=doc.id,
            patient_id=pat.id,
            token=tok,
            appointment_type=apt_type,
            status=status,
            age=pat.age,
            age_band=pat.age_band,
            slot=slot,
            priority=priority,
            scheduled_at=scheduled_at,
            started_at=started_at,
            ended_at=ended_at,
            public_token=generate_public_token(),
        )
        apt_counter += 1
        return a, apt_type

    batch = []
    dur_samples = []
    completed_count = active_count = future_count = 0

    def flush_batch():
        if batch:
            db.add_all(batch)
            if dur_samples:
                db.add_all(dur_samples)
            db.commit()
            batch.clear()
            dur_samples.clear()

    # --- COMPLETED (past 180 days) ---
    for _ in range(5500):
        h = rng.choice(hospitals)
        docs = doc_by_hosp.get(h.id, [])
        pats = pat_by_hosp.get(h.id, [])
        if not docs or not pats:
            continue
        doc = rng.choice(docs)
        pat = rng.choice(pats)
        sched = _past_dt(days_ago_max=180, days_ago_min=2)
        dur_sec = rng.randint(180, 1800)
        start = sched + timedelta(minutes=rng.randint(0, 30))
        end = start + timedelta(seconds=dur_sec)
        apt, apt_type = make_apt(h, doc, pat, AppointmentStatus.completed, sched, start, end)
        batch.append(apt)
        dur_samples.append(DurationSample(
            doctor_id=doc.id,
            age_band=pat.age_band,
            appointment_type=apt_type.value,
            duration_sec=dur_sec,
            hour_of_day=start.hour,
            day_of_week=start.weekday(),
            source="bootstrap",
        ))
        completed_count += 1
        if len(batch) >= 300:
            flush_batch()
    flush_batch()
    print(f"     Completed appointments: {completed_count}")

    # --- ACTIVE TODAY ---
    for _ in range(1500):
        h = rng.choice(hospitals)
        docs = doc_by_hosp.get(h.id, [])
        pats = pat_by_hosp.get(h.id, [])
        if not docs or not pats:
            continue
        doc = rng.choice(docs)
        pat = rng.choice(pats)
        sched = _today_dt()
        status = rng.choices(
            [AppointmentStatus.checked_in, AppointmentStatus.in_progress, AppointmentStatus.scheduled],
            weights=[40, 30, 30]
        )[0]
        started_at = None
        if status == AppointmentStatus.in_progress:
            started_at = TODAY + timedelta(hours=rng.randint(8, 17), minutes=rng.randint(0, 59))
        apt, _ = make_apt(h, doc, pat, status, sched, started_at)
        batch.append(apt)
        active_count += 1
        if len(batch) >= 300:
            flush_batch()
    flush_batch()
    print(f"     Active appointments: {active_count}")

    # --- FUTURE ---
    for _ in range(5500):
        h = rng.choice(hospitals)
        docs = doc_by_hosp.get(h.id, [])
        pats = pat_by_hosp.get(h.id, [])
        if not docs or not pats:
            continue
        doc = rng.choice(docs)
        pat = rng.choice(pats)
        sched = _future_dt(days_ahead_max=90)
        apt, _ = make_apt(h, doc, pat, AppointmentStatus.scheduled, sched)
        batch.append(apt)
        future_count += 1
        if len(batch) >= 300:
            flush_batch()
    flush_batch()
    print(f"     Future appointments: {future_count}")
    print(f"     Total appointments in DB: {db.query(Appointment).count()}")


def seed_scan_machines(db, hospitals):
    print("  -> Seeding scan machines ...")
    machine_map = {}
    machine_counter = 101
    last = db.query(ScanMachine).filter(ScanMachine.external_id.like("SCN-%")).order_by(ScanMachine.id.desc()).first()
    if last:
        try:
            last_num = int(last.external_id.split("-")[1])
            if last_num >= machine_counter:
                machine_counter = last_num + 1
        except Exception:
            pass

    for h in hospitals:
        existing = db.query(ScanMachine).filter_by(hospital_id=h.id).all()
        if existing:
            machine_map[h.id] = existing
            continue
        machines = []
        chosen_types = rng.sample(list(ScanType), k=rng.randint(3, 5))
        for st in chosen_types:
            name = rng.choice(SCAN_MACHINE_NAMES[st.value])
            db.add(ScanMachine(
                hospital_id=h.id,
                external_id=_counter_str("SCN-", machine_counter),
                name=name,
                scan_type=st,
                is_live=False,
            ))
            machine_counter += 1
        db.commit()
        machine_map[h.id] = db.query(ScanMachine).filter_by(hospital_id=h.id).all()

    total = sum(len(v) for v in machine_map.values())
    print(f"     {total} scan machines ready.")
    return machine_map


def seed_scan_appointments(db, machine_map, patients):
    print("  -> Seeding scan appointments ...")
    pat_by_hosp = {}
    for p in patients:
        pat_by_hosp.setdefault(p.hospital_id, []).append(p)

    existing_count = db.query(ScanAppointment).count()
    scan_counter = existing_count + 1
    last = db.query(ScanAppointment).filter(ScanAppointment.external_id.like("SCNA-%")).order_by(ScanAppointment.id.desc()).first()
    if last:
        try:
            last_num = int(last.external_id.split("-")[1])
            if last_num >= scan_counter:
                scan_counter = last_num + 1
        except Exception:
            pass

    scan_token_tracker = {}
    def get_scan_token_for_date(machine_id, scheduled_at):
        d_str = scheduled_at.strftime("%Y-%m-%d")
        key = (machine_id, d_str)
        scan_token_tracker[key] = scan_token_tracker.get(key, 0) + 1
        return scan_token_tracker[key]

    batch = []
    scan_samples = []
    total_completed = total_active = total_future = 0

    def flush():
        if batch:
            db.add_all(batch)
            if scan_samples:
                db.add_all(scan_samples)
            db.commit()
            batch.clear()
            scan_samples.clear()

    for hosp_id, machines in machine_map.items():
        if not machines:
            continue
        pats = pat_by_hosp.get(hosp_id, [])
        if not pats:
            continue

        # 250 completed
        for _ in range(250):
            machine = rng.choice(machines)
            pat = rng.choice(pats)
            sched = _past_dt(days_ago_max=180)
            dur_sec = rng.randint(300, 3600)
            start = sched + timedelta(minutes=rng.randint(0, 20))
            end = start + timedelta(seconds=dur_sec)
            batch.append(ScanAppointment(
                external_id=_counter_str("SCNA-", scan_counter),
                machine_id=machine.id,
                patient_id=pat.id,
                token=get_scan_token_for_date(machine.id, sched),
                age=pat.age,
                age_band=pat.age_band,
                status=ScanStatus.completed,
                scheduled_at=sched,
                started_at=start,
                ended_at=end,
                public_token=generate_public_token(),
            ))
            scan_samples.append(ScanDurationSample(
                machine_id=machine.id,
                scan_type=machine.scan_type.value,
                age_band=pat.age_band,
                duration_sec=dur_sec,
                source="bootstrap",
            ))
            scan_counter += 1
            total_completed += 1
            if len(batch) >= 300:
                flush()

        # 50 active
        for _ in range(50):
            machine = rng.choice(machines)
            pat = rng.choice(pats)
            sched = _today_dt()
            status = rng.choices(
                [ScanStatus.arrived, ScanStatus.in_progress, ScanStatus.scheduled],
                weights=[35, 30, 35]
            )[0]
            started_at = None
            if status == ScanStatus.in_progress:
                started_at = TODAY + timedelta(hours=rng.randint(8, 17))
            batch.append(ScanAppointment(
                external_id=_counter_str("SCNA-", scan_counter),
                machine_id=machine.id,
                patient_id=pat.id,
                token=get_scan_token_for_date(machine.id, sched),
                age=pat.age,
                age_band=pat.age_band,
                status=status,
                scheduled_at=sched,
                started_at=started_at,
                public_token=generate_public_token(),
            ))
            scan_counter += 1
            total_active += 1
            if len(batch) >= 300:
                flush()

        # 250 future
        for _ in range(250):
            machine = rng.choice(machines)
            pat = rng.choice(pats)
            sched = _future_dt()
            batch.append(ScanAppointment(
                external_id=_counter_str("SCNA-", scan_counter),
                machine_id=machine.id,
                patient_id=pat.id,
                token=get_scan_token_for_date(machine.id, sched),
                age=pat.age,
                age_band=pat.age_band,
                status=ScanStatus.scheduled,
                scheduled_at=sched,
                public_token=generate_public_token(),
            ))
            scan_counter += 1
            total_future += 1
            if len(batch) >= 300:
                flush()

    flush()
    print(f"     Scan appointments — completed: {total_completed}, active: {total_active}, future: {total_future}")
    print(f"     Total scan appointments in DB: {db.query(ScanAppointment).count()}")


def seed_users(db, hospitals, doctors, patients):
    print("  -> Seeding users ...")
    created = 0

    def add_user(email, name, role, hospital_id=None, doctor_id=None, patient_id=None):
        nonlocal created
        if db.query(User).filter_by(email=email).first():
            return
        db.add(User(
            email=email,
            name=name,
            password_hash=_hash_password("Quivora@123"),
            role=role,
            hospital_id=hospital_id,
            doctor_id=doctor_id,
            patient_id=patient_id,
            is_active=True,
        ))
        created += 1

    # Platform admin
    add_user("admin@quivora.local", "Platform Admin", UserRole.platform_admin.value)

    # Per-hospital users
    for h in hospitals:
        slug = h.external_id.lower().replace("-", "")
        add_user(f"admin@{slug}.quivora.local",  f"Admin – {h.name}",    UserRole.hospital_admin.value,  hospital_id=h.id)
        add_user(f"staff1@{slug}.quivora.local", f"Staff 1 – {h.name}",  UserRole.hospital_staff.value,  hospital_id=h.id)
        add_user(f"staff2@{slug}.quivora.local", f"Staff 2 – {h.name}",  UserRole.hospital_staff.value,  hospital_id=h.id)

    # 5 doctor logins
    sample_docs = rng.sample(doctors, min(5, len(doctors)))
    for i, doc in enumerate(sample_docs, start=1):
        add_user(f"doctor{i}@quivora.demo", doc.name, UserRole.doctor.value,
                 hospital_id=doc.hospital_id, doctor_id=doc.id)

    # 5 patient logins
    sample_pats = rng.sample(patients, min(5, len(patients)))
    for i, pat in enumerate(sample_pats, start=1):
        add_user(f"patient{i}@quivora.demo", pat.name, UserRole.patient.value,
                 hospital_id=pat.hospital_id, patient_id=pat.id)

    db.commit()
    print(f"     {created} new users created.")

    print()
    print("  +-----------------------------------------------------------------------+")
    print("  |                     SAMPLE LOGIN CREDENTIALS                          |")
    print("  +--------------------+----------------------------------+----------------+")
    print("  | Role               | Email                            | Password       |")
    print("  +--------------------+----------------------------------+----------------+")
    print("  | platform_admin     | admin@quivora.local              | Quivora@123    |")
    print("  | hospital_admin     | admin@hosp101.quivora.local      | Quivora@123    |")
    print("  | hospital_staff     | staff1@hosp101.quivora.local     | Quivora@123    |")
    print("  | hospital_staff     | staff2@hosp101.quivora.local     | Quivora@123    |")
    print("  | doctor             | doctor1@quivora.demo             | Quivora@123    |")
    print("  | doctor             | doctor2@quivora.demo             | Quivora@123    |")
    print("  | doctor             | doctor3@quivora.demo             | Quivora@123    |")
    print("  | doctor             | doctor4@quivora.demo             | Quivora@123    |")
    print("  | doctor             | doctor5@quivora.demo             | Quivora@123    |")
    print("  | patient            | patient1@quivora.demo            | Quivora@123    |")
    print("  | patient            | patient2@quivora.demo            | Quivora@123    |")
    print("  | patient            | patient3@quivora.demo            | Quivora@123    |")
    print("  | patient            | patient4@quivora.demo            | Quivora@123    |")
    print("  | patient            | patient5@quivora.demo            | Quivora@123    |")
    print("  +-----------------------------------------------------------------------+")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def nuke_database(db: Session) -> None:
    """Drop every row in every table, in FK-safe dependency order."""
    print("  -> Nuking existing data ...")
    # Order matters: children first, then parents
    tables_in_order = [
        "scan_predictions",
        "scan_duration_samples",
        "scan_appointments",
        "scan_machines",
        "predictions",
        "duration_samples",
        "events",
        "appointments",
        "doctor_ops_events",
        "doctors",
        "patients",
        "departments",
        "hospital_api_keys",
        "train_jobs",
        "users",
        "hospitals",
    ]
    from sqlalchemy import text
    with engine.begin() as conn:
        tables_str = ", ".join(tables_in_order)
        conn.execute(text(f"TRUNCATE TABLE {tables_str} RESTART IDENTITY CASCADE"))
    print(f"     Wiped {len(tables_in_order)} tables. Starting fresh.")


def main():
    print()
    print("=" * 70)
    print("  Quivora Mega Seed -- starting")
    print("=" * 70)

    Base.metadata.create_all(bind=engine)

    with SessionLocal() as db:
        nuke_database(db)
        hospitals   = seed_hospitals(db)
        dept_map    = seed_departments(db, hospitals)
        doctors     = seed_doctors(db, hospitals, dept_map)
        patients    = seed_patients(db, hospitals, target=10000)
        seed_appointments(db, hospitals, doctors, patients)
        machine_map = seed_scan_machines(db, hospitals)
        seed_scan_appointments(db, machine_map, patients)
        seed_users(db, hospitals, doctors, patients)

    print()
    print("=" * 70)
    print("  Mega seed complete!")
    print("=" * 70)
    print()


if __name__ == "__main__":
    main()
