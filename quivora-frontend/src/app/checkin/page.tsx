"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, Doctor, Hospital, PatientRecord } from "@/lib/api";
import { slotLabel, slotShort } from "@/lib/slots";

type Step = "phone" | "details" | "doctor" | "done";

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
  const [name, setName] = useState("");
  const [age, setAge] = useState(30);
  const [selDoctor, setSelDoctor] = useState<Doctor | null>(null);
  const [selSlot, setSelSlot] = useState("");
  const [token, setToken] = useState<number | null>(null);
  const [ticketRef, setTicketRef] = useState<string | null>(null);
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
      const found = await api.patientCheckinHint(hospitalRef, d);
      if (found.found) {
        setPatient(null);
        setName(found.name || "");
        setAge(found.age ?? 30);
      } else {
        setPatient(null);
        setName("");
        setAge(30);
      }
      setStep("details");
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
    if (!name.trim()) {
      setError("Enter your name");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.selfCheckin(hospitalRef, {
        phone: digitsOnly(phone),
        doctor_external_id: selDoctor.external_id,
        slot: selSlot || selDoctor.slots?.[0] || "morning",
        name: name.trim(),
        age,
      });
      setPatient(result.patient);
      setToken(result.appointment.token);
      setTicketRef(result.appointment.public_token);
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

        {step === "details" && (
          <>
            <p className="checkin-note">
              {patient ? "We found your profile — confirm details" : "Enter your name to continue"}
            </p>
            <label className="input-label">Full name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus={!patient} />
            <label className="input-label" style={{ marginTop: 12 }}>Age</label>
            <input
              className="input"
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setStep("phone")}>Back</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!name.trim()}
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
              <strong>{name}</strong>
              {digitsOnly(phone) ? ` · ${digitsOnly(phone)}` : ""}
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
              <button className="btn btn-ghost" onClick={() => setStep("details")}>Back</button>
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
            <div style={{ fontWeight: 600, fontSize: 18 }}>{patient?.name || name}</div>
            <div className="muted" style={{ marginTop: 6 }}>
              {selDoctor?.name} · {selDoctor?.department} · {slotShort(selSlot)}
            </div>
            <div className="checkin-note" style={{ marginTop: 10 }}>
              SMS updates will go to {digitsOnly(phone)}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "center" }}>
              {ticketRef && (
                <Link href={`/my-ticket/${ticketRef}`} className="btn btn-primary">
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
                  setSelDoctor(null);
                  setToken(null);
                  setTicketRef(null);
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
