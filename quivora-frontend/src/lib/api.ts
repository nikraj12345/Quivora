const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8100";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "quivora-dev-key";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (!headers.has("X-API-Key")) headers.set("X-API-Key", API_KEY);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json() as Promise<T>;
}

export type Hospital = {
  id: number;
  external_id: string;
  name: string;
  city: string;
  address?: string;
  phone?: string | null;
  is_active?: boolean;
  doctor_count?: number;
  patient_count?: number;
  machine_count?: number;
};

export type Department = {
  id: number;
  hospital_id: number;
  name: string;
};

export type PatientRecord = {
  id: number;
  external_id: string;
  name: string;
  age: number;
  age_band: string;
  phone: string | null;
  address: string | null;
  gender: string | null;
  emergency_contact: string | null;
  hospital_id: number;
};

export type Doctor = {
  id: number;
  external_id: string;
  name: string;
  department: string;
  hospital_id: number;
  hospital_name: string;
  hospital_city: string;
  slots: string[];
  work_days: string[];
  active_slot: string | null;
  is_available: boolean;
  is_on_break: boolean;
  break_started_at: string | null;
  delay_buffer_sec: number;
  works_today: boolean;
  sample_count: number;
  avg_duration_sec: number | null;
  is_live: boolean;
  went_live_at: string | null;
};

export type ReceptionDoctorRow = {
  id: number;
  external_id: string;
  name: string;
  department: string;
  slots: string[];
  work_days: string[];
  works_today: boolean;
  is_available: boolean;
  is_live: boolean;
  is_on_break: boolean;
  active_slot: string | null;
  status: "offline" | "live" | "break" | "unavailable";
  queue_total: number;
  queue_active_slot: number;
  current_token: number | null;
  current_patient: string | null;
  longest_wait_min: number | null;
  avg_duration_sec: number | null;
  delay_buffer_sec: number;
};

export type ReceptionBoard = {
  hospital_id: number;
  hospital_name: string;
  generated_at: string;
  summary: {
    doctors_total: number;
    doctors_live: number;
    doctors_on_break: number;
    patients_waiting: number;
  };
  doctors: ReceptionDoctorRow[];
};

export type TrainStatus = {
  job_id: string;
  status: string;
  progress_pct: number;
  current_doctor_name?: string;
  current_department?: string;
  current_patient_name?: string;
  current_seq: number;
  consults_per_doctor: number;
  doctors_total: number;
  doctors_done: number;
  samples_done: number;
  samples_total: number;
  doctor_progress: Record<
    string,
    { name: string; department: string; done: number; total: number; avg_sec: number | null }
  >;
  recent_feed: Array<{
    doctor_name: string;
    patient_name: string;
    age: number;
    duration_sec: number;
    seq: number;
  }>;
  error_message?: string;
};

export type QueueItem = {
  appointment_id: number;
  token: number;
  patient_name: string;
  age: number;
  age_band: string;
  status: string;
  slot: string;
  priority: string;
  priority_reason: string | null;
  predicted_duration_sec: number;
  eta_at: string | null;
};

export type Appointment = {
  id: number;
  external_id: string;
  doctor_id: number;
  doctor_name: string;
  patient_id: number;
  patient_name: string;
  token: number;
  age: number;
  age_band: string;
  appointment_type: string;
  status: string;
  slot?: string;
  priority?: string;
  priority_reason?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
};

export type Eta = {
  appointment_id: number;
  token: number;
  patient_name: string;
  doctor_name: string;
  status: string;
  patients_ahead: number;
  wait_seconds: number;
  eta_at: string | null;
  confidence_min: number;
  predicted_duration_sec: number;
};

export type OpdSummary = {
  live_doctors: number;
  total_doctors: number;
  patients_in_queue: number;
  consultations_today: number;
  total_samples: number;
};

export type ScanMachine = {
  id: number;
  external_id: string;
  name: string;
  scan_type: string;
  hospital_id: number;
  hospital_name: string;
  hospital_city: string;
  is_live: boolean;
  went_live_at: string | null;
  sample_count: number;
  avg_duration_sec: number | null;
};

export type ScanQueueItem = {
  appointment_id: number;
  token: number;
  patient_name: string;
  age: number;
  age_band: string;
  status: string;
  predicted_duration_sec: number;
  eta_at: string | null;
};

export type ScanAppointment = {
  id: number;
  external_id: string;
  machine_id: number;
  machine_name: string;
  scan_type: string;
  patient_name: string;
  token: number;
  age: number;
  age_band: string;
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
};

export type ScanEta = {
  appointment_id: number;
  token: number;
  patient_name: string;
  machine_name: string;
  scan_type: string;
  status: string;
  patients_ahead: number;
  wait_seconds: number;
  eta_at: string | null;
  confidence_min: number;
  predicted_duration_sec: number;
};

export const api = {
  health: () => request<{ status: string; postgres: boolean; redis: boolean; telegram_enabled: boolean; telegram_bot_username: string | null }>("/health"),
  opdSummary: () => request<OpdSummary>("/v1/opd/summary"),
  hospitals: () => request<Hospital[]>("/v1/hospitals"),
  hospital: (ref: string | number) => request<Hospital>(`/v1/hospitals/${ref}`),
  createHospital: (body: { name: string; city: string; address?: string; phone?: string; external_id?: string }) =>
    request<Hospital>("/v1/hospitals", { method: "POST", body: JSON.stringify(body) }),
  updateHospital: (ref: string | number, body: Partial<{ name: string; city: string; address: string; phone: string; is_active: boolean }>) =>
    request<Hospital>(`/v1/hospitals/${ref}`, { method: "PATCH", body: JSON.stringify(body) }),
  searchPatients: (q: string, hospital_id?: number) =>
    request<PatientRecord[]>(`/v1/patients/search?q=${encodeURIComponent(q)}${hospital_id ? `&hospital_id=${hospital_id}` : ""}`),
  patients: (hospital_id?: number) =>
    request<PatientRecord[]>(`/v1/patients${hospital_id ? `?hospital_id=${hospital_id}&limit=100` : "?limit=100"}`),
  createDoctor: (hospitalRef: string | number, body: { name: string; department: string; slots: string[]; work_days?: string[]; is_available?: boolean }) =>
    request<Doctor>(`/v1/hospitals/${hospitalRef}/doctors`, { method: "POST", body: JSON.stringify(body) }),
  updateDoctor: (ref: string | number, body: Partial<{ name: string; department: string; slots: string[]; work_days: string[]; is_available: boolean }>) =>
    request<Doctor>(`/v1/doctors/${ref}`, { method: "PATCH", body: JSON.stringify(body) }),
  startBreak: (ref: string | number) =>
    request<Doctor>(`/v1/doctors/${ref}/break/start`, { method: "POST" }),
  endBreak: (ref: string | number) =>
    request<Doctor>(`/v1/doctors/${ref}/break/end`, { method: "POST" }),
  runningLate: (ref: string | number, minutes = 15) =>
    request<Doctor>(`/v1/doctors/${ref}/running-late`, { method: "POST", body: JSON.stringify({ minutes }) }),
  receptionBoard: (hospitalRef: string | number) =>
    request<ReceptionBoard>(`/v1/hospitals/${hospitalRef}/reception-board`),
  departments: (hospitalRef: string | number) =>
    request<Department[]>(`/v1/hospitals/${hospitalRef}/departments`),
  createDepartment: (hospitalRef: string | number, name: string) =>
    request<Department>(`/v1/hospitals/${hospitalRef}/departments`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteDepartment: (hospitalRef: string | number, departmentId: number) =>
    request<{ ok: boolean }>(`/v1/hospitals/${hospitalRef}/departments/${departmentId}`, { method: "DELETE" }),
  seed: () => request<{ hospital: string; doctors: number; patients: number; message: string }>("/v1/admin/seed?reset=true", { method: "POST" }),
  doctors: (hospital_id?: number) => request<Doctor[]>(`/v1/doctors${hospital_id ? `?hospital_id=${hospital_id}` : ""}`),
  doctor: (ref: string | number) => request<Doctor>(`/v1/doctors/${ref}`),
  goLive: (ref: string | number, slot?: string) =>
    request<Doctor>(`/v1/doctors/${ref}/go-live${slot ? `?slot=${encodeURIComponent(slot)}` : ""}`, { method: "POST" }),
  goOffline: (ref: string | number) => request<Doctor>(`/v1/doctors/${ref}/go-offline`, { method: "POST" }),
  trainStats: () => request<{ doctors: Doctor[]; total_samples: number; trained: boolean }>("/v1/train/stats"),
  startTraining: (fast = false) =>
    request<{ job_id: string; status: string; message: string }>(`/v1/train/bootstrap?fast=${fast}`, { method: "POST" }),
  trainStatus: (jobId: string) => request<TrainStatus>(`/v1/train/status/${jobId}`),
  createAppointment: (body: {
    doctor_external_id: string;
    patient_name: string;
    age: number;
    appointment_type?: string;
    slot?: string;
    priority?: string;
    priority_reason?: string;
  }) => request<Appointment>("/v1/appointments", { method: "POST", body: JSON.stringify(body) }),
  hospitalQr: (ref: string | number) =>
    request<{
      hospital_id: number;
      hospital_name: string;
      city: string;
      checkin_url: string;
      qr_png_path: string;
      sample_phones: Array<{ name: string; phone: string; age: number }>;
    }>(`/v1/hospitals/${ref}/qr`),
  patientByPhone: (hospitalRef: string | number, phone: string) =>
    request<PatientRecord | null>(
      `/v1/hospitals/${hospitalRef}/patients/by-phone?phone=${encodeURIComponent(phone)}`
    ),
  selfCheckin: (
    hospitalRef: string | number,
    body: {
      phone: string;
      doctor_external_id: string;
      slot?: string;
      name?: string;
      age?: number;
      address?: string;
      gender?: string;
      emergency_contact?: string;
    }
  ) =>
    request<{
      is_new_patient: boolean;
      patient: PatientRecord;
      appointment: Appointment;
      checkin_url: string;
    }>(`/v1/hospitals/${hospitalRef}/self-checkin`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  qrPngUrl: (ref: string | number) => `${API_BASE}/v1/hospitals/${ref}/qr.png`,
  setPriority: (appointment_id: number, priority: string, reason: string) =>
    request<Appointment>(`/v1/appointments/${appointment_id}/priority`, {
      method: "PATCH",
      body: JSON.stringify({ priority, reason }),
    }),
  event: (appointment_id: number, event_type: string) =>
    request<Appointment>("/v1/events", {
      method: "POST",
      body: JSON.stringify({ appointment_id, event_type }),
    }),
  queue: (ref: string | number, slot?: string) =>
    request<QueueItem[]>(`/v1/doctors/${ref}/queue${slot ? `?slot=${encodeURIComponent(slot)}` : ""}`),
  eta: (appointmentId: number) => request<Eta>(`/v1/appointments/${appointmentId}/eta`),
  appointment: (id: number) => request<Appointment>(`/v1/appointments/${id}`),
  // Scan queue
  scanMachines: (hospital_id?: number) => request<ScanMachine[]>(`/v1/scans/machines${hospital_id ? `?hospital_id=${hospital_id}` : ""}`),
  scanMachine: (ref: string | number) => request<ScanMachine>(`/v1/scans/machines/${ref}`),
  scanGoLive: (ref: string | number) => request<ScanMachine>(`/v1/scans/machines/${ref}/go-live`, { method: "POST" }),
  scanGoOffline: (ref: string | number) => request<ScanMachine>(`/v1/scans/machines/${ref}/go-offline`, { method: "POST" }),
  scanQueue: (ref: string | number) => request<ScanQueueItem[]>(`/v1/scans/machines/${ref}/queue`),
  createScanAppointment: (body: { machine_external_id: string; patient_name: string; age: number }) =>
    request<ScanAppointment>("/v1/scans/appointments", { method: "POST", body: JSON.stringify(body) }),
  scanEvent: (appointment_id: number, event_type: string) =>
    request<ScanAppointment>("/v1/scans/events", { method: "POST", body: JSON.stringify({ appointment_id, event_type }) }),
  scanEta: (appointmentId: number) => request<ScanEta>(`/v1/scans/appointments/${appointmentId}/eta`),
};
