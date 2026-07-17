"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor, Hospital, PatientRecord, ScanMachine } from "@/lib/api";
import { formatSlotsList, slotLabel, slotShort, slotTime } from "@/lib/slots";
import { PRIORITY_META, Priority, suggestPriority } from "@/lib/priority";

const TELEGRAM_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8.02c-.12.56-.46.7-.93.43l-2.57-1.9-1.24 1.19c-.14.14-.26.26-.53.26l.19-2.68 4.84-4.37c.21-.19-.05-.29-.32-.1L7.91 14.9l-2.53-.79c-.55-.17-.56-.55.12-.82l9.86-3.8c.46-.17.86.11.28.71z" fill="#229ED9"/>
  </svg>
);

type Step = "hospital" | "patient" | "service" | "confirm";

const STEPS: { key: Step; label: string }[] = [
  { key: "hospital", label: "Hospital" },
  { key: "patient",  label: "Patient" },
  { key: "service",  label: "Service" },
  { key: "confirm",  label: "Token" },
];

const SCAN_LABELS: Record<string, string> = {
  mri: "MRI", ct: "CT Scan", xray: "X-Ray", ultrasound: "Ultrasound", blood_test: "Blood Test",
};

function StepBar({ current }: { current: Step }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div className="step-bar">
      {STEPS.map((s, i) => (
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
  const prefillHospitalId = searchParams.get("hospital");
  const prefillDoctorId = searchParams.get("doctor");
  const prefillSource = searchParams.get("source");
  const prefillApplied = useRef(false);

  const [step, setStep] = useState<Step>("hospital");
  const [hospitals, setHospitals]= useState<Hospital[]>([]);
  const [selHospital, setSelHospital] = useState<Hospital | null>(null);

  const [searchQ, setSearchQ] = useState("");
  const [results, setResults]  = useState<PatientRecord[]>([]);
  const [selPatient, setSelPatient] = useState<PatientRecord | null>(null);
  const [isNew, setIsNew]          = useState(false);
  const [newName, setNewName]      = useState("");
  const [newAge, setNewAge]        = useState(30);
  const [visitType, setVisitType]  = useState<"new" | "follow_up">("new");
  const [priority, setPriority] = useState<Priority>("normal");
  const [priorityReason, setPriorityReason] = useState("");
  const [issuedPriority, setIssuedPriority] = useState<Priority>("normal");

  const [serviceType, setServiceType]   = useState<"doctor" | "scan">("doctor");
  const [doctors, setDoctors]           = useState<Doctor[]>([]);
  const [machines, setMachines]         = useState<ScanMachine[]>([]);
  const [selDoctor, setSelDoctor]       = useState<Doctor | null>(null);
  const [selMachine, setSelMachine]     = useState<ScanMachine | null>(null);
  const [selSlot, setSelSlot]           = useState<string>("");

  const [token, setToken]           = useState<number | null>(null);
  const [apptId, setApptId]         = useState<number | null>(null);
  const [isScan, setIsScan]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [telegramBot, setTelegramBot] = useState<string | null>(null);

  useEffect(() => {
    api.hospitals().then(setHospitals);
    api.health().then((h) => setTelegramBot(h.telegram_bot_username ?? null));
  }, []);

  useEffect(() => {
    if (!selHospital) return;
    api.doctors(selHospital.id).then(setDoctors);
    api.scanMachines(selHospital.id).then(setMachines);
  }, [selHospital]);

  // Deep-link from reception board: /register?hospital=61&doctor=DOC-003
  useEffect(() => {
    if (prefillApplied.current || !prefillHospitalId || hospitals.length === 0) return;
    const h = hospitals.find((x) => String(x.id) === prefillHospitalId);
    if (!h) return;
    setSelHospital(h);
    setStep("patient");
    if (prefillDoctorId) {
      setServiceType("doctor");
    }
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

  const patientAge = selPatient?.age ?? newAge;

  useEffect(() => {
    setPriority((prev) => suggestPriority(patientAge, prev === "emergency" || prev === "urgent" ? prev : undefined));
  }, [patientAge]);

  const handleSearch = async (q: string) => {
    setSearchQ(q);
    if (!selHospital || q.length < 2) { setResults([]); return; }
    setResults(await api.searchPatients(q, selHospital.id));
  };

  const issueToken = async () => {
    setLoading(true); setError("");
    try {
      const name = (selPatient?.name ?? newName) || "Walk-in";
      const age  = selPatient?.age ?? newAge;
      if (serviceType === "doctor" && selDoctor) {
        const effective = suggestPriority(age, priority);
        if (effective !== "normal" && !priorityReason.trim() && !(effective === "senior" && age >= 60)) {
          setError("Please enter a reason for this priority");
          setLoading(false);
          return;
        }
        const a = await api.createAppointment({
          doctor_external_id: selDoctor.external_id,
          patient_name: name,
          age,
          appointment_type: visitType,
          slot: selSlot || selDoctor.slots?.[0] || "morning",
          priority: effective,
          priority_reason: priorityReason.trim() || (effective === "senior" ? "Age 60+ — senior priority" : undefined),
        });
        setToken(a.token); setApptId(a.id); setIsScan(false);
        setIssuedPriority((a.priority as Priority) || effective);
      } else if (serviceType === "scan" && selMachine) {
        const a = await api.createScanAppointment({ machine_external_id: selMachine.external_id, patient_name: name, age });
        setToken(a.token); setApptId(a.id); setIsScan(true);
        setIssuedPriority("normal");
      }
      setStep("confirm");
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally     { setLoading(false); }
  };

  const reset = () => {
    const keepHospital = Boolean(prefillHospitalId && selHospital);
    setStep(keepHospital ? "patient" : "hospital");
    if (!keepHospital) setSelHospital(null);
    setSelPatient(null); setIsNew(false);
    setNewName(""); setNewAge(30); setSearchQ(""); setResults([]);
    setSelDoctor(null); setSelMachine(null); setSelSlot(""); setToken(null); setApptId(null); setError("");
    setVisitType("new"); setServiceType("doctor");
    setPriority("normal"); setPriorityReason(""); setIssuedPriority("normal");
  };

  const telegramLink = telegramBot && apptId
    ? `https://t.me/${telegramBot}?start=${apptId}`
    : null;

  const subtitle = selHospital ? `${selHospital.name} · ${selHospital.city}` : "";

  return (
    <Shell title="Register Patient" subtitle={subtitle}>
      <div style={{ width: "100%", maxWidth: 960, margin: "0 auto" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <StepBar current={step} />

          <div style={{ padding: 24 }}>
            {/* ── STEP 1: Hospital ─────────────────────── */}
            {step === "hospital" && (
              <div>
                <p style={{ color: "var(--muted)", marginBottom: 16, fontSize: 13 }}>Select the hospital to register the patient at.</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {hospitals.map((h) => (
                    <button key={h.id} onClick={() => { setSelHospital(h); setStep("patient"); }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)", cursor: "pointer", textAlign: "left", transition: "border-color 0.15s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{h.city}</div>
                      </div>
                      <span style={{ color: "var(--accent)", fontSize: 18 }}>›</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── STEP 2: Patient ─────────────────────── */}
            {step === "patient" && (
              <div>
                {selDoctor && (
                  <div style={{ marginBottom: 16, padding: "12px 14px", background: "var(--accent-light)", borderRadius: 10, fontSize: 13, color: "var(--accent-dark)" }}>
                    Registering for <strong>{selDoctor.name}</strong> · {selDoctor.department}
                    {selHospital && <span style={{ color: "var(--muted)" }}> at {selHospital.name}</span>}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                  <button className={`tab-btn ${!isNew ? "active" : ""}`} onClick={() => { setIsNew(false); setSelPatient(null); }}>Returning patient</button>
                  <button className={`tab-btn ${isNew ? "active" : ""}`} onClick={() => { setIsNew(true); setSelPatient(null); setResults([]); }}>New patient</button>
                </div>

                {!isNew ? (
                  <div>
                    <label className="input-label">Search by name</label>
                    <input className="input" placeholder="e.g. Priya Sharma" value={searchQ} onChange={(e) => handleSearch(e.target.value)} />
                    {results.length > 0 && (
                      <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                        {results.map((p) => (
                          <button key={p.id} onClick={() => setSelPatient(p)}
                            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: selPatient?.id === p.id ? "var(--accent-light)" : "var(--surface)", borderBottom: "1px solid var(--border)", cursor: "pointer", textAlign: "left" }}>
                            <div>
                              <span style={{ fontWeight: 500, fontSize: 13 }}>{p.name}</span>
                              <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>Age {p.age}</span>
                            </div>
                            {p.phone && <span style={{ fontSize: 12, color: "var(--muted)" }}>{p.phone}</span>}
                  
                          </button>
                        ))}
                      </div>
                    )}
                    {searchQ.length >= 2 && results.length === 0 && (
                      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>No patient found. Switch to &ldquo;New patient&rdquo;.</p>
                    )}
                    {selPatient && (
                      <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--ok-light)", borderRadius: 8, fontSize: 13 }}>
                        ✓ Selected: <strong>{selPatient.name}</strong>, Age {selPatient.age}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label className="input-label">Full name</label>
                      <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Rohan Mehta" />
                    </div>
                    <div>
                      <label className="input-label">Age</label>
                      <input type="number" className="input" value={newAge} onChange={(e) => setNewAge(Number(e.target.value))} style={{ maxWidth: 120 }} />
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 20 }}>
                  <label className="input-label">Visit type</label>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {(["new", "follow_up"] as const).map((v) => (
                      <button key={v} className={`tab-btn ${visitType === v ? "active" : ""}`} onClick={() => setVisitType(v)}>
                        {v === "new" ? "New visit" : "Follow-up"}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 20 }}>
                  <label className="input-label">Triage priority</label>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>
                    Emergency → Senior (60+) → Urgent → Normal. Higher tiers jump ahead in the queue.
                  </p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
                            background: selected ? "var(--accent-light)" : "var(--surface-2)",
                            cursor: "pointer",
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
                    <p style={{ fontSize: 12, color: "var(--accent-dark)", marginTop: 8 }}>Auto-selected: patient is 60+</p>
                  )}
                  {priority !== "normal" && (
                    <div style={{ marginTop: 12 }}>
                      <label className="input-label">Reason (logged)</label>
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

                <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
                  {prefillDoctorId ? (
                    <Link href="/reception" className="btn btn-ghost">← Board</Link>
                  ) : prefillHospitalId ? (
                    <Link href={prefillSource === "patient" ? "/patient-portal" : "/ops"} className="btn btn-ghost">
                      ← {prefillSource === "patient" ? "My care" : "Dashboard"}
                    </Link>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => setStep("hospital")}>← Back</button>
                  )}
                  <button className="btn btn-primary" style={{ flex: 1 }} disabled={!isNew && !selPatient} onClick={() => setStep("service")}>
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Service ─────────────────────── */}
            {step === "service" && (
              <div>
                <div style={{ marginBottom: 16, padding: "10px 14px", background: "var(--surface-2)", borderRadius: 8, fontSize: 13 }}>
                  Patient: <strong>{(selPatient?.name ?? newName) || "New patient"}</strong>, Age {selPatient?.age ?? newAge} · {visitType === "new" ? "New visit" : "Follow-up"}
                  {selDoctor && serviceType === "doctor" && (
                    <span> · Doctor: <strong>{selDoctor.name}</strong></span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                  <button className={`tab-btn ${serviceType === "doctor" ? "active" : ""}`} onClick={() => setServiceType("doctor")}>🩺 Doctor / OPD</button>
                  <button className={`tab-btn ${serviceType === "scan" ? "active" : ""}`} onClick={() => setServiceType("scan")}>🔬 Scan / Radiology</button>
                </div>

                <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {serviceType === "doctor" ? doctors.map((d) => (
                    <button key={d.id} onClick={() => {
                      setSelDoctor(d);
                      setSelSlot(d.slots?.[0] || "morning");
                    }}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: `1px solid ${selDoctor?.id === d.id ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, background: selDoctor?.id === d.id ? "var(--accent-light)" : "var(--surface-2)", cursor: "pointer", textAlign: "left", transition: "all 0.12s" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{d.department}</div>
                        <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>
                          {formatSlotsList(d.slots)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <span className={d.is_live ? "badge badge-live" : "badge badge-off"}>{d.is_live ? "Live" : "Offline"}</span>
                        {d.avg_duration_sec && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>avg {Math.round(d.avg_duration_sec / 60)} min</div>}
                      </div>
                    </button>
                  )) : machines.map((m) => (
                    <button key={m.id} onClick={() => setSelMachine(m)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", border: `1px solid ${selMachine?.id === m.id ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, background: selMachine?.id === m.id ? "var(--accent-light)" : "var(--surface-2)", cursor: "pointer", textAlign: "left", transition: "all 0.12s" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{m.name}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{SCAN_LABELS[m.scan_type] ?? m.scan_type}</div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <span className={m.is_live ? "badge badge-live" : "badge badge-off"}>{m.is_live ? "Live" : "Offline"}</span>
                        {m.avg_duration_sec && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>avg {Math.round(m.avg_duration_sec / 60)} min</div>}
                      </div>
                    </button>
                  ))}
                </div>

                {serviceType === "doctor" && selDoctor && (
                  <div style={{ marginTop: 16 }}>
                    <div className="input-label" style={{ marginBottom: 8 }}>Session slot</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(selDoctor.slots || ["morning"]).map((s) => (
                        <button key={s} type="button" className={`tab-btn ${selSlot === s ? "active" : ""}`} onClick={() => setSelSlot(s)}
                          style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "8px 14px", minWidth: 140 }}>
                          <span>{slotLabel(s)}</span>
                          <span style={{ fontSize: 11, opacity: 0.75, fontWeight: 400 }}>{slotTime(s)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {error && <p style={{ color: "var(--err)", fontSize: 13, marginTop: 8 }}>{error}</p>}

                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button className="btn btn-ghost" onClick={() => setStep("patient")}>← Back</button>
                  <button className="btn btn-primary" style={{ flex: 1 }} disabled={loading || (serviceType === "doctor" ? !selDoctor || !selSlot : !selMachine)} onClick={issueToken}>
                    {loading ? "Issuing…" : "Issue token →"}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Confirm ─────────────────────── */}
            {step === "confirm" && token !== null && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ok)", marginBottom: 4 }}>Token issued</div>
                <div style={{ fontSize: 96, fontWeight: 800, color: "var(--accent)", lineHeight: 1, letterSpacing: "-0.04em" }}>{token}</div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{(selPatient?.name ?? newName) || "Patient"}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                  {isScan ? `${selMachine?.name} · ${SCAN_LABELS[selMachine?.scan_type ?? ""] ?? ""}` : `${selDoctor?.name} · ${selDoctor?.department} · ${slotShort(selSlot)}`}
                </div>
                {!isScan && issuedPriority !== "normal" && (
                  <div style={{ marginTop: 10, display: "inline-flex", justifyContent: "center" }}>
                    <span className={`badge ${PRIORITY_META[issuedPriority].badge}`}>
                      {PRIORITY_META[issuedPriority].label} priority
                    </span>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 6 }}>{selHospital?.name}, {selHospital?.city}</div>

                <div style={{ marginTop: 12, padding: "12px 16px", background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Patient view link (share with patient):</p>
                  {apptId && (
                    <Link href={`/my-ticket/${apptId}${isScan ? "?scan=1" : ""}`} style={{ fontSize: 13, color: "var(--accent)", fontWeight: 500 }}>
                      /my-ticket/{apptId} {isScan ? "?scan=1" : ""} →
                    </Link>
                  )}
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "center" }}>
                  {apptId && (
                    <Link href={`/my-ticket/${apptId}${isScan ? "?scan=1" : ""}`} className="btn btn-primary">
                      Patient view →
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
