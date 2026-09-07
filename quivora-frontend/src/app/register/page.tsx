"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor, DoctorAvailability, Eta, Hospital, PatientRecord, ScanEta, ScanMachine } from "@/lib/api";
import { formatSlotsList, slotLabel, slotShort, slotTime } from "@/lib/slots";
import { PRIORITY_META, Priority, suggestPriority } from "@/lib/priority";
import { useAuth } from "@/lib/auth";

type Step = "hospital" | "patient" | "service" | "payment" | "confirm";
type PaymentMethod = "upi" | "cash";
type PaymentStatus = "paid" | "pending" | "skipped";

const BASE_STEPS: { key: Step; label: string }[] = [
  { key: "hospital", label: "Hospital" },
  { key: "patient", label: "Patient" },
  { key: "service", label: "Service" },
  { key: "payment", label: "Payment" },
  { key: "confirm", label: "Token" },
];

const SCAN_FEES: Record<string, number> = {
  mri: 3500,
  ct: 2500,
  xray: 800,
  ultrasound: 1200,
  blood_test: 500,
};

const SCAN_LABELS: Record<string, string> = {
  mri: "MRI", ct: "CT Scan", xray: "X-Ray", ultrasound: "Ultrasound", blood_test: "Blood Test",
};

function consultationFee(
  serviceType: "doctor" | "scan",
  visitType: "new" | "follow_up",
  doctor?: Doctor | null,
  scanType?: string,
) {
  if (serviceType === "scan") return SCAN_FEES[scanType || ""] ?? 1000;
  if (visitType === "follow_up") return doctor?.follow_up_fee ?? 300;
  return doctor?.consultation_fee ?? 500;
}

function formatInr(amount: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function mockPaymentRef(apptId: number) {
  return `QIV${String(apptId).padStart(6, "0")}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function needsPaymentStep(serviceType: "doctor" | "scan", appointmentDate: string) {
  return serviceType === "scan" || appointmentDate === localDateString();
}

function digitsOnly(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function localDateString(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatAppointmentDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtEtaTime(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtWaitMins(sec: number) {
  const m = Math.round(sec / 60);
  if (m < 1) return "< 1 min";
  return `~${m} min`;
}

function estWaitFromQueue(queueLen: number, avgSec?: number | null) {
  const per = avgSec ? Math.max(5, Math.round(avgSec / 60)) : 12;
  return queueLen * per;
}

const SLOT_START_HOUR: Record<string, number> = {
  morning: 9,
  afternoon: 13,
  evening: 17,
};

function estExpectedByDate(
  ahead: number,
  avgSec?: number | null,
  slot?: string,
  appointmentDate?: string,
): Date {
  const waitMin = estWaitFromQueue(ahead, avgSec);
  const slotKey = slot || "morning";
  const now = new Date();

  if (appointmentDate && appointmentDate !== localDateString()) {
    const [y, m, d] = appointmentDate.split("-").map(Number);
    const hour = SLOT_START_HOUR[slotKey] ?? 9;
    const slotStart = new Date(y, m - 1, d, hour, 0, 0, 0);
    return new Date(slotStart.getTime() + waitMin * 60 * 1000);
  }

  const slotStart = new Date(now);
  slotStart.setHours(SLOT_START_HOUR[slotKey] ?? 9, 0, 0, 0);
  const base = slotStart > now ? slotStart : now;
  return new Date(base.getTime() + waitMin * 60 * 1000);
}

function resolvedWaitLabel(
  ahead: number,
  waitSeconds: number,
  avgSec?: number | null,
) {
  if (waitSeconds > 0) return fmtWaitMins(waitSeconds);
  if (ahead > 0) return `~${estWaitFromQueue(ahead, avgSec)} min`;
  return "< 1 min";
}

function resolvedExpectedByLabel(
  ahead: number,
  waitSeconds: number,
  etaAt: string | null | undefined,
  avgSec?: number | null,
  slot?: string,
  appointmentDate?: string,
) {
  if (etaAt) return fmtEtaTime(etaAt);
  if (ahead <= 0 && waitSeconds <= 0) return fmtEtaTime(new Date().toISOString());
  if (waitSeconds > 0) {
    return fmtEtaTime(new Date(Date.now() + waitSeconds * 1000).toISOString());
  }
  return fmtEtaTime(estExpectedByDate(ahead, avgSec, slot, appointmentDate).toISOString());
}

function MockPaymentQr({ seed }: { seed: string }) {
  const cells = Array.from({ length: 121 }, (_, i) => {
    const n = seed.charCodeAt(i % seed.length) + i * 17;
    return n % 3 !== 0;
  });
  return (
    <div className="payment-qr" aria-hidden>
      {cells.map((on, i) => (
        <span key={i} className={on ? "payment-qr-on" : ""} />
      ))}
    </div>
  );
}

function StepBar({ current, includePayment }: { current: Step; includePayment: boolean }) {
  const steps = includePayment ? BASE_STEPS : BASE_STEPS.filter((s) => s.key !== "payment");
  const idx = steps.findIndex((s) => s.key === current);
  return (
    <div className="step-bar">
      {steps.map((s, i) => (
        <div key={s.key} className="step-item">
          {i > 0 && <div className="step-divider" />}
          <div className={`step-circle ${i < idx ? "done" : i === idx ? "active" : "pending"}`}>
            {i < idx ? "✓" : i + 1}
          </div>
          <span className={`step-label ${i === idx ? "active" : "pending"}`}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function RegisterPageContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const prefillHospitalId = searchParams.get("hospital");
  const prefillDoctorId = searchParams.get("doctor");
  const prefillSource = searchParams.get("source");
  const prefillApplied = useRef(false);

  const [step, setStep] = useState<Step>("hospital");
  const [hospitals, setHospitals]= useState<Hospital[]>([]);
  const [selHospital, setSelHospital] = useState<Hospital | null>(null);

  const [phone, setPhone] = useState("");
  const [phoneChecked, setPhoneChecked] = useState(false);
  const [selPatient, setSelPatient] = useState<PatientRecord | null>(null);
  const [patientName, setPatientName] = useState("");
  const [patientAge, setPatientAge] = useState(30);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [visitType, setVisitType]  = useState<"new" | "follow_up">("new");
  const [priority, setPriority] = useState<Priority>("normal");
  const [priorityReason, setPriorityReason] = useState("");
  const [issuedPriority, setIssuedPriority] = useState<Priority>("normal");

  const [serviceType, setServiceType]   = useState<"doctor" | "scan">("doctor");
  const [searchQuery, setSearchQuery]   = useState<string>("");
  const [doctors, setDoctors]           = useState<Doctor[]>([]);
  const [machines, setMachines]         = useState<ScanMachine[]>([]);
  const [selDoctor, setSelDoctor]       = useState<Doctor | null>(null);
  const [selMachine, setSelMachine]     = useState<ScanMachine | null>(null);
  const [selSlot, setSelSlot]           = useState<string>("");
  const [appointmentDate, setAppointmentDate] = useState(localDateString);
  const [availability, setAvailability] = useState<DoctorAvailability | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  const [token, setToken]           = useState<number | null>(null);
  const [ticketRef, setTicketRef]     = useState<string | null>(null);
  const [issuedEta, setIssuedEta]   = useState<Eta | ScanEta | null>(null);
  const [queuePreview, setQueuePreview] = useState<{ ahead: number; live: boolean } | null>(null);
  const [isScan, setIsScan]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("upi");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("skipped");
  const [paymentRef, setPaymentRef] = useState("");
  const [feeAmount, setFeeAmount] = useState(0);

  useEffect(() => {
    api.hospitals().then(setHospitals);
  }, []);

  useEffect(() => {
    if (!selHospital) return;
    api.doctors(selHospital.id).then(setDoctors);
    api.scanMachines(selHospital.id).then(setMachines);
  }, [selHospital]);

  useEffect(() => {
    if (prefillApplied.current || !prefillHospitalId || hospitals.length === 0) return;
    const h = hospitals.find((x) => String(x.id) === prefillHospitalId);
    if (!h) return;
    setSelHospital(h);
    setStep("patient");
    if (prefillDoctorId) setServiceType("doctor");
    prefillApplied.current = true;
  }, [prefillHospitalId, prefillDoctorId, hospitals]);

  useEffect(() => {
    if (!prefillDoctorId || !selHospital || doctors.length === 0) return;
    const d = doctors.find((x) => x.external_id === prefillDoctorId);
    if (!d) return;
    setSelDoctor(d);
    setServiceType("doctor");
    setSelSlot(d.is_live && d.active_slot ? d.active_slot : (d.slots?.[0] || "morning"));
    setStep((s) => (s === "hospital" ? "patient" : s));
  }, [prefillDoctorId, selHospital, doctors]);

  useEffect(() => {
    setPriority((prev) => suggestPriority(patientAge, prev === "emergency" || prev === "urgent" ? prev : undefined));
  }, [patientAge]);

  useEffect(() => {
    if (!selDoctor || serviceType !== "doctor") {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setAvailabilityLoading(true);
    api.doctorAvailability(selDoctor.external_id, appointmentDate)
      .then((data) => {
        if (cancelled) return;
        setAvailability(data);
        const firstOpen = data.slots.find((slot) => slot.available);
        setSelSlot((prev) => {
          if (prev && data.slots.some((slot) => slot.slot === prev && slot.available)) return prev;
          return firstOpen?.slot || data.slots[0]?.slot || selDoctor.slots?.[0] || "morning";
        });
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => { cancelled = true; };
  }, [selDoctor, appointmentDate, serviceType]);

  useEffect(() => {
    if (!selDoctor || serviceType !== "doctor" || !selSlot) {
      setQueuePreview(null);
      return;
    }
    const booked = availability?.slots.find((s) => s.slot === selSlot)?.booked_count ?? 0;
    const isToday = appointmentDate === localDateString();
    const slotLive = selDoctor.is_live && selDoctor.active_slot === selSlot;

    if (!isToday) {
      setQueuePreview({ ahead: booked, live: false });
      return;
    }

    let cancelled = false;
    api.queue(selDoctor.external_id, selSlot, appointmentDate)
      .then((q) => {
        if (cancelled) return;
        setQueuePreview({ ahead: q.length, live: slotLive });
      })
      .catch(() => {
        if (!cancelled) setQueuePreview({ ahead: booked, live: slotLive });
      });
    return () => { cancelled = true; };
  }, [selDoctor, selSlot, appointmentDate, serviceType, availability]);

  const resetPhoneState = () => {
    setPhoneChecked(false);
    setSelPatient(null);
    setPatientName("");
    setPatientAge(30);
  };

  const lookupPhone = async (raw?: string) => {
    if (!selHospital) return;
    const d = digitsOnly(raw ?? phone);
    setError("");
    if (d.length < 10) {
      setError("Enter a 10-digit mobile number");
      resetPhoneState();
      return;
    }
    setLookupLoading(true);
    try {
      const found = await api.patientByPhone(selHospital.id, d);
      setPhoneChecked(true);
      if (found) {
        setSelPatient(found);
        setPatientName(found.name);
        setPatientAge(found.age);
        setVisitType("follow_up");
      } else {
        setSelPatient(null);
        setPatientName("");
        setPatientAge(30);
        setVisitType("new");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      resetPhoneState();
    } finally {
      setLookupLoading(false);
    }
  };

  const canContinuePatient =
    digitsOnly(phone).length === 10 &&
    phoneChecked &&
    patientName.trim().length > 0 &&
    patientAge >= 0 &&
    patientAge <= 120;

  const proceedToPaymentOrConfirm = async () => {
    setLoading(true); setError("");
    try {
      const staffRoles = ["hospital_admin", "hospital_staff", "doctor", "service"];
      if (!user || !staffRoles.includes(user.role)) {
        setError("Hospital staff must sign in to register patients and issue tokens.");
        setLoading(false);
        return;
      }
      const age = patientAge;
      const fee = consultationFee(
        serviceType,
        visitType,
        selDoctor,
        selMachine?.scan_type,
      );
      setFeeAmount(fee);

      if (serviceType === "doctor" && selDoctor) {
        const effective = suggestPriority(age, priority);
        if (effective !== "normal" && !priorityReason.trim() && !(effective === "senior" && age >= 60)) {
          setError("Please enter a reason for this priority");
          setLoading(false);
          return;
        }
        if (needsPaymentStep("doctor", appointmentDate)) {
          setPaymentStatus("pending");
          setStep("payment");
        } else {
          await finalizeAppointmentBooking("skipped");
        }
      } else if (serviceType === "scan" && selMachine) {
        setPaymentStatus("pending");
        setStep("payment");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  };

  const finalizeAppointmentBooking = async (pStatus: PaymentStatus) => {
    setLoading(true); setError("");
    try {
      const name = patientName.trim();
      const age = patientAge;
      const mobile = digitsOnly(phone);
      if (serviceType === "doctor" && selDoctor) {
        const effective = suggestPriority(age, priority);
        const a = await api.createAppointment({
          doctor_external_id: selDoctor.external_id,
          patient_name: name,
          patient_phone: mobile,
          age,
          appointment_type: visitType,
          slot: selSlot || selDoctor.slots?.[0] || "morning",
          appointment_date: appointmentDate,
          priority: effective,
          priority_reason: priorityReason.trim() || (effective === "senior" ? "Age 60+ — senior priority" : undefined),
        });
        setToken(a.token); setTicketRef(a.public_token); setIsScan(false);
        setIssuedPriority((a.priority as Priority) || effective);
        setPaymentRef(mockPaymentRef(a.id));
        try { setIssuedEta(await api.eta(a.id)); } catch { setIssuedEta(null); }
      } else if (serviceType === "scan" && selMachine) {
        const a = await api.createScanAppointment({ machine_external_id: selMachine.external_id, patient_name: name, age });
        setToken(a.token); setTicketRef(a.public_token); setIsScan(true);
        setIssuedPriority("normal");
        setPaymentRef(mockPaymentRef(a.id));
        try { setIssuedEta(await api.scanEta(a.id)); } catch { setIssuedEta(null); }
      }
      setPaymentStatus(pStatus);
      setStep("confirm");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to create appointment"); }
    finally { setLoading(false); }
  };

  const finishPayment = async (status: PaymentStatus) => {
    await finalizeAppointmentBooking(status);
  };

  const reset = () => {
    const keepHospital = Boolean(prefillHospitalId && selHospital);
    setStep(keepHospital ? "patient" : "hospital");
    if (!keepHospital) setSelHospital(null);
    setPhone("");
    resetPhoneState();
    setSelDoctor(null); setSelMachine(null); setSelSlot(""); setToken(null); setTicketRef(null); setIssuedEta(null); setQueuePreview(null); setError("");
    setAppointmentDate(localDateString()); setAvailability(null);
    setVisitType("new"); setServiceType("doctor");
    setPriority("normal"); setPriorityReason(""); setIssuedPriority("normal");
    setPaymentMethod("upi"); setPaymentStatus("skipped"); setPaymentRef(""); setFeeAmount(0);
  };

  const selectedSlotAvailability = availability?.slots.find((slot) => slot.slot === selSlot);
  const canIssueDoctor =
    Boolean(selDoctor && selSlot && selectedSlotAvailability?.available);
  const showPaymentStep = needsPaymentStep(serviceType, appointmentDate);
  const previewAhead = queuePreview?.ahead ?? selectedSlotAvailability?.booked_count ?? 0;
  const previewToken = previewAhead + 1;
  const previewWaitMin = estWaitFromQueue(previewAhead, selDoctor?.avg_duration_sec);
  const previewExpectedBy = fmtEtaTime(
    estExpectedByDate(previewAhead, selDoctor?.avg_duration_sec, selSlot, appointmentDate).toISOString()
  );
  const previewLive = queuePreview?.live ?? false;

  const subtitle = selHospital ? `${selHospital.name} · ${selHospital.city}` : "";

  return (
    <Shell title="Register" subtitle={subtitle}>
      <div className="register-shell">
        <div className="register-panel">
          <StepBar current={step} includePayment={showPaymentStep} />
          <div className="register-body">
            {step === "hospital" && (
              <div>
                <p style={{ color: "var(--muted)", marginBottom: 20, fontSize: 14 }}>Select the hospital to register the patient at.</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
                  {hospitals.map((h) => (
                    <button key={h.id} onClick={() => { setSelHospital(h); setStep("patient"); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--surface-2)", cursor: "pointer", textAlign: "left", transition: "all 0.15s ease" }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.transform = "none";
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15, color: "var(--ink)" }}>{h.name}</div>
                        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{h.city}</div>
                      </div>
                      <span style={{ color: "var(--accent)", fontSize: 20, fontWeight: "600" }}>›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "patient" && (
              <div>
                {selDoctor && (
                  <div style={{ marginBottom: 20, padding: "14px 18px", background: "var(--accent-light)", borderRadius: "var(--radius-sm)", fontSize: 14, color: "var(--accent-dark)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      Registering for <strong>{selDoctor.name}</strong> · {selDoctor.department}
                      {selHospital && <span style={{ color: "var(--muted)" }}> at {selHospital.name}</span>}
                    </div>
                    <span className="badge badge-live" style={{ fontSize: 11 }}>Active Doctor</span>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24, alignItems: "start" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, background: "var(--surface-2)", padding: 20, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                    <h3 style={{ fontSize: 15, fontWeight: 650, margin: 0, color: "var(--ink)" }}>1. Patient Information</h3>
                    <div>
                      <label className="input-label">Mobile number</label>
                      <div style={{ position: "relative", marginTop: 4 }}>
                        <input
                          className="input"
                          inputMode="tel"
                          placeholder="10-digit mobile"
                          value={phone}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPhone(val);
                            const clean = digitsOnly(val);
                            if (clean.length === 10) {
                              lookupPhone(val);
                            } else if (phoneChecked) {
                              resetPhoneState();
                            }
                          }}
                        />
                        {lookupLoading && (
                          <div style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--accent)", fontWeight: 500 }}>
                            Checking…
                          </div>
                        )}
                      </div>
                      {phoneChecked && selPatient && (
                        <p style={{ fontSize: 12, color: "var(--ok)", marginTop: 6, fontWeight: 500 }}>✓ Found in database — details auto-filled</p>
                      )}
                      {phoneChecked && !selPatient && (
                        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>New number — please enter details below</p>
                      )}
                    </div>

                    {phoneChecked && (
                      <>
                        <div>
                          <label className="input-label">Full name</label>
                          <input
                            className="input"
                            value={patientName}
                            onChange={(e) => setPatientName(e.target.value)}
                            placeholder="e.g. Rohan Mehta"
                            autoFocus={!selPatient}
                          />
                        </div>
                        <div>
                          <label className="input-label">Age</label>
                          <input
                            type="number"
                            className="input"
                            value={patientAge}
                            onChange={(e) => setPatientAge(Number(e.target.value))}
                            style={{ maxWidth: 140 }}
                            min={0}
                            max={120}
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <label className="input-label">Visit type</label>
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        {(["new", "follow_up"] as const).map((v) => (
                          <button key={v} className={`tab-btn ${visitType === v ? "active" : ""}`} onClick={() => setVisitType(v)} style={{ flex: 1, justifyContent: "center" }}>
                            {v === "new" ? "New visit" : "Follow-up"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 16, background: "var(--surface-2)", padding: 20, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 650, margin: 0, color: "var(--ink)" }}>2. Triage & Priority</h3>
                      <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 14px" }}>
                        Emergency → Senior (60+) → Urgent → Normal. Higher priority jumps queue position.
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {(["normal", "urgent", "senior", "emergency"] as Priority[]).map((p) => {
                          const meta = PRIORITY_META[p];
                          const selected = priority === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setPriority(p)}
                              style={{
                                textAlign: "left",
                                padding: "12px 14px",
                                borderRadius: 10,
                                border: `1.5px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                                background: selected ? "var(--accent-light)" : "var(--surface)",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span className={`badge ${meta.badge}`}>{meta.label}</span>
                              </div>
                              <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{meta.hint}</div>
                            </button>
                          );
                        })}
                      </div>
                      {patientAge >= 60 && priority === "senior" && (
                        <p style={{ fontSize: 12, color: "var(--accent-dark)", marginTop: 10, fontWeight: 500 }}>Auto-selected: patient is 60+ (Senior Citizen)</p>
                      )}
                      {priority !== "normal" && (
                        <div style={{ marginTop: 14 }}>
                          <label className="input-label">Reason for Priority (logged for audit)</label>
                          <input
                            className="input"
                            value={priorityReason}
                            onChange={(e) => setPriorityReason(e.target.value)}
                            placeholder={
                              priority === "emergency"
                                ? "e.g. Chest pain, acute distress"
                                : priority === "urgent"
                                  ? "e.g. High fever, severe pain"
                                  : "e.g. Age 60+ / mobility assistance"
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {error && <p style={{ color: "var(--err)", fontSize: 13, marginTop: 16, background: "var(--err-light)", padding: "10px 14px", borderRadius: 8 }}>{error}</p>}

                <div style={{ display: "flex", gap: 12, marginTop: 28, justifyContent: "flex-end" }}>
                  {prefillDoctorId ? (
                    <Link href="/reception" className="btn btn-ghost">← Reception Board</Link>
                  ) : prefillHospitalId ? (
                    <Link href={prefillSource === "patient" ? "/patient-portal" : "/reception"} className="btn btn-ghost">
                      ← {prefillSource === "patient" ? "My care" : "Reception Board"}
                    </Link>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => setStep("hospital")}>← Back to Hospitals</button>
                  )}
                  <button className="btn btn-primary" style={{ minWidth: 160 }} disabled={!canContinuePatient} onClick={() => setStep("service")}>
                    Continue to Service →
                  </button>
                </div>
              </div>
            )}

            {step === "service" && (
              <div>
                <div style={{ marginBottom: 20, padding: "12px 18px", background: "var(--surface-2)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    Patient: <strong>{patientName}</strong>, Age {patientAge} · Mobile: {digitsOnly(phone)} · <span className="badge badge-off">{visitType === "new" ? "New visit" : "Follow-up"}</span>
                  </div>
                  {priority !== "normal" && (
                    <span className={`badge ${PRIORITY_META[priority].badge}`}>{PRIORITY_META[priority].label} Priority</span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                  <button className={`tab-btn ${serviceType === "doctor" ? "active" : ""}`} onClick={() => setServiceType("doctor")} style={{ fontSize: 14, padding: "10px 18px" }}>🩺 Doctor / OPD</button>
                  <button className={`tab-btn ${serviceType === "scan" ? "active" : ""}`} onClick={() => setServiceType("scan")} style={{ fontSize: 14, padding: "10px 18px" }}>🔬 Scan / Radiology</button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24, alignItems: "start" }}>
                  <div>
                    {serviceType === "doctor" && (
                      <div style={{ marginBottom: 16 }}>
                        <label className="input-label">Appointment date</label>
                        <input
                          type="date"
                          className="input"
                          value={appointmentDate}
                          min={localDateString()}
                          max={localDateString(30)}
                          onChange={(e) => setAppointmentDate(e.target.value)}
                          style={{ maxWidth: 240, marginTop: 4 }}
                        />
                        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                          Book up to 30 days ahead. Schedules update based on availability.
                        </p>
                      </div>
                    )}

                    {/* Search Bar */}
                    <div style={{ marginBottom: 14 }}>
                      <input
                        className="input"
                        placeholder={serviceType === "doctor" ? "🔍 Search doctor by name or department..." : "🔍 Search machine or scan type..."}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ fontSize: 13, padding: "8px 14px" }}
                      />
                    </div>

                    <div style={{ maxHeight: 420, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 4 }}>
                      {serviceType === "doctor" ? (
                        doctors
                          .filter((d) => {
                            if (!searchQuery.trim()) return true;
                            const q = searchQuery.toLowerCase();
                            return d.name.toLowerCase().includes(q) || d.department.toLowerCase().includes(q);
                          })
                          .map((d) => (
                            <button key={d.id} onClick={() => {
                              setSelDoctor(d);
                              setSelSlot(d.slots?.[0] || "morning");
                            }}
                              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", border: `1.5px solid ${selDoctor?.id === d.id ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius-sm)", background: selDoctor?.id === d.id ? "var(--accent-light)" : "var(--surface)", cursor: "pointer", textAlign: "left", transition: "all 0.15s ease" }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{d.name}</div>
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{d.department}</div>
                                <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>
                                  {formatSlotsList(d.slots)}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--accent-dark)", marginTop: 4, fontWeight: 600 }}>
                                  ₹{visitType === "follow_up" ? (d.follow_up_fee ?? 300) : (d.consultation_fee ?? 500)}
                                  {visitType === "follow_up" ? " follow-up" : " new visit"}
                                </div>
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <span className={d.is_live ? "badge badge-live" : "badge badge-off"}>{d.is_live ? "Live" : "Offline"}</span>
                                {d.avg_duration_sec && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>avg {Math.round(d.avg_duration_sec / 60)} min</div>}
                              </div>
                            </button>
                          ))
                      ) : (
                        machines
                          .filter((m) => {
                            if (!searchQuery.trim()) return true;
                            const q = searchQuery.toLowerCase();
                            return m.name.toLowerCase().includes(q) || m.scan_type.toLowerCase().includes(q);
                          })
                          .map((m) => (
                            <button key={m.id} onClick={() => setSelMachine(m)}
                              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", border: `1.5px solid ${selMachine?.id === m.id ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius-sm)", background: selMachine?.id === m.id ? "var(--accent-light)" : "var(--surface)", cursor: "pointer", textAlign: "left", transition: "all 0.15s ease" }}>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{m.name}</div>
                                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{SCAN_LABELS[m.scan_type] ?? m.scan_type}</div>
                                <div style={{ fontSize: 12, color: "var(--accent-dark)", marginTop: 4, fontWeight: 600 }}>
                                  {formatInr(SCAN_FEES[m.scan_type] ?? 1000)}
                                </div>
                              </div>
                              <div style={{ textAlign: "right", flexShrink: 0 }}>
                                <span className={m.is_live ? "badge badge-live" : "badge badge-off"}>{m.is_live ? "Live" : "Offline"}</span>
                                {m.avg_duration_sec && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>avg {Math.round(m.avg_duration_sec / 60)} min</div>}
                              </div>
                            </button>
                          ))
                      )}
                    </div>
                  </div>

                  {serviceType === "doctor" && selDoctor && (
                    <div style={{ background: "var(--surface-2)", padding: 20, borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 16 }}>
                      <div>
                        <div className="input-label" style={{ marginBottom: 10, fontSize: 13 }}>
                          Session slot for {selDoctor.name}
                          {availabilityLoading && <span style={{ color: "var(--muted)", fontWeight: 500 }}> · checking availability…</span>}
                        </div>
                        {availability && !availability.works_that_day && (
                          <p style={{ fontSize: 12, color: "var(--err)", marginBottom: 10, background: "var(--err-light)", padding: "8px 12px", borderRadius: 6 }}>
                            Doctor does not work on {formatAppointmentDate(appointmentDate)}.
                          </p>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                          {(selDoctor.slots || ["morning"]).map((s) => {
                            const slotInfo = availability?.slots.find((slot) => slot.slot === s);
                            const disabled = Boolean(slotInfo && !slotInfo.available);
                            return (
                              <button
                                key={s}
                                type="button"
                                className={`tab-btn ${selSlot === s ? "active" : ""}`}
                                disabled={disabled}
                                onClick={() => setSelSlot(s)}
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "flex-start",
                                  padding: "10px 14px",
                                  opacity: disabled ? 0.55 : 1,
                                  textAlign: "left",
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>{slotLabel(s)}</span>
                                <span style={{ fontSize: 11, opacity: 0.8, fontWeight: 400 }}>{slotTime(s)}</span>
                                {slotInfo && (
                                  <span style={{ fontSize: 11, marginTop: 4, color: disabled ? "var(--err)" : "var(--muted)" }}>
                                    {disabled ? slotInfo.reason || "Unavailable" : `${slotInfo.booked_count} booked`}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {selSlot && (
                        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16 }}>
                          <div className="register-estimate-title" style={{ marginBottom: 10 }}>Live Queue Estimate</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div className="register-estimate-stat">
                              <span className="register-estimate-label">Token</span>
                              <span className="register-estimate-value">#{previewToken}</span>
                            </div>
                            <div className="register-estimate-stat">
                              <span className="register-estimate-label">Ahead</span>
                              <span className="register-estimate-value">{previewAhead}</span>
                            </div>
                            <div className="register-estimate-stat register-estimate-stat--highlight">
                              <span className="register-estimate-label">Est. wait</span>
                              <span className="register-estimate-value">
                                {previewAhead > 0 ? `~${previewWaitMin} min` : "< 1 min"}
                              </span>
                            </div>
                            <div className="register-estimate-stat">
                              <span className="register-estimate-label">Expected by</span>
                              <span className="register-estimate-value">{previewExpectedBy || "—"}</span>
                            </div>
                          </div>
                          <p className="register-estimate-note" style={{ marginTop: 10 }}>
                            {previewLive
                              ? `Live ${slotShort(selSlot)} queue`
                              : `~${selDoctor.avg_duration_sec ? Math.round(selDoctor.avg_duration_sec / 60) : 12} min × ${previewAhead} ahead`}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {error && <p style={{ color: "var(--err)", fontSize: 13, marginTop: 16, background: "var(--err-light)", padding: "10px 14px", borderRadius: 8 }}>{error}</p>}

                <div style={{ display: "flex", gap: 12, marginTop: 28, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={() => setStep("patient")}>← Back to Patient</button>
                  <button className="btn btn-primary" style={{ minWidth: 180 }} disabled={loading || (serviceType === "doctor" ? !canIssueDoctor : !selMachine)} onClick={proceedToPaymentOrConfirm}>
                    {loading ? "Booking…" : showPaymentStep ? "Book & Continue →" : "Issue Token →"}
                  </button>
                </div>
              </div>
            )}

            {step === "payment" && (
              <div>
                <div className="payment-token-banner">
                  <span>{token !== null ? "Token reserved" : "Payment step"}</span>
                  <strong>{token !== null ? `#${token}` : "Pending"}</strong>
                </div>

                <div className="payment-summary">
                  <div>
                    <div className="payment-summary-label">Amount due today</div>
                    <div className="payment-summary-amount">{formatInr(feeAmount)}</div>
                  </div>
                  <div className="payment-summary-meta">
                    {patientName} · {isScan ? selMachine?.name : `${selDoctor?.name} · ${slotShort(selSlot)}`}
                  </div>
                </div>

                <div className="payment-method-tabs">
                  <button
                    type="button"
                    className={`tab-btn ${paymentMethod === "upi" ? "active" : ""}`}
                    onClick={() => setPaymentMethod("upi")}
                  >
                    Pay now (UPI)
                  </button>
                  <button
                    type="button"
                    className={`tab-btn ${paymentMethod === "cash" ? "active" : ""}`}
                    onClick={() => setPaymentMethod("cash")}
                  >
                    Pay later (cash)
                  </button>
                </div>

                {paymentMethod === "upi" ? (
                  <div className="payment-panel">
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px" }}>
                      Scan this demo QR with any UPI app. Token is already issued — payment is for billing only.
                    </p>
                    <div className="payment-qr-wrap">
                      <MockPaymentQr seed={paymentRef || ticketRef || String(token)} />
                    </div>
                    <div className="payment-ref">Ref: {paymentRef}</div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%", marginTop: 16 }}
                      onClick={() => finishPayment("paid")}
                    >
                      Payment successful
                    </button>
                  </div>
                ) : (
                  <div className="payment-panel">
                    <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 14px", lineHeight: 1.55 }}>
                      Patient will pay <strong>{formatInr(feeAmount)}</strong> in cash at the reception desk.
                      Token <strong>#{token}</strong> is already active.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%" }}
                      onClick={() => finishPayment("pending")}
                    >
                      Continue with pay-at-desk →
                    </button>
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => { setPaymentStatus("pending"); setStep("confirm"); }}>
                    Skip to token →
                  </button>
                </div>
              </div>
            )}

            {step === "confirm" && token !== null && (
              <div className="token-hero">
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ok)", marginBottom: 4 }}>Token issued</div>
                <div className="token-hero-num">{token}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{patientName || "Patient"}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                  {isScan
                    ? `${selMachine?.name} · ${SCAN_LABELS[selMachine?.scan_type ?? ""] ?? ""}`
                    : `${selDoctor?.name} · ${selDoctor?.department} · ${slotShort(selSlot)} · ${formatAppointmentDate(appointmentDate)}`}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{digitsOnly(phone)}</div>

                {paymentStatus !== "skipped" && feeAmount > 0 && (
                  <div className="payment-status-pill">
                    <span className={`badge ${paymentStatus === "paid" ? "badge-live" : "badge-warn"}`}>
                      {paymentStatus === "paid" ? "Paid via UPI" : "Pay at desk (cash)"}
                    </span>
                    <span>{formatInr(feeAmount)}</span>
                    {paymentStatus === "paid" && paymentRef && (
                      <span style={{ color: "var(--muted)" }}>· {paymentRef}</span>
                    )}
                  </div>
                )}

                {issuedEta && (
                  <div className="register-estimate-card register-estimate-card--inline-stats" style={{ marginTop: 16, textAlign: "left" }}>
                    <div className="register-estimate-title">Your queue position</div>
                    <div className="register-estimate-stat">
                      <span className="register-estimate-label">Token</span>
                      <span className="register-estimate-value">#{issuedEta.token}</span>
                    </div>
                    <div className="register-estimate-stat">
                      <span className="register-estimate-label">Ahead</span>
                      <span className="register-estimate-value">{issuedEta.patients_ahead}</span>
                    </div>
                    <div className="register-estimate-stat register-estimate-stat--highlight">
                      <span className="register-estimate-label">Est. wait</span>
                      <span className="register-estimate-value">
                        {resolvedWaitLabel(
                          issuedEta.patients_ahead,
                          issuedEta.wait_seconds,
                          selDoctor?.avg_duration_sec,
                        )}
                      </span>
                    </div>
                    <div className="register-estimate-stat">
                      <span className="register-estimate-label">By</span>
                      <span className="register-estimate-value">
                        {resolvedExpectedByLabel(
                          issuedEta.patients_ahead,
                          issuedEta.wait_seconds,
                          issuedEta.eta_at,
                          selDoctor?.avg_duration_sec,
                          selSlot,
                          appointmentDate,
                        ) || "—"}
                      </span>
                    </div>
                    {!isScan && (
                      <p className="register-estimate-note">
                        Now serving{" "}
                        <strong>
                          {(issuedEta as Eta).current_token != null
                            ? `#${(issuedEta as Eta).current_token}`
                            : "—"}
                        </strong>
                        {(issuedEta as Eta).doctor_live === false && issuedEta.patients_ahead > 0 && (
                          <span> · Projected until doctor goes live — may shift when session starts.</span>
                        )}
                        {(issuedEta as Eta).doctor_live && issuedEta.patients_ahead === 0 && (
                          <span> · You&apos;re next in line.</span>
                        )}
                      </p>
                    )}
                  </div>
                )}

                <div style={{ marginTop: 10, padding: "10px 14px", background: "var(--accent-light)", borderRadius: 8, fontSize: 12, color: "var(--accent-dark)", textAlign: "left" }}>
                  Confirmation SMS sent to <strong>{digitsOnly(phone)}</strong>.
                  You&apos;ll get another SMS when you&apos;re next in queue.
                </div>
                {!isScan && issuedPriority !== "normal" && (
                  <div style={{ marginTop: 10, display: "inline-flex", justifyContent: "center" }}>
                    <span className={`badge ${PRIORITY_META[issuedPriority].badge}`}>
                      {PRIORITY_META[issuedPriority].label} priority
                    </span>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 6 }}>{selHospital?.name}, {selHospital?.city}</div>

                <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Patient view:</p>
                  {ticketRef && (
                    <Link href={`/my-ticket/${ticketRef}`} style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
                      Open ticket →
                    </Link>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "center" }}>
                  {ticketRef && (
                    <Link href={`/my-ticket/${ticketRef}`} className="btn btn-primary">
                      Patient view
                    </Link>
                  )}
                  <button className="btn btn-secondary" onClick={reset}>New registration</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32 }}>Loading registration…</div>}>
      <RegisterPageContent />
    </Suspense>
  );
}
