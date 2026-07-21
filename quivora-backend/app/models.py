from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class AppointmentType(str, enum.Enum):
    new = "new"
    follow_up = "follow_up"


class AppointmentStatus(str, enum.Enum):
    scheduled = "scheduled"
    checked_in = "checked_in"
    in_progress = "in_progress"
    completed = "completed"
    no_show = "no_show"
    cancelled = "cancelled"


class EventType(str, enum.Enum):
    checked_in = "checked_in"
    started = "started"
    ended = "ended"
    no_show = "no_show"
    emergency_insert = "emergency_insert"
    priority_set = "priority_set"


class Priority(str, enum.Enum):
    """Triage tiers — lower rank = seen sooner (jumps FCFS order)."""
    emergency = "emergency"  # critical / life-threatening
    senior = "senior"        # age 60+
    urgent = "urgent"        # clinically urgent, not emergency
    normal = "normal"        # standard FCFS


# Sort key: lower = higher priority in queue
PRIORITY_RANK = {
    "emergency": 0,
    "senior": 1,
    "urgent": 2,
    "normal": 3,
}

PRIORITY_LABELS = {
    "emergency": "Emergency",
    "senior": "Senior (60+)",
    "urgent": "Urgent",
    "normal": "Normal",
}


class SessionSlot(str, enum.Enum):
    morning = "morning"        # 9 AM – 1 PM
    afternoon = "afternoon"    # 1 PM – 5 PM
    evening = "evening"        # 5 PM – 9 PM


SLOT_LABELS = {
    "morning": "Morning (9 AM – 1 PM)",
    "afternoon": "Afternoon (1 PM – 5 PM)",
    "evening": "Evening (5 PM – 9 PM)",
}

SLOT_ORDER = {"morning": 0, "afternoon": 1, "evening": 2}

WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DEFAULT_WORK_DAYS = "mon,tue,wed,thu,fri,sat"
WEEKDAY_LABELS = {
    "mon": "Mon", "tue": "Tue", "wed": "Wed", "thu": "Thu",
    "fri": "Fri", "sat": "Sat", "sun": "Sun",
}


class TrainJobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Hospital(Base):
    __tablename__ = "hospitals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, default="HOSP-001")
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    city: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    phone: Mapped[Optional[str]] = mapped_column(String(32))
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, default="Asia/Kolkata", server_default="Asia/Kolkata"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    doctors: Mapped[list["Doctor"]] = relationship(back_populates="hospital")
    patients: Mapped[list["Patient"]] = relationship(back_populates="hospital")
    scan_machines: Mapped[list["ScanMachine"]] = relationship(back_populates="hospital")
    departments: Mapped[list["Department"]] = relationship(back_populates="hospital")


class Department(Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("hospital_id", "name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hospital_id: Mapped[int] = mapped_column(ForeignKey("hospitals.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hospital: Mapped[Hospital] = relationship(back_populates="departments")


class Doctor(Base):
    __tablename__ = "doctors"
    __table_args__ = (UniqueConstraint("hospital_id", "external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hospital_id: Mapped[int] = mapped_column(ForeignKey("hospitals.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str] = mapped_column(String(120), nullable=False)
    # Comma-separated session slots this doctor works, e.g. "morning,evening"
    slots: Mapped[str] = mapped_column(String(64), nullable=False, default="morning")
    # Which slot session is active when is_live
    active_slot: Mapped[Optional[str]] = mapped_column(String(32))
    # Soft availability — hospital marks doctor as available for booking today
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_live: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    went_live_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Tokens restart from 1 after each session clear (go-live / go-offline)
    queue_epoch_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    work_days: Mapped[str] = mapped_column(String(64), nullable=False, default=DEFAULT_WORK_DAYS, server_default=DEFAULT_WORK_DAYS)
    is_on_break: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    break_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    delay_buffer_sec: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    consultation_fee: Mapped[int] = mapped_column(Integer, default=500, server_default="500")
    follow_up_fee: Mapped[int] = mapped_column(Integer, default=300, server_default="300")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hospital: Mapped[Hospital] = relationship(back_populates="doctors")
    appointments: Mapped[list["Appointment"]] = relationship(back_populates="doctor")
    duration_samples: Mapped[list["DurationSample"]] = relationship(back_populates="doctor")


class DoctorOpsEvent(Base):
    """Operational events used for break/delay analytics going forward."""
    __tablename__ = "doctor_ops_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    value_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    doctor: Mapped[Doctor] = relationship()


class Patient(Base):
    __tablename__ = "patients"
    __table_args__ = (UniqueConstraint("hospital_id", "external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hospital_id: Mapped[int] = mapped_column(ForeignKey("hospitals.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    address: Mapped[Optional[str]] = mapped_column(String(500))
    gender: Mapped[Optional[str]] = mapped_column(String(32))
    emergency_contact: Mapped[Optional[str]] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hospital: Mapped[Hospital] = relationship(back_populates="patients")
    appointments: Mapped[list["Appointment"]] = relationship(back_populates="patient")


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (UniqueConstraint("hospital_id", "external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hospital_id: Mapped[int] = mapped_column(ForeignKey("hospitals.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"), nullable=False)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False)
    token: Mapped[int] = mapped_column(Integer, nullable=False)
    appointment_type: Mapped[AppointmentType] = mapped_column(
        Enum(AppointmentType), default=AppointmentType.new
    )
    status: Mapped[AppointmentStatus] = mapped_column(
        Enum(AppointmentStatus), default=AppointmentStatus.scheduled
    )
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False)
    slot: Mapped[str] = mapped_column(String(32), nullable=False, default="morning")
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="normal", server_default="normal")
    priority_reason: Mapped[Optional[str]] = mapped_column(String(300))
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(String(64))
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    doctor: Mapped[Doctor] = relationship(back_populates="appointments")
    patient: Mapped[Patient] = relationship(back_populates="appointments")
    events: Mapped[list["QueueEvent"]] = relationship(back_populates="appointment")
    prediction: Mapped[Optional["Prediction"]] = relationship(back_populates="appointment", uselist=False)


class QueueEvent(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"), nullable=False)
    # Stored as string so new event types (e.g. priority_set) don't require Postgres ENUM alters
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(300))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    appointment: Mapped[Appointment] = relationship(back_populates="events")


class DurationSample(Base):
    __tablename__ = "duration_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id"), nullable=False)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False)
    appointment_type: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    hour_of_day: Mapped[int] = mapped_column(Integer, nullable=False)
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="live")  # live | bootstrap
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    doctor: Mapped[Doctor] = relationship(back_populates="duration_samples")


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"), unique=True)
    eta_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    confidence_min: Mapped[float] = mapped_column(Float, default=10.0)
    patients_ahead: Mapped[int] = mapped_column(Integer, default=0)
    wait_seconds: Mapped[int] = mapped_column(Integer, default=0)
    algorithm_version: Mapped[str] = mapped_column(String(32), default="v1-weighted")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    appointment: Mapped[Appointment] = relationship(back_populates="prediction")


class ScanType(str, enum.Enum):
    mri = "mri"
    ct = "ct"
    xray = "xray"
    ultrasound = "ultrasound"
    blood_test = "blood_test"


class ScanStatus(str, enum.Enum):
    scheduled = "scheduled"
    arrived = "arrived"
    in_progress = "in_progress"
    completed = "completed"
    no_show = "no_show"


class ScanMachine(Base):
    __tablename__ = "scan_machines"
    __table_args__ = (UniqueConstraint("hospital_id", "external_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hospital_id: Mapped[int] = mapped_column(ForeignKey("hospitals.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    scan_type: Mapped[ScanType] = mapped_column(Enum(ScanType), nullable=False)
    is_live: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    went_live_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    hospital: Mapped["Hospital"] = relationship(back_populates="scan_machines")
    scan_appointments: Mapped[list["ScanAppointment"]] = relationship(back_populates="machine")
    scan_samples: Mapped[list["ScanDurationSample"]] = relationship(back_populates="machine")


class ScanAppointment(Base):
    __tablename__ = "scan_appointments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("scan_machines.id"), nullable=False)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"), nullable=False)
    token: Mapped[int] = mapped_column(Integer, nullable=False)
    age: Mapped[int] = mapped_column(Integer, nullable=False)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False)
    telegram_chat_id: Mapped[Optional[str]] = mapped_column(String(64))
    status: Mapped[ScanStatus] = mapped_column(Enum(ScanStatus), default=ScanStatus.scheduled)
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    machine: Mapped[ScanMachine] = relationship(back_populates="scan_appointments")
    patient: Mapped[Patient] = relationship()
    scan_prediction: Mapped[Optional["ScanPrediction"]] = relationship(back_populates="scan_appointment", uselist=False)


class ScanDurationSample(Base):
    __tablename__ = "scan_duration_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("scan_machines.id"), nullable=False)
    scan_type: Mapped[str] = mapped_column(String(32), nullable=False)
    age_band: Mapped[str] = mapped_column(String(32), nullable=False)
    duration_sec: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="live")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    machine: Mapped[ScanMachine] = relationship(back_populates="scan_samples")


class ScanPrediction(Base):
    __tablename__ = "scan_predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scan_appointment_id: Mapped[int] = mapped_column(ForeignKey("scan_appointments.id"), unique=True)
    eta_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    confidence_min: Mapped[float] = mapped_column(Float, default=10.0)
    patients_ahead: Mapped[int] = mapped_column(Integer, default=0)
    wait_seconds: Mapped[int] = mapped_column(Integer, default=0)
    predicted_duration_sec: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    scan_appointment: Mapped[ScanAppointment] = relationship(back_populates="scan_prediction")


class TrainJob(Base):
    __tablename__ = "train_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[TrainJobStatus] = mapped_column(Enum(TrainJobStatus), default=TrainJobStatus.pending)
    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    current_doctor_name: Mapped[Optional[str]] = mapped_column(String(200))
    current_doctor_external_id: Mapped[Optional[str]] = mapped_column(String(64))
    current_department: Mapped[Optional[str]] = mapped_column(String(120))
    current_patient_name: Mapped[Optional[str]] = mapped_column(String(200))
    current_seq: Mapped[int] = mapped_column(Integer, default=0)
    consults_per_doctor: Mapped[int] = mapped_column(Integer, default=100)
    doctors_total: Mapped[int] = mapped_column(Integer, default=10)
    doctors_done: Mapped[int] = mapped_column(Integer, default=0)
    samples_done: Mapped[int] = mapped_column(Integer, default=0)
    samples_total: Mapped[int] = mapped_column(Integer, default=1000)
    doctor_progress_json: Mapped[Optional[str]] = mapped_column(Text)  # JSON map
    recent_feed_json: Mapped[Optional[str]] = mapped_column(Text)
    error_message: Mapped[Optional[str]] = mapped_column(Text)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
