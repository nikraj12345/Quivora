from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class HospitalOut(BaseModel):
    id: int
    external_id: str
    name: str
    city: str
    address: str = ""
    phone: Optional[str] = None
    is_active: bool = True
    doctor_count: int = 0
    patient_count: int = 0
    machine_count: int = 0

    class Config:
        from_attributes = True


class HospitalCreate(BaseModel):
    name: str
    city: str
    address: str = ""
    phone: Optional[str] = None
    external_id: Optional[str] = None


class HospitalUpdate(BaseModel):
    name: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None


class DepartmentOut(BaseModel):
    id: int
    hospital_id: int
    name: str

    class Config:
        from_attributes = True


class DepartmentCreate(BaseModel):
    name: str


class DoctorCreate(BaseModel):
    name: str
    department: str
    slots: List[str] = ["morning"]
    work_days: List[str] = ["mon", "tue", "wed", "thu", "fri", "sat"]
    is_available: bool = True
    external_id: Optional[str] = None


class DoctorUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    slots: Optional[List[str]] = None
    work_days: Optional[List[str]] = None
    is_available: Optional[bool] = None


class RunningLateBody(BaseModel):
    minutes: int = Field(default=15, ge=5, le=60)


class PatientOut(BaseModel):
    id: int
    external_id: str
    name: str
    age: int
    age_band: str
    phone: Optional[str] = None
    address: Optional[str] = None
    gender: Optional[str] = None
    emergency_contact: Optional[str] = None
    hospital_id: int

    class Config:
        from_attributes = True


class SeedResponse(BaseModel):
    hospital: str
    doctors: int
    patients: int
    message: str


class AppointmentCreate(BaseModel):
    external_id: Optional[str] = None
    doctor_external_id: str
    patient_external_id: Optional[str] = None
    patient_name: Optional[str] = None
    age: int
    token: Optional[int] = None
    appointment_type: str = "new"
    slot: Optional[str] = None  # morning | afternoon | evening
    priority: Optional[str] = None  # emergency | senior | urgent | normal
    priority_reason: Optional[str] = None
    scheduled_at: Optional[datetime] = None


class AppointmentOut(BaseModel):
    id: int
    external_id: str
    doctor_id: int
    doctor_name: str
    patient_id: int
    patient_name: str
    token: int
    age: int
    age_band: str
    appointment_type: str
    status: str
    slot: str = "morning"
    priority: str = "normal"
    priority_reason: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SelfCheckinBody(BaseModel):
    phone: str
    doctor_external_id: str
    slot: Optional[str] = None
    name: Optional[str] = None  # required if new patient
    age: Optional[int] = None   # required if new patient
    address: Optional[str] = None
    gender: Optional[str] = None
    emergency_contact: Optional[str] = None


class SelfCheckinOut(BaseModel):
    is_new_patient: bool
    patient: PatientOut
    appointment: AppointmentOut
    checkin_url: str


class HospitalQrInfoOut(BaseModel):
    hospital_id: int
    hospital_name: str
    city: str
    checkin_url: str
    qr_png_path: str
    sample_phones: list[dict]  # demo helpers for testing


class EventCreate(BaseModel):
    appointment_id: int
    event_type: str  # checked_in | started | ended | no_show | emergency_insert
    note: Optional[str] = None


class PriorityUpdate(BaseModel):
    priority: str  # emergency | senior | urgent | normal
    reason: str = Field(..., min_length=1, max_length=300)


class DoctorOut(BaseModel):
    id: int
    external_id: str
    name: str
    department: str
    hospital_id: int = 0
    hospital_name: str = ""
    hospital_city: str = ""
    slots: List[str] = []
    work_days: List[str] = []
    active_slot: Optional[str] = None
    is_available: bool = True
    is_on_break: bool = False
    break_started_at: Optional[datetime] = None
    delay_buffer_sec: int = 0
    works_today: bool = True
    sample_count: int = 0
    avg_duration_sec: Optional[float] = None
    is_live: bool = False
    went_live_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ReceptionDoctorRow(BaseModel):
    id: int
    external_id: str
    name: str
    department: str
    slots: List[str] = []
    work_days: List[str] = []
    works_today: bool = True
    is_available: bool = True
    is_live: bool = False
    is_on_break: bool = False
    active_slot: Optional[str] = None
    status: str  # offline | live | break | unavailable
    queue_total: int = 0
    queue_active_slot: int = 0
    current_token: Optional[int] = None
    current_patient: Optional[str] = None
    longest_wait_min: Optional[int] = None
    avg_duration_sec: Optional[float] = None
    delay_buffer_sec: int = 0


class ReceptionBoardOut(BaseModel):
    hospital_id: int
    hospital_name: str
    generated_at: datetime
    summary: Dict[str, int]
    doctors: List[ReceptionDoctorRow]


class QueueItemOut(BaseModel):
    appointment_id: int
    token: int
    patient_name: str
    age: int
    age_band: str
    status: str
    slot: str = "morning"
    priority: str = "normal"
    priority_reason: Optional[str] = None
    predicted_duration_sec: int
    eta_at: Optional[datetime] = None


class EtaOut(BaseModel):
    appointment_id: int
    token: int
    patient_name: str
    doctor_name: str
    status: str
    patients_ahead: int
    wait_seconds: int
    eta_at: Optional[datetime]
    confidence_min: float
    predicted_duration_sec: int


class TrainStartResponse(BaseModel):
    job_id: str
    status: str
    message: str


class TrainStatusOut(BaseModel):
    job_id: str
    status: str
    progress_pct: float
    current_doctor_name: Optional[str] = None
    current_doctor_external_id: Optional[str] = None
    current_department: Optional[str] = None
    current_patient_name: Optional[str] = None
    current_seq: int = 0
    consults_per_doctor: int = 100
    doctors_total: int = 10
    doctors_done: int = 0
    samples_done: int = 0
    samples_total: int = 1000
    doctor_progress: Dict[str, Any] = Field(default_factory=dict)
    recent_feed: List[Dict[str, Any]] = Field(default_factory=list)
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class TrainStatsOut(BaseModel):
    doctors: List[Dict[str, Any]]
    total_samples: int
    trained: bool


class HealthOut(BaseModel):
    status: str
    postgres: bool
    redis: bool


class OpdSummaryOut(BaseModel):
    live_doctors: int
    total_doctors: int
    patients_in_queue: int
    consultations_today: int
    total_samples: int


class ScanMachineOut(BaseModel):
    id: int
    external_id: str
    name: str
    scan_type: str
    hospital_id: int = 0
    hospital_name: str = ""
    hospital_city: str = ""
    is_live: bool = False
    went_live_at: Optional[datetime] = None
    sample_count: int = 0
    avg_duration_sec: Optional[float] = None

    class Config:
        from_attributes = True


class ScanAppointmentCreate(BaseModel):
    machine_external_id: str
    patient_name: Optional[str] = None
    age: int
    appointment_type: str = "new"


class ScanAppointmentOut(BaseModel):
    id: int
    external_id: str
    machine_id: int
    machine_name: str
    scan_type: str
    patient_name: str
    token: int
    age: int
    age_band: str
    status: str
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class ScanQueueItemOut(BaseModel):
    appointment_id: int
    token: int
    patient_name: str
    age: int
    age_band: str
    status: str
    predicted_duration_sec: int
    eta_at: Optional[datetime] = None


class ScanEtaOut(BaseModel):
    appointment_id: int
    token: int
    patient_name: str
    machine_name: str
    scan_type: str
    status: str
    patients_ahead: int
    wait_seconds: int
    eta_at: Optional[datetime]
    confidence_min: float
    predicted_duration_sec: int


class ScanEventCreate(BaseModel):
    appointment_id: int
    event_type: str  # arrived | scan_started | scan_ended | no_show
