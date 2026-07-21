"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Department, Doctor, Hospital } from "@/lib/api";
import { useRole } from "@/lib/role";
import { slotLabel, slotTime, SLOT_META } from "@/lib/slots";
import { formatWorkDaysList, WEEKDAY_META, WEEKDAYS } from "@/lib/weekdays";

const ALL_SLOTS = ["morning", "afternoon", "evening"];
const DEFAULT_WORK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat"];

function HospitalQrSamples({ hospitalId }: { hospitalId: number }) {
  const [samples, setSamples] = useState<Array<{ name: string; phone: string; age: number }>>([]);
  const [url, setUrl] = useState("");
  useEffect(() => {
    api.hospitalQr(hospitalId).then((q) => {
      setSamples(q.sample_phones || []);
      setUrl(q.checkin_url);
    }).catch(() => {});
  }, [hospitalId]);
  return (
    <>
      {url && (
        <p style={{ fontSize: 12, color: "var(--muted-2)", wordBreak: "break-all", marginBottom: 10 }}>
          {url}
        </p>
      )}
      {samples.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Seeded demo phones
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {samples.slice(0, 5).map((s) => (
              <div key={s.phone} style={{ fontSize: 12, color: "var(--ink)" }}>
                {s.name} · <span style={{ fontFamily: "ui-monospace, monospace" }}>{s.phone}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function HospitalConsolePage() {
  const { id } = useParams() as { id: string };
  const { setMode, setHospitalId, refresh } = useRole();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [msg, setMsg] = useState("");

  const [docName, setDocName] = useState("");
  const [dept, setDept] = useState("");
  const [slots, setSlots] = useState<string[]>(["morning"]);
  const [workDays, setWorkDays] = useState<string[]>(DEFAULT_WORK_DAYS);
  const [consultationFee, setConsultationFee] = useState(500);
  const [followUpFee, setFollowUpFee] = useState(300);
  const [saving, setSaving] = useState(false);

  const [newDept, setNewDept] = useState("");
  const [deptMsg, setDeptMsg] = useState("");
  const [savingDept, setSavingDept] = useState(false);

  const load = useCallback(async () => {
    const h = await api.hospital(id);
    setHospital(h);
    setHospitalId(h.id);
    setMode("hospital");
    const [docs, depts] = await Promise.all([api.doctors(h.id), api.departments(h.id)]);
    setDoctors(docs);
    setDepartments(depts);
    setDept((prev) => {
      if (prev && depts.some((d) => d.name === prev)) return prev;
      return depts[0]?.name || "";
    });
  }, [id, setHospitalId, setMode]);

  useEffect(() => { load().catch((e) => setMsg(String(e))); }, [load]);

  const toggleSlot = (s: string) => {
    setSlots((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const toggleWorkDay = (day: string) => {
    setWorkDays((prev) => {
      const next = prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day];
      return next.length ? next : prev;
    });
  };

  const addDepartment = async () => {
    if (!newDept.trim()) { setDeptMsg("Enter a department name"); return; }
    setSavingDept(true); setDeptMsg("");
    try {
      const created = await api.createDepartment(id, newDept.trim());
      setNewDept("");
      await load();
      setDept(created.name);
      setDeptMsg(`Added ${created.name}`);
    } catch (e) {
      setDeptMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setSavingDept(false);
    }
  };

  const addDoctor = async () => {
    if (!docName.trim() || slots.length === 0) { setMsg("Name and at least one slot required"); return; }
    if (!dept) { setMsg("Add a department first, then select it"); return; }
    setSaving(true); setMsg("");
    try {
      await api.createDoctor(id, {
        name: docName.trim(),
        department: dept,
        slots,
        work_days: workDays,
        is_available: true,
        consultation_fee: consultationFee,
        follow_up_fee: followUpFee,
      });
      setDocName(""); setSlots(["morning"]); setWorkDays(DEFAULT_WORK_DAYS);
      setConsultationFee(500); setFollowUpFee(300);
      await load();
      await refresh();
      setMsg("Doctor enrolled");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const updateSlots = async (d: Doctor, next: string[]) => {
    if (next.length === 0) return;
    await api.updateDoctor(d.external_id, { slots: next });
    await load();
  };

  const updateWorkDays = async (d: Doctor, next: string[]) => {
    if (next.length === 0) return;
    await api.updateDoctor(d.external_id, { work_days: next });
    await load();
  };

  const toggleAvailable = async (d: Doctor) => {
    await api.updateDoctor(d.external_id, { is_available: !d.is_available });
    await load();
  };

  const updateFees = async (d: Doctor, nextConsultation: number, nextFollowUp: number) => {
    await api.updateDoctor(d.external_id, {
      consultation_fee: Math.max(0, nextConsultation),
      follow_up_fee: Math.max(0, nextFollowUp),
    });
    await load();
  };

  const liveCount = doctors.filter((d) => d.is_live).length;
  const availableCount = doctors.filter((d) => d.is_available).length;

  return (
    <Shell title={hospital?.name || "Hospital Console"} subtitle={hospital ? `${hospital.city}${hospital.address ? ` · ${hospital.address}` : ""}` : ""}>
      <div className="page-grid-stats">
        {[
          { label: "Doctors", value: doctors.length },
          { label: "Departments", value: departments.length },
          { label: "Available today", value: availableCount },
          { label: "Live now", value: liveCount },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ fontSize: 28 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {hospital && (
        <div className="card" style={{ marginBottom: 20, overflow: "hidden" }}>
          <div className="card-header">
            <span className="card-title">Self check-in QR</span>
            <div style={{ display: "flex", gap: 8 }}>
              <a className="btn btn-secondary btn-sm" href={api.qrPngUrl(hospital.id)} target="_blank" rel="noreferrer">
                Download PNG
              </a>
              <Link className="btn btn-primary btn-sm" href={`/checkin?hospital=${hospital.id}`} target="_blank">
                Open check-in →
              </Link>
            </div>
          </div>
          <div style={{ padding: 16, display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={api.qrPngUrl(hospital.id)}
              alt="Hospital check-in QR"
              width={160}
              height={160}
              style={{ borderRadius: 12, border: "1px solid var(--border)", background: "#fff" }}
            />
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, lineHeight: 1.5 }}>
                Print this QR at reception. Patients scan → enter mobile → register if new → pick doctor → get token.
              </p>
              <HospitalQrSamples hospitalId={hospital.id} />
            </div>
          </div>
        </div>
      )}

      <div className="page-grid-2">
        {/* Doctors */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-header">
            <span className="card-title">Doctors & sessions</span>
            <Link href="/opd" className="btn btn-secondary btn-sm">OPD Board</Link>
          </div>
          <div>
            {doctors.map((d) => (
              <div key={d.id} style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>{d.name}</span>
                      <span className={d.is_live ? "badge badge-live" : "badge badge-off"}>{d.is_live ? `Live · ${d.active_slot}` : "Offline"}</span>
                      {d.is_on_break && <span className="badge badge-warn">On break</span>}
                      <span className={d.is_available ? "badge badge-live" : "badge badge-off"}>{d.is_available ? "Available" : "Unavailable"}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                      {d.department} · {formatWorkDaysList(d.work_days)}
                      {d.works_today === false && <span style={{ color: "var(--warn)" }}> · off today</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6 }}>
                      Fees: ₹{d.consultation_fee ?? 500} new · ₹{d.follow_up_fee ?? 300} follow-up
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleAvailable(d)}>
                      {d.is_available ? "Mark unavailable" : "Mark available"}
                    </button>
                    <Link href={`/room/${d.external_id}`} className="btn btn-primary btn-sm">Room</Link>
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 320 }}>
                  <label className="input-label" style={{ fontSize: 11 }}>
                    New visit fee (₹)
                    <input
                      type="number"
                      className="input"
                      style={{ marginTop: 4 }}
                      min={0}
                      defaultValue={d.consultation_fee ?? 500}
                      key={`${d.id}-consult-${d.consultation_fee}`}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isFinite(val) || val === d.consultation_fee) return;
                        updateFees(d, val, d.follow_up_fee ?? 300);
                      }}
                    />
                  </label>
                  <label className="input-label" style={{ fontSize: 11 }}>
                    Follow-up fee (₹)
                    <input
                      type="number"
                      className="input"
                      style={{ marginTop: 4 }}
                      min={0}
                      defaultValue={d.follow_up_fee ?? 300}
                      key={`${d.id}-follow-${d.follow_up_fee}`}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (!Number.isFinite(val) || val === d.follow_up_fee) return;
                        updateFees(d, d.consultation_fee ?? 500, val);
                      }}
                    />
                  </label>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Session timings</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {ALL_SLOTS.map((s) => {
                      const on = (d.slots || []).includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            const next = on ? d.slots.filter((x) => x !== s) : [...(d.slots || []), s];
                            updateSlots(d, next);
                          }}
                          style={{
                            padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                            background: on ? "var(--accent-light)" : "var(--surface-2)",
                            color: on ? "var(--accent-dark)" : "var(--muted)",
                            textAlign: "left",
                          }}
                        >
                          <div>{slotLabel(s)}</div>
                          <div style={{ fontWeight: 400, opacity: 0.8 }}>{slotTime(s)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Weekly schedule</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {WEEKDAYS.map((day) => {
                      const on = (d.work_days || DEFAULT_WORK_DAYS).includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const cur = d.work_days?.length ? d.work_days : DEFAULT_WORK_DAYS;
                            const next = on ? cur.filter((x) => x !== day) : [...cur, day];
                            updateWorkDays(d, next);
                          }}
                          style={{
                            padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                            border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                            background: on ? "var(--accent-light)" : "var(--surface-2)",
                            color: on ? "var(--accent-dark)" : "var(--muted)",
                          }}
                        >
                          {WEEKDAY_META[day].short}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            {doctors.length === 0 && (
              <p style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>No doctors yet — enroll one on the right.</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, alignSelf: "start" }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Enroll doctor</div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>Pick a department from your list and set sessions.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="input-label">Full name
                <input className="input" style={{ marginTop: 4 }} value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Dr. …" />
              </label>
              <label className="input-label">Department
                <select
                  className="input"
                  style={{ marginTop: 4 }}
                  value={dept}
                  onChange={(e) => setDept(e.target.value)}
                  disabled={departments.length === 0}
                >
                  {departments.length === 0 ? (
                    <option value="">Add a department first</option>
                  ) : (
                    departments.map((d) => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))
                  )}
                </select>
              </label>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Weekly schedule</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {WEEKDAYS.map((day) => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWorkDay(day)}
                      style={{
                        padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                        border: `1px solid ${workDays.includes(day) ? "var(--accent)" : "var(--border)"}`,
                        background: workDays.includes(day) ? "var(--accent-light)" : "var(--surface-2)",
                        color: workDays.includes(day) ? "var(--accent-dark)" : "var(--muted)",
                      }}
                    >
                      {WEEKDAY_META[day].short}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Consultation fees (₹)</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label className="input-label" style={{ fontSize: 11 }}>
                    New visit
                    <input
                      type="number"
                      className="input"
                      style={{ marginTop: 4 }}
                      min={0}
                      value={consultationFee}
                      onChange={(e) => setConsultationFee(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className="input-label" style={{ fontSize: 11 }}>
                    Follow-up
                    <input
                      type="number"
                      className="input"
                      style={{ marginTop: 4 }}
                      min={0}
                      value={followUpFee}
                      onChange={(e) => setFollowUpFee(Number(e.target.value) || 0)}
                    />
                  </label>
                </div>
              </div>
              <div>
                <div className="input-label" style={{ marginBottom: 6 }}>Available sessions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {ALL_SLOTS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`tab-btn ${slots.includes(s) ? "active" : ""}`}
                      onClick={() => toggleSlot(s)}
                      style={{ justifyContent: "space-between", display: "flex", width: "100%" }}
                    >
                      <span>{SLOT_META[s].label}</span>
                      <span style={{ fontWeight: 400, opacity: 0.8 }}>{SLOT_META[s].time}</span>
                    </button>
                  ))}
                </div>
              </div>
              {msg && <p style={{ fontSize: 12, color: msg.includes("enrolled") || msg.includes("Doctor") ? "var(--ok)" : "var(--err)" }}>{msg}</p>}
              <button className="btn btn-primary" disabled={saving || !dept} onClick={addDoctor}>
                {saving ? "Saving…" : "Add doctor"}
              </button>
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Quick links</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Link href={`/register?hospital=${id}&source=hospital`} className="btn btn-secondary btn-sm">Register patient →</Link>
                <Link href="/opd" className="btn btn-secondary btn-sm">OPD live board →</Link>
                <Link href="/scans" className="btn btn-secondary btn-sm">Scan queues →</Link>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Add department</div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              Create departments for this hospital — they appear in the enroll dropdown.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="input-label">Department name
                <input
                  className="input"
                  style={{ marginTop: 4 }}
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  placeholder="e.g. Cardiology"
                  onKeyDown={(e) => { if (e.key === "Enter") addDepartment(); }}
                />
              </label>
              {deptMsg && (
                <p style={{ fontSize: 12, color: deptMsg.startsWith("Added") ? "var(--ok)" : "var(--err)" }}>{deptMsg}</p>
              )}
              <button className="btn btn-primary" disabled={savingDept} onClick={addDepartment}>
                {savingDept ? "Saving…" : "Add department"}
              </button>
              {departments.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div className="input-label" style={{ marginBottom: 8 }}>Current departments ({departments.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {departments.map((d) => (
                      <div
                        key={d.id}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-2)",
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        {d.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
