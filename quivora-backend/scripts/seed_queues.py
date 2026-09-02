"""
Direct DB seed — 2–15 patients per doctor slot and per scan machine.
Queues are slot-based for doctors.
"""
import random
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select, func, text
from app.db import SessionLocal, engine
from app.models import (
    Appointment, AppointmentStatus, AppointmentType,
    Doctor, Hospital, Patient,
    ScanAppointment, ScanMachine, ScanStatus,
)
from app.services.age_bands import age_to_band
from app.services.seed import _random_slots, ALL_SLOTS

FIRST = [
    "Aarav","Vivaan","Priya","Ananya","Rohan","Meera","Kabir","Divya","Sai","Neel",
    "Tanya","Ishaan","Riya","Aryan","Sneha","Raj","Kavya","Yash","Pooja","Om",
    "Simran","Dhruv","Neha","Kiran","Deepak","Aman","Sunita","Rahul","Suresh","Leena",
    "Rohit","Puja","Gaurav","Swati","Vikram","Amit","Zara","Dev","Nisha","Aditya",
]
LAST = [
    "Sharma","Patel","Singh","Reddy","Nair","Kapoor","Gupta","Bose","Iyer","Mehta",
    "Verma","Joshi","Rao","Desai","Pillai","Chopra","Malhotra","Das","Banerjee","Mishra",
]
AGES = list(range(4, 78))
rng = random.Random(99)

def rname(): return f"{rng.choice(FIRST)} {rng.choice(LAST)}"
def rage():  return rng.choice(AGES)
def rtype(): return rng.choice(["new", "new", "follow_up"])

def ensure_columns():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE doctors ADD COLUMN IF NOT EXISTS slots VARCHAR(64) DEFAULT 'morning'"))
        conn.execute(text("ALTER TABLE doctors ADD COLUMN IF NOT EXISTS active_slot VARCHAR(32)"))
        conn.execute(text("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS slot VARCHAR(32) DEFAULT 'morning'"))

def clear_live_queues(db):
    """Clear only live queue appointments so we can reseed cleanly."""
    db.execute(text("DELETE FROM predictions"))
    db.execute(text("DELETE FROM events"))
    db.execute(text("DELETE FROM appointments"))
    db.execute(text("DELETE FROM scan_predictions"))
    db.execute(text("DELETE FROM scan_appointments"))
    # Remove walk-in patients created by previous queue seeds
    db.execute(text("DELETE FROM patients WHERE external_id LIKE 'WALK-%'"))
    db.commit()

def run():
    ensure_columns()
    db = SessionLocal()
    try:
        clear_live_queues(db)

        doctors = db.execute(select(Doctor)).scalars().all()
        # Ensure every doctor has random slots
        for doc in doctors:
            doc.slots = _random_slots(rng)
            doc.active_slot = None
            doc.is_live = False
        db.commit()

        doc_ok = 0
        for doc in doctors:
            slots = [s.strip() for s in (doc.slots or "morning").split(",") if s.strip()] or ["morning"]
            for slot in slots:
                n = rng.randint(2, 8)
                for i in range(1, n + 1):
                    age = rage()
                    patient = Patient(
                        hospital_id=doc.hospital_id,
                        external_id=f"WALK-{uuid.uuid4().hex[:10]}",
                        name=rname(),
                        age=age,
                        age_band=age_to_band(age),
                    )
                    db.add(patient)
                    db.flush()
                    vtype = rtype()
                    from datetime import datetime, timezone
                    now_utc = datetime.now(timezone.utc)
                    db.add(Appointment(
                        hospital_id=doc.hospital_id,
                        external_id=f"APT-{uuid.uuid4().hex[:10]}",
                        doctor_id=doc.id,
                        patient_id=patient.id,
                        token=i,
                        appointment_type=AppointmentType.follow_up if vtype == "follow_up" else AppointmentType.new,
                        status=AppointmentStatus.scheduled,
                        age=age,
                        age_band=age_to_band(age),
                        slot=slot,
                        scheduled_at=now_utc,
                        created_at=now_utc,
                        telegram_chat_id="1140737679",
                    ))
                    doc_ok += 1
            db.commit()

        machines = db.execute(select(ScanMachine)).scalars().all()
        scan_ok = 0
        for machine in machines:
            n = rng.randint(2, 10)
            for i in range(1, n + 1):
                age = rage()
                patient = Patient(
                    hospital_id=machine.hospital_id,
                    external_id=f"WALK-{uuid.uuid4().hex[:10]}",
                    name=rname(),
                    age=age,
                    age_band=age_to_band(age),
                )
                db.add(patient)
                db.flush()
                db.add(ScanAppointment(
                    external_id=f"SCAN-{uuid.uuid4().hex[:10].upper()}",
                    machine_id=machine.id,
                    patient_id=patient.id,
                    token=i,
                    age=age,
                    age_band=age_to_band(age),
                    status=ScanStatus.scheduled,
                    telegram_chat_id="1140737679",
                ))
                scan_ok += 1
            db.commit()

        print(f"✓ Doctor queues  : {doc_ok} patients across {len(doctors)} doctors (slot-based)")
        print(f"✓ Scan queues    : {scan_ok} patients across {len(machines)} machines")
        print(f"✓ Total          : {doc_ok + scan_ok}")
        for doc in doctors[:5]:
            print(f"  · {doc.name}: slots={doc.slots}")
        if len(doctors) > 5:
            print(f"  · … and {len(doctors) - 5} more doctors")
    finally:
        db.close()

if __name__ == "__main__":
    run()
