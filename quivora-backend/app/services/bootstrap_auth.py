from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Doctor, Hospital, User, UserRole
from app.services.passwords import hash_password


def _slug(external_id: str) -> str:
    return external_id.lower().replace("-", "")


def ensure_bootstrap_users(db: Session) -> None:
    platform = db.execute(
        select(User).where(User.role == UserRole.platform_admin.value)
    ).scalar_one_or_none()
    if not platform:
        db.add(User(
            email=settings.bootstrap_platform_email.lower(),
            name="Platform Admin",
            password_hash=hash_password(settings.bootstrap_platform_password),
            role=UserRole.platform_admin.value,
            is_active=True,
        ))
        db.commit()

    hospitals = db.execute(select(Hospital).order_by(Hospital.id)).scalars().all()
    for h in hospitals:
        slug = _slug(h.external_id)
        admin_email = f"admin-{slug}@quivora.local"
        staff_email = f"staff-{slug}@quivora.local"
        if not db.execute(select(User).where(User.email == admin_email)).scalar_one_or_none():
            db.add(User(
                email=admin_email,
                name=f"{h.name} Admin",
                password_hash=hash_password("Hospital@123"),
                role=UserRole.hospital_admin.value,
                hospital_id=h.id,
                is_active=True,
            ))
        if not db.execute(select(User).where(User.email == staff_email)).scalar_one_or_none():
            db.add(User(
                email=staff_email,
                name=f"{h.name} Reception",
                password_hash=hash_password("Staff@123"),
                role=UserRole.hospital_staff.value,
                hospital_id=h.id,
                is_active=True,
            ))
        doctors = db.execute(
            select(Doctor).where(Doctor.hospital_id == h.id).order_by(Doctor.id).limit(1)
        ).scalars().all()
        for d in doctors:
            if not d.room_pin_hash:
                d.room_pin_hash = hash_password("1234")
            doc_email = f"doctor-{d.external_id.lower()}@quivora.local"
            if not db.execute(select(User).where(User.email == doc_email)).scalar_one_or_none():
                db.add(User(
                    email=doc_email,
                    name=d.name,
                    password_hash=hash_password("Doctor@123"),
                    role=UserRole.doctor.value,
                    hospital_id=h.id,
                    doctor_id=d.id,
                    is_active=True,
                ))
    db.commit()


def ensure_doctor_room_pins(db: Session) -> None:
    doctors = db.execute(select(Doctor).where(Doctor.room_pin_hash.is_(None))).scalars().all()
    if not doctors:
        return
    for d in doctors:
        d.room_pin_hash = hash_password("1234")
    db.commit()


def print_demo_credentials(db: Session | None = None) -> None:
    """Print demo login accounts (passwords are bcrypt-hashed in DB, not stored in plain text)."""
    from app.config import settings

    print("→ Demo login accounts (passwords stored as bcrypt hashes in DB)")
    print(f"  Platform admin     : {settings.bootstrap_platform_email} / {settings.bootstrap_platform_password}")
    if db is not None:
        hospitals = db.execute(select(Hospital).order_by(Hospital.id)).scalars().all()
        for h in hospitals:
            slug = _slug(h.external_id)
            print(f"  {h.external_id} ({h.name})")
            print(f"    Hospital admin   : admin-{slug}@quivora.local / Hospital@123")
            print(f"    Reception staff  : staff-{slug}@quivora.local / Staff@123")
    else:
        print("  Per hospital: admin-hosp00N@quivora.local / Hospital@123")
        print("                staff-hosp00N@quivora.local / Staff@123")
    print("  Doctor login       : doctor-<external-id>@quivora.local / Doctor@123 (first doctor per hospital)")
    print("  Doctor room PIN    : 1234 (bcrypt-hashed on doctor record)")
    print("  Sign in at http://localhost:3000/login")
