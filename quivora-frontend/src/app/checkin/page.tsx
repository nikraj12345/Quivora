"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, Doctor, Hospital, PatientRecord } from "@/lib/api";
import { slotLabel, slotShort } from "@/lib/slots";

type Step = "phone" | "register" | "doctor" | "done";

function digitsOnly(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function CheckinInner() {
  const params = useSearchParams();
  const hospitalRef = params.get("hospital") || "";

  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [samples, setSamples] = useState<Array<{ name: string; phone: string; age: number }>>([]);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [name, setName] = useState("");
  const [age, setAge] = useState(30);
  const [address, setAddress] = useState("");
  const [gender, setGender] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [selDoctor, setSelDoctor] = useState<Doctor | null>(null);
  const [selSlot, setSelSlot] = useState("");
  const [token, setToken] = useState<number | null>(null);
  const [apptId, setApptId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hospitalRef) return;
    (async () => {
      try {
        const [h, qr] = await Promise.all([api.hospital(hospitalRef), api.hospitalQr(hospitalRef)]);
        setHospital(h);
        setSamples(qr.sample_phones || []);
        const docs = await api.doctors(h.id);
        setDoctors(docs);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load hospital");
      }
    })();
  }, [hospitalRef]);

  const departments = useMemo(() => {
    const map = new Map<string, Doctor[]>();
    for (const d of doctors) {
      const list = map.get(d.department) || [];
      list.push(d);
      map.set(d.department, list);
    }
    return Array.from(map.entries());
  }, [doctors]);

  const lookupPhone = async () => {
    setError("");
    const d = digitsOnly(phone);
    if (d.length < 10) {
      setError("Enter a 10-digit mobile number");
      return;
    }
    setLoading(true);
    try {
      const found = await api.patientByPhone(hospitalRef, d);
      if (found) {
        setPatient(found);
        setIsNew(false);
        setName(found.name);
        setAge(found.age);
        setStep("doctor");
      } else {
        setPatient(null);
        setIsNew(true);
        setName("");
        setAge(30);
        setAddress("");
        setGender("");
        setEmergencyContact("");
        setStep("register");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  };

  const book = async () => {
    if (!selDoctor) {
      setError("Pick a doctor");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.selfCheckin(hospitalRef, {
        phone: digitsOnly(phone),
        doctor_external_id: selDoctor.external_id,
        slot: selSlot || selDoctor.slots?.[0] || "morning",
        name: isNew ? name : undefined,
        age: isNew ? age : undefined,
        address: isNew ? address : undefined,
        gender: isNew ? gender : undefined,
        emergency_contact: isNew ? emergencyContact : undefined,
      });
      setPatient(result.patient);
      setToken(result.appointment.token);
      setApptId(result.appointment.id);
      setIsNew(result.is_new_patient);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setLoading(false);
    }
  };

  if (!hospitalRef) {
    return (
      <main className="checkin-page">
        <div className="checkin-card">
          <h1>Scan a hospital QR</h1>
          <p>Open this page from the QR code at the hospital entrance.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="checkin-page">
      <div className="checkin-card">
        <div className="checkin-brand">Quivora</div>
        <h1>{hospital?.name || "Hospital"}</h1>
        <p className="checkin-sub">{hospital?.city ? `${hospital.city} · self check-in` : "Self check-in"}</p>

        {step === "phone" && (
          <>
            <label className="input-label">Mobile number</label>
            <input
              className="input"
              inputMode="tel"
              placeholder="10-digit mobile"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoFocus
            />
            <button className="btn btn-primary" style={{ width: "100%", marginTop: 16 }} disabled={loading} onClick={lookupPhone}>
              {loading ? "Checking…" : "Continue"}
            </button>
            {samples.length > 0 && (
              <div className="checkin-samples">
                <div className="checkin-samples-title">Demo numbers (seeded)</div>
                {samples.slice(0, 5).map((s) => (
                  <button
                    key={s.phone}
                    type="button"
                    className="checkin-sample"
                    onClick={() => setPhone(s.phone)}
                  >
                    <strong>{s.name}</strong>
                    <span>{s.phone}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === "register" && (
          <>
            <p className="checkin-note">New patient — quick registration</p>
            <label className="input-label">Full name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            <label className="input-label" style={{ marginTop: 12 }}>Age</label>
            <input
              className="input"
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
            />
            <label className="input-label" style={{ marginTop: 12 }}>Gender</label>
            <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Select gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>
            <label className="input-label" style={{ marginTop: 12 }}>Address</label>
            <textarea
              className="input"
              rows={3}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="House / street, area, city"
              style={{ resize: "vertical" }}
            />
            <label className="input-label" style={{ marginTop: 12 }}>Emergency contact</label>
            <input
              className="input"
              inputMode="tel"
              value={emergencyContact}
              onChange={(e) => setEmergencyContact(e.target.value)}
              placeholder="10-digit mobile number"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setStep("phone")}>Back</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={
                  !name.trim() ||
                  !address.trim() ||
                  !gender ||
                  digitsOnly(emergencyContact).length !== 10
                }
                onClick={() => setStep("doctor")}
              >
                Choose doctor →
              </button>
            </div>
          </>
        )}

        {step === "doctor" && (
          <>
            <p className="checkin-note">
              {isNew ? "New" : "Welcome back"}, <strong>{isNew ? name : patient?.name}</strong>
              {!isNew && patient?.phone ? ` · ${patient.phone}` : ""}
            </p>
            <label className="input-label">Doctor</label>
            <div className="checkin-doc-list">
              {departments.map(([dept, docs]) => (
                <div key={dept}>
                  <div className="checkin-dept">{dept}</div>
                  {docs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`checkin-doc ${selDoctor?.id === d.id ? "active" : ""}`}
                      onClick={() => {
                        setSelDoctor(d);
                        setSelSlot(d.is_live && d.active_slot ? d.active_slot : d.slots?.[0] || "morning");
                      }}
                    >
                      <span>{d.name}</span>
                      <span className="muted">{d.slots?.map(slotShort).join(" · ")}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {selDoctor && (selDoctor.slots?.length || 0) > 1 && (
              <div style={{ marginTop: 12 }}>
                <label className="input-label">Slot</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selDoctor.slots.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`tab-btn ${selSlot === s ? "active" : ""}`}
                      onClick={() => setSelSlot(s)}
                    >
                      {slotLabel(s)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setStep(isNew ? "register" : "phone")}>Back</button>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={loading || !selDoctor} onClick={book}>
                {loading ? "Booking…" : "Get token"}
              </button>
            </div>
          </>
        )}

        {step === "done" && token !== null && (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div className="checkin-ok">Token issued</div>
            <div className="checkin-token">{token}</div>
            <div style={{ fontWeight: 600, fontSize: 18 }}>{patient?.name}</div>
            <div className="muted" style={{ marginTop: 6 }}>
              {selDoctor?.name} · {selDoctor?.department} · {slotShort(selSlot)}
            </div>
            {isNew && <div className="checkin-note" style={{ marginTop: 10 }}>Profile saved with this mobile number</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "center" }}>
              {apptId && (
                <Link href={`/my-ticket/${apptId}`} className="btn btn-primary">
                  Track wait →
                </Link>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setStep("phone");
                  setPhone("");
                  setPatient(null);
                  setName("");
                  setAge(30);
                  setAddress("");
                  setGender("");
                  setEmergencyContact("");
                  setSelDoctor(null);
                  setToken(null);
                  setApptId(null);
                  setError("");
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}

        {error && <p style={{ color: "var(--err)", fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
    </main>
  );
}

export default function CheckinPage() {
  return (
    <Suspense fallback={<main className="checkin-page"><div className="checkin-card">Loading…</div></main>}>
      <CheckinInner />
    </Suspense>
  );
}
