"use client";

import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor, QueueItem, ScanMachine, ScanQueueItem } from "@/lib/api";
import { useRole } from "@/lib/role";
import Link from "next/link";

interface DoctorMetrics {
  doc: Doctor;
  queue: QueueItem[];
  avgMin: number;
  sampleCount: number;
  efficiencyIndex: number;
  projectedDelayMin: number;
  delayStatus: "on_schedule" | "moderate_delay" | "high_delay";
  queueLen: number;
  totalClearanceMin: number;
  estConsultsToday: number;
}

interface ScanMetrics {
  machine: ScanMachine;
  queue: ScanQueueItem[];
  avgMin: number;
  sampleCount: number;
  efficiencyIndex: number;
  projectedDelayMin: number;
  delayStatus: "on_schedule" | "moderate_delay" | "high_delay";
  queueLen: number;
  totalClearanceMin: number;
  estScansToday: number;
}

const SCAN_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  mri: { label: "MRI", color: "#7c3aed" },
  ct: { label: "CT Scan", color: "#0369a1" },
  xray: { label: "X-Ray", color: "#0f766e" },
  ultrasound: { label: "Ultrasound", color: "#b45309" },
  blood_test: { label: "Blood Test", color: "#be185d" },
};

export default function AnalyticsPage() {
  const { hospital, hospitalId, setMode } = useRole();
  const [activeTab, setActiveTab] = useState<"doctors" | "scans">("doctors");

  // Doctors State
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [docQueues, setDocQueues] = useState<Record<string, QueueItem[]>>({});

  // Scans State
  const [machines, setMachines] = useState<ScanMachine[]>([]);
  const [scanQueues, setScanQueues] = useState<Record<string, ScanQueueItem[]>>({});

  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("all");

  const selectedId = hospitalId || hospital?.id || null;

  useEffect(() => {
    setMode("hospital");
  }, [setMode]);

  useEffect(() => {
    if (!selectedId) {
      setDoctors([]);
      setDocQueues({});
      setMachines([]);
      setScanQueues({});
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      try {
        setLoading(true);

        // Load Doctors & Queues
        const docs = await api.doctors(selectedId);
        const docQueueEntries = await Promise.all(
          docs.map(async (d) => {
            try {
              const q = await api.queue(d.external_id);
              return [d.external_id, q] as const;
            } catch {
              return [d.external_id, []] as const;
            }
          })
        );

        // Load Scan Machines & Queues
        const ms = await api.scanMachines(selectedId);
        const scanQueueEntries = await Promise.all(
          ms.map(async (m) => {
            try {
              const q = await api.scanQueue(m.external_id);
              return [m.external_id, q] as const;
            } catch {
              return [m.external_id, []] as const;
            }
          })
        );

        if (!cancelled) {
          setDoctors(docs);
          setDocQueues(Object.fromEntries(docQueueEntries));
          setMachines(ms);
          setScanQueues(Object.fromEntries(scanQueueEntries));
        }
      } catch (err) {
        console.error("Failed to load analytics data", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  // Compute metrics for Doctors
  const doctorMetricsList = useMemo<DoctorMetrics[]>(() => {
    return doctors.map((doc) => {
      const q = docQueues[doc.external_id] || [];
      const queueLen = q.length;
      const avgMin = doc.avg_duration_sec ? doc.avg_duration_sec / 60 : 15;
      const sampleCount = doc.sample_count || 0;

      const totalClearanceMin = Math.round(queueLen * avgMin);
      const delayBufferMin = doc.delay_buffer_sec ? Math.round(doc.delay_buffer_sec / 60) : 0;
      const projectedDelayMin = delayBufferMin + (queueLen > 6 ? Math.round((queueLen - 6) * 3) : 0);
      const delayStatus = projectedDelayMin > 25 ? "high_delay" : projectedDelayMin > 10 ? "moderate_delay" : "on_schedule";

      const paceRatio = 15 / (avgMin || 15);
      const efficiencyIndex = Math.min(99, Math.max(60, Math.round(paceRatio * 88 - projectedDelayMin * 0.4)));
      const estConsultsToday = sampleCount > 0 ? Math.round(sampleCount / 10) + queueLen + 12 : queueLen + 15;

      return {
        doc,
        queue: q,
        avgMin,
        sampleCount,
        efficiencyIndex,
        projectedDelayMin,
        delayStatus,
        queueLen,
        totalClearanceMin,
        estConsultsToday,
      };
    });
  }, [doctors, docQueues]);

  // Compute metrics for Scans
  const scanMetricsList = useMemo<ScanMetrics[]>(() => {
    return machines.map((machine) => {
      const q = scanQueues[machine.external_id] || [];
      const queueLen = q.length;
      const avgMin = machine.avg_duration_sec ? machine.avg_duration_sec / 60 : 20;
      const sampleCount = machine.sample_count || 0;

      const totalClearanceMin = Math.round(queueLen * avgMin);
      const projectedDelayMin = queueLen > 5 ? Math.round((queueLen - 5) * 4) : 0;
      const delayStatus = projectedDelayMin > 30 ? "high_delay" : projectedDelayMin > 12 ? "moderate_delay" : "on_schedule";

      const paceRatio = 20 / (avgMin || 20);
      const efficiencyIndex = Math.min(99, Math.max(60, Math.round(paceRatio * 90 - projectedDelayMin * 0.5)));
      const estScansToday = sampleCount > 0 ? Math.round(sampleCount / 8) + queueLen + 8 : queueLen + 10;

      return {
        machine,
        queue: q,
        avgMin,
        sampleCount,
        efficiencyIndex,
        projectedDelayMin,
        delayStatus,
        queueLen,
        totalClearanceMin,
        estScansToday,
      };
    });
  }, [machines, scanQueues]);

  const departments = useMemo(() => {
    const set = new Set<string>();
    doctors.forEach((d) => {
      if (d.department) set.add(d.department);
    });
    return Array.from(set).sort();
  }, [doctors]);

  const scanTypes = useMemo(() => {
    const set = new Set<string>();
    machines.forEach((m) => {
      if (m.scan_type) set.add(m.scan_type);
    });
    return Array.from(set).sort();
  }, [machines]);

  const filteredDoctorMetrics = useMemo(() => {
    return doctorMetricsList.filter((item) => {
      const matchesSearch = item.doc.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.doc.department.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesDept = selectedDept === "all" || item.doc.department === selectedDept;
      return matchesSearch && matchesDept;
    });
  }, [doctorMetricsList, searchTerm, selectedDept]);

  const filteredScanMetrics = useMemo(() => {
    return scanMetricsList.filter((item) => {
      const matchesSearch = item.machine.name.toLowerCase().includes(searchTerm.toLowerCase()) || item.machine.scan_type.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = selectedDept === "all" || item.machine.scan_type === selectedDept;
      return matchesSearch && matchesType;
    });
  }, [scanMetricsList, searchTerm, selectedDept]);

  // Aggregates
  const docStats = useMemo(() => {
    if (doctorMetricsList.length === 0) return { avgEfficiency: 0, totalWaiting: 0, totalDelayed: 0, liveCount: 0 };
    const avgEfficiency = Math.round(doctorMetricsList.reduce((acc, m) => acc + m.efficiencyIndex, 0) / doctorMetricsList.length);
    const totalWaiting = doctorMetricsList.reduce((acc, m) => acc + m.queueLen, 0);
    const totalDelayed = doctorMetricsList.filter((m) => m.delayStatus !== "on_schedule").length;
    const liveCount = doctorMetricsList.filter((m) => m.doc.is_live).length;
    return { avgEfficiency, totalWaiting, totalDelayed, liveCount };
  }, [doctorMetricsList]);

  const scanStats = useMemo(() => {
    if (scanMetricsList.length === 0) return { avgEfficiency: 0, totalWaiting: 0, totalDelayed: 0, liveCount: 0 };
    const avgEfficiency = Math.round(scanMetricsList.reduce((acc, m) => acc + m.efficiencyIndex, 0) / scanMetricsList.length);
    const totalWaiting = scanMetricsList.reduce((acc, m) => acc + m.queueLen, 0);
    const totalDelayed = scanMetricsList.filter((m) => m.delayStatus !== "on_schedule").length;
    const liveCount = scanMetricsList.filter((m) => m.machine.is_live).length;
    return { avgEfficiency, totalWaiting, totalDelayed, liveCount };
  }, [scanMetricsList]);

  return (
    <Shell title="Performance & Queue Analytics" subtitle={hospital ? `${hospital.name} · OPD Clinics & Scan Diagnostics` : "Hospital Performance Analytics"}>
      {/* Navigation Tabs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
        <button
          className={`btn ${activeTab === "doctors" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => {
            setActiveTab("doctors");
            setSelectedDept("all");
            setSearchTerm("");
          }}
          style={{ fontSize: 14 }}
        >
          👨‍⚕️ Doctor Analytics ({doctors.length})
        </button>
        <button
          className={`btn ${activeTab === "scans" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => {
            setActiveTab("scans");
            setSelectedDept("all");
            setSearchTerm("");
          }}
          style={{ fontSize: 14 }}
        >
          🔬 Scan Diagnostics Analytics ({machines.length})
        </button>
      </div>

      {/* Hero Overview */}
      <div className="board-hero" style={{ marginBottom: 20 }}>
        <div className="board-hero-stats">
          {activeTab === "doctors" ? (
            <>
              <div>
                <span className="board-hero-num">{docStats.liveCount}</span>
                <span className="board-hero-label">Live OPD Clinics</span>
              </div>
              <div>
                <span className="board-hero-num" style={{ color: "var(--ok)" }}>{docStats.avgEfficiency}%</span>
                <span className="board-hero-label">Avg Doctor Efficiency</span>
              </div>
              <div>
                <span className="board-hero-num">{docStats.totalWaiting}</span>
                <span className="board-hero-label">Active OPD Queue</span>
              </div>
              <div>
                <span className="board-hero-num" style={{ color: docStats.totalDelayed > 0 ? "var(--warn)" : "var(--ink)" }}>{docStats.totalDelayed}</span>
                <span className="board-hero-label">Delayed Clinics</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <span className="board-hero-num">{scanStats.liveCount}</span>
                <span className="board-hero-label">Live Diagnostic Labs</span>
              </div>
              <div>
                <span className="board-hero-num" style={{ color: "var(--ok)" }}>{scanStats.avgEfficiency}%</span>
                <span className="board-hero-label">Avg Diagnostic Pace</span>
              </div>
              <div>
                <span className="board-hero-num">{scanStats.totalWaiting}</span>
                <span className="board-hero-label">Scan Queue</span>
              </div>
              <div>
                <span className="board-hero-num" style={{ color: scanStats.totalDelayed > 0 ? "var(--warn)" : "var(--ink)" }}>{scanStats.totalDelayed}</span>
                <span className="board-hero-label">Delayed Machines</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12, flex: 1, minWidth: 260 }}>
          <input
            type="text"
            className="input"
            placeholder={activeTab === "doctors" ? "Search doctor or specialty..." : "Search machine or test type..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ maxWidth: 300 }}
          />
          <select
            className="select"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            style={{ maxWidth: 200 }}
          >
            <option value="all">{activeTab === "doctors" ? "All Departments" : "All Test Types"}</option>
            {activeTab === "doctors"
              ? departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))
              : scanTypes.map((type) => (
                  <option key={type} value={type}>
                    {SCAN_TYPE_LABELS[type]?.label || type}
                  </option>
                ))}
          </select>
        </div>

        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          Showing {activeTab === "doctors" ? filteredDoctorMetrics.length : filteredScanMetrics.length} items
        </div>
      </div>

      {/* Content Rendering */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
          Loading performance analytics...
        </div>
      ) : activeTab === "doctors" ? (
        /* Doctor Cards */
        filteredDoctorMetrics.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
            No doctors found.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
            {filteredDoctorMetrics.map(({ doc, queueLen, avgMin, sampleCount, efficiencyIndex, projectedDelayMin, delayStatus, totalClearanceMin, estConsultsToday }) => (
              <div key={doc.id} className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>{doc.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{doc.department}</div>
                  </div>
                  <span className={doc.is_live ? "badge badge-live" : "badge badge-off"}>
                    <span className={doc.is_live ? "dot-live" : "dot-off"} />
                    {doc.is_live ? "Live" : "Offline"}
                  </span>
                </div>

                {/* Progress Bar */}
                <div style={{ background: "var(--surface-2)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, color: "var(--muted)" }}>Efficiency Index</span>
                    <span style={{ fontWeight: 700, color: efficiencyIndex >= 85 ? "var(--ok)" : efficiencyIndex >= 75 ? "var(--ink)" : "var(--warn)" }}>
                      {efficiencyIndex}%
                    </span>
                  </div>
                  <div style={{ width: "100%", height: 8, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${efficiencyIndex}%`,
                        background: efficiencyIndex >= 85 ? "var(--ok)" : efficiencyIndex >= 75 ? "#3b82f6" : "var(--warn)",
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>

                {/* Stats Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                  <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>Avg Consultation</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{Math.round(avgMin)} mins</div>
                    <div style={{ color: "var(--muted-2)", fontSize: 10, marginTop: 2 }}>{sampleCount} samples</div>
                  </div>

                  <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>Active Queue Workload</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{queueLen} waiting</div>
                    <div style={{ color: "var(--muted-2)", fontSize: 10, marginTop: 2 }}>~{totalClearanceMin} min to clear</div>
                  </div>

                  <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>Schedule Status</div>
                    <div style={{ marginTop: 4 }}>
                      <span className={`badge ${delayStatus === "high_delay" ? "badge-emergency" : delayStatus === "moderate_delay" ? "badge-urgent" : "badge-off"}`} style={{ fontSize: 10 }}>
                        {projectedDelayMin > 0 ? `+${projectedDelayMin}m delay` : "On Schedule"}
                      </span>
                    </div>
                  </div>

                  <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ color: "var(--muted)", fontSize: 11 }}>Est. Today Throughput</div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>~{estConsultsToday} consultations</div>
                  </div>
                </div>

                <Link href={`/room/${doc.external_id}`} className="btn btn-secondary btn-sm" style={{ textAlign: "center" }}>
                  Manage Consultation Room →
                </Link>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Scan Diagnostic Cards */
        filteredScanMetrics.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--muted)" }}>
            No scan machines found.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
            {filteredScanMetrics.map(({ machine, queueLen, avgMin, sampleCount, efficiencyIndex, projectedDelayMin, delayStatus, totalClearanceMin, estScansToday }) => {
              const st = SCAN_TYPE_LABELS[machine.scan_type] || { label: machine.scan_type, color: "var(--muted)" };

              return (
                <div key={machine.id} className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>{machine.name}</div>
                      <div style={{ marginTop: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, background: st.color + "18", color: st.color }}>
                          {st.label}
                        </span>
                      </div>
                    </div>
                    <span className={machine.is_live ? "badge badge-live" : "badge badge-off"}>
                      <span className={machine.is_live ? "dot-live" : "dot-off"} />
                      {machine.is_live ? "Live" : "Offline"}
                    </span>
                  </div>

                  {/* Diagnostic Index Progress Bar */}
                  <div style={{ background: "var(--surface-2)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, color: "var(--muted)" }}>Diagnostic Efficiency</span>
                      <span style={{ fontWeight: 700, color: efficiencyIndex >= 85 ? "var(--ok)" : efficiencyIndex >= 75 ? "var(--ink)" : "var(--warn)" }}>
                        {efficiencyIndex}%
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 8, background: "var(--border)", borderRadius: 999, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${efficiencyIndex}%`,
                          background: st.color,
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12 }}>
                    <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Avg Scan Time</div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{Math.round(avgMin)} mins</div>
                      <div style={{ color: "var(--muted-2)", fontSize: 10, marginTop: 2 }}>{sampleCount} historical scans</div>
                    </div>

                    <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Diagnostic Queue</div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{queueLen} waiting</div>
                      <div style={{ color: "var(--muted-2)", fontSize: 10, marginTop: 2 }}>~{totalClearanceMin} min clearance</div>
                    </div>

                    <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Operational Delay</div>
                      <div style={{ marginTop: 4 }}>
                        <span className={`badge ${delayStatus === "high_delay" ? "badge-emergency" : delayStatus === "moderate_delay" ? "badge-urgent" : "badge-off"}`} style={{ fontSize: 10 }}>
                          {projectedDelayMin > 0 ? `+${projectedDelayMin}m delay` : "On Schedule"}
                        </span>
                      </div>
                    </div>

                    <div style={{ padding: 8, background: "var(--surface-1)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>Est. Daily Scans</div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>~{estScansToday} completed</div>
                    </div>
                  </div>

                  <Link href={`/scans/${machine.external_id}`} className="btn btn-secondary btn-sm" style={{ textAlign: "center" }}>
                    Manage Scan Room →
                  </Link>
                </div>
              );
            })}
          </div>
        )
      )}
    </Shell>
  );
}
