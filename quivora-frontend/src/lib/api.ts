const API_BASE = "/api";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "include",
  });
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
  timezone?: string;
  is_active?: boolean;
  doctor_count?: number;
  patient_count?: number;
  machine_count?: number;
  admin_email?: string | null;
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
  consultation_fee: number;
  follow_up_fee: number;
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
  scheduled_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  public_token: string;
};

export type SlotAvailability = {
  slot: string;
  available: boolean;
  booked_count: number;
  reason?: string | null;
};

export type DoctorAvailability = {
  date: string;
  doctor_id: number;
  doctor_external_id: string;
  doctor_name: string;
  department: string;
  works_that_day: boolean;
  is_available: boolean;
  slots: SlotAvailability[];
};

export type SlotScheduleSummary = {
  slot: string;
  total_count: number;
  active_count: number;
  completed_count: number;
  no_show_count: number;
  cancelled_count: number;
  estimated_capacity: number;
  occupancy_pct: number;
};

export type DoctorDaySchedule = {
  date: string;
  doctor_id: number;
  doctor_external_id: string;
  doctor_name: string;
  works_that_day: boolean;
  slots: SlotScheduleSummary[];
  appointments: Appointment[];
  total_appointments: number;
  overall_occupancy_pct: number;
};

export type HospitalAvailability = {
  date: string;
  hospital_id: number;
  hospital_name: string;
  doctors: DoctorAvailability[];
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
  current_token?: number | null;
  slot?: string | null;
  doctor_live?: boolean;
};

export type OpdSummary = {
  live_doctors: number;
  total_doctors: number;
  patients_in_queue: number;
  consultations_today: number;
  total_samples: number;
};

export type InsightStatus = "green" | "amber" | "red";

export type HospitalInsights = {
  hospital_id: number;
  hospital_name: string;
  generated_at: string;
  range_days: number;
  delay_threshold_min: number;
  pulse: {
    avg_wait_min: number;
    patients_seen: number;
    patients_waiting: number;
    no_show_rate_pct: number;
    no_show_count: number;
    priority_share_pct: number;
    priority_count: number;
    longest_bottleneck: {
      type: string;
      name: string;
      department: string;
      queue: number;
      wait_min: number;
    };
    wait_source: "arrival-to-start" | "current ETA" | "unavailable";
    wait_observations: number;
  };
  recommendations: Array<{
    id: string;
    severity: "critical" | "warning" | "opportunity" | "info";
    category: string;
    title: string;
    evidence: string;
    action: string;
  }>;
  doctors: Array<{
    id: number;
    external_id: string;
    name: string;
    department: string;
    patients_seen: number;
    patients_per_day: number;
    avg_consult_min: number;
    department_avg_min: number;
    variance_vs_department_pct: number;
    downstream_wait_min: number;
    break_events: number;
    delay_events: number;
    delay_minutes: number;
    priority_mix: Record<"emergency" | "senior" | "urgent" | "normal", number>;
    utilization_pct: number;
    queue_now: number;
    is_live: boolean;
    is_on_break: boolean;
    data_source: string;
    consult_observations: number;
  }>;
  machines: Array<{
    id: number;
    external_id: string;
    name: string;
    scan_type: string;
    is_live: boolean;
    completed_scans: number;
    avg_scan_min: number;
    utilization_pct: number;
    utilization_by_hour: Array<{ hour: number; utilization_pct: number }>;
    current_backlog: number;
    historical_peak_backlog: number;
    avg_idle_gap_min: number;
    max_idle_gap_min: number;
    suggestion: string;
    data_source: string;
  }>;
  heatmap: {
    departments: string[];
    hours: number[];
    cells: Array<{ department: string; hour: number; count: number }>;
    max_count: number;
  };
  fairness: {
    delayed_threshold_min: number;
    patients_delayed: number;
    normal_patients_delayed: number;
    normal_delayed_rate_pct: number;
    priority_overrides: number;
    emergency_inserts: number;
    returning_patients: number;
    new_patients: number;
    returning_patient_ratio_pct: number;
    override_log: Array<{
      timestamp: string;
      event_type: string;
      patient_name: string;
      doctor_name: string;
      priority: string;
      reason: string;
    }>;
  };
  scoreboard: Array<{
    key: string;
    label: string;
    status: InsightStatus;
    value: string;
    explanation: string;
    action: string;
  }>;
  data_quality: {
    actual_wait_observations: number;
    live_doctor_samples: number;
    completed_live_scans: number;
    warnings: string[];
  };
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
  public_token: string;
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
  health: () => request<{ status: string; postgres: boolean; redis: boolean; telegram_enabled: boolean; telegram_bot_username: string | null; sms_enabled: boolean; sms_provider: string | null }>("/health"),
  opdSummary: (hospital_id?: number) =>
    request<OpdSummary>(`/v1/opd/summary${hospital_id ? `?hospital_id=${hospital_id}` : ""}`),
  hospitals: () => request<Hospital[]>("/v1/hospitals"),
  hospital: (ref: string | number) => request<Hospital>(`/v1/hospitals/${ref}`),
  createHospital: (body: { name: string; city: string; address?: string; phone?: string; timezone?: string; external_id?: string; admin_email?: string; admin_password?: string }) =>
    request<Hospital>("/v1/hospitals", { method: "POST", body: JSON.stringify(body) }),
  setHospitalCredentials: (ref: string | number, body: { admin_email: string; admin_password: string }) =>
    request<Hospital>(`/v1/hospitals/${ref}/credentials`, { method: "POST", body: JSON.stringify(body) }),
  updateHospital: (ref: string | number, body: Partial<{ name: string; city: string; address: string; phone: string; timezone: string; is_active: boolean }>) =>
    request<Hospital>(`/v1/hospitals/${ref}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteHospital: (ref: string | number) =>
    request<{ ok: boolean; id: number; is_active: boolean }>(`/v1/hospitals/${ref}`, { method: "DELETE" }),
  searchPatients: (q: string, hospital_id?: number) =>
    request<PatientRecord[]>(`/v1/patients/search?q=${encodeURIComponent(q)}${hospital_id ? `&hospital_id=${hospital_id}` : ""}`),
  patients: (hospital_id?: number) =>
    request<PatientRecord[]>(`/v1/patients${hospital_id ? `?hospital_id=${hospital_id}&limit=100` : "?limit=100"}`),
  createDoctor: (hospitalRef: string | number, body: { name: string; department: string; slots: string[]; work_days?: string[]; is_available?: boolean; consultation_fee?: number; follow_up_fee?: number }) =>
    request<Doctor>(`/v1/hospitals/${hospitalRef}/doctors`, { method: "POST", body: JSON.stringify(body) }),
  updateDoctor: (ref: string | number, body: Partial<{ name: string; department: string; slots: string[]; work_days: string[]; is_available: boolean; consultation_fee: number; follow_up_fee: number }>) =>
    request<Doctor>(`/v1/doctors/${ref}`, { method: "PATCH", body: JSON.stringify(body) }),
  startBreak: (ref: string | number) =>
    request<Doctor>(`/v1/doctors/${ref}/break/start`, { method: "POST" }),
  endBreak: (ref: string | number) =>
    request<Doctor>(`/v1/doctors/${ref}/break/end`, { method: "POST" }),
  runningLate: (ref: string | number, minutes = 15) =>
    request<Doctor>(`/v1/doctors/${ref}/running-late`, { method: "POST", body: JSON.stringify({ minutes }) }),
  receptionBoard: (hospitalRef: string | number) =>
    request<ReceptionBoard>(`/v1/hospitals/${hospitalRef}/reception-board`),
  insights: (hospitalRef: string | number, days = 7, delayThresholdMin = 30) =>
    request<HospitalInsights>(
      `/v1/hospitals/${hospitalRef}/insights?days=${days}&delay_threshold_min=${delayThresholdMin}`
    ),
  departments: (hospitalRef: string | number) =>
    request<Department[]>(`/v1/hospitals/${hospitalRef}/departments`),
  createDepartment: (hospitalRef: string | number, name: string) =>
    request<Department>(`/v1/hospitals/${hospitalRef}/departments`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteDepartment: (hospitalRef: string | number, departmentId: number) =>
    request<{ ok: boolean }>(`/v1/hospitals/${hospitalRef}/departments/${departmentId}`, { method: "DELETE" }),
  seed: () => request<{ hospital: string; doctors: number; patients: number; message: string }>("/v1/admin/seed?reset=true", { method: "POST" }),
  doctors: (hospital_id?: number, limit = 10, offset = 0) =>
    request<Doctor[]>(`/v1/doctors?limit=${limit}&offset=${offset}${hospital_id ? `&hospital_id=${hospital_id}` : ""}`),
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
    patient_phone?: string;
    age: number;
    appointment_type?: string;
    slot?: string;
    appointment_date?: string;
    priority?: string;
    priority_reason?: string;
  }) => request<Appointment>("/v1/appointments", { method: "POST", body: JSON.stringify(body) }),
  doctorAvailability: (ref: string | number, date?: string) =>
    request<DoctorAvailability>(
      `/v1/doctors/${ref}/availability${date ? `?date=${encodeURIComponent(date)}` : ""}`
    ),
  doctorSchedule: (ref: string | number, date?: string) =>
    request<DoctorDaySchedule>(
      `/v1/doctors/${ref}/schedule${date ? `?date=${encodeURIComponent(date)}` : ""}`
    ),
  hospitalAvailability: (ref: string | number, date?: string) =>
    request<HospitalAvailability>(
      `/v1/hospitals/${ref}/availability${date ? `?date=${encodeURIComponent(date)}` : ""}`
    ),
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
  patientCheckinHint: (hospitalRef: string | number, phone: string) =>
    request<{ found: boolean; name?: string | null; age?: number | null }>(
      `/v1/hospitals/${hospitalRef}/patients/checkin-hint?phone=${encodeURIComponent(phone)}`
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
  qrPngUrl: (ref: string | number) => `/api/v1/hospitals/${ref}/qr.png`,
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
  queue: (ref: string | number, slot?: string, date?: string) =>
    request<QueueItem[]>(
      `/v1/doctors/${ref}/queue${
        slot || date
          ? `?${[
              slot ? `slot=${encodeURIComponent(slot)}` : "",
              date ? `date=${encodeURIComponent(date)}` : "",
            ]
              .filter(Boolean)
              .join("&")}`
          : ""
      }`
    ),
  eta: (appointmentId: number) => request<Eta>(`/v1/appointments/${appointmentId}/eta`),
  publicTicket: (publicToken: string) =>
    request<{ kind: "opd" | "scan"; opd?: Eta; scan?: ScanEta }>(
      `/v1/public/tickets/${encodeURIComponent(publicToken)}`
    ),
  appointment: (id: number) => request<Appointment>(`/v1/appointments/${id}`),
  // Scan queue
  scanMachines: (hospital_id?: number, limit = 10, offset = 0) =>
    request<ScanMachine[]>(`/v1/scans/machines?limit=${limit}&offset=${offset}${hospital_id ? `&hospital_id=${hospital_id}` : ""}`),
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
