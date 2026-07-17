"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, OpdSummary } from "@/lib/api";
import { useRole } from "@/lib/role";

export default function OperationsDashboardPage() {
  const { mode, hospital, hospitalId, setMode } = useRole();
  const [health, setHealth] = useState<{ status: string; postgres: boolean; redis: boolean } | null>(null);
  const [summary, setSummary] = useState<OpdSummary | null>(null);
  const [trained, setTrained] = useState(false);
  const [error, setError] = useState("");
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    try {
      const [h, sum, stats] = await Promise.all([api.health(), api.opdSummary(), api.trainStats()]);
      setHealth(h); setSummary(sum); setTrained(stats.trained); setError("");
    } catch { setError("API unreachable"); }
  };

  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  const stats = [
    { label: "Doctors Live", value: summary ? `${summary.live_doctors}/${summary.total_doctors}` : "—", ok: (summary?.live_doctors ?? 0) > 0, hint: "Go live from room tablet" },
    { label: "In Queue", value: summary?.patients_in_queue ?? "—", ok: false, hint: "Across all active doctors" },
    { label: "Consultations Today", value: summary?.consultations_today ?? "—", ok: false, hint: "Live samples recorded" },
    { label: "Training Samples", value: summary?.total_samples ?? "—", ok: trained, hint: trained ? "Baseline ready ✓" : "Need ≥100 / doctor" },
  ];

  return (
    <Shell title="Operations Dashboard" subtitle={hospital ? hospital.name : undefined}>
      <div className="status-bar">
        {[
          { label: "API", ok: health?.status === "ok" },
          { label: "Postgres", ok: health?.postgres },
          { label: "Redis", ok: health?.redis },
        ].map((s) => (
          <div key={s.label} className="status-item">
            <span className={s.ok ? "dot-live" : "dot-off"} />
            <span className="status-item-label">{s.label}</span>
            <span className={`status-item-value ${s.ok ? "ok" : ""}`}>{s.ok == null ? "…" : s.ok ? "connected" : "down"}</span>
          </div>
        ))}
        {error && <span style={{ color: "var(--err)", fontSize: 12, marginLeft: "auto" }}>{error}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" disabled={seeding} onClick={async () => { setSeeding(true); try { await api.seed(); await load(); } catch { setError("Seed failed"); } finally { setSeeding(false); } }}>
            {seeding ? "Seeding…" : "Re-seed"}
          </button>
          <Link href="/training" className="btn btn-primary btn-sm">Training</Link>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, marginBottom: 28 }}>
        {[
          { mode: "admin" as const, title: "Platform Admin", desc: "Manage hospitals across the network", href: "/admin", color: "#7c3aed" },
          { mode: "hospital" as const, title: "Hospital Admin", desc: "Doctors, departments, sessions", href: hospitalId ? `/hospital/${hospitalId}` : "/hospital", color: "var(--accent)" },
          { mode: "patient" as const, title: "Patient", desc: "Book visits and track your queue", href: "/patient-portal", color: "#0284c7" },
        ].map((r) => (
          <Link key={r.mode} href={r.href} onClick={() => setMode(r.mode)} className={`role-card ${mode === r.mode ? "active" : ""}`}>
            <div className="role-card-dot" style={{ background: r.color }} />
            <div className="role-card-title">{r.title}</div>
            <p className="role-card-desc">{r.desc}</p>
          </Link>
        ))}
      </div>

      <div className="page-grid-stats">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={{ color: s.ok ? "var(--ok)" : "var(--ink)", fontSize: 28 }}>{s.value}</div>
            <div className="stat-sub">{s.hint}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, width: "100%" }}>
        <div className="card">
          <div className="card-header"><span className="card-title">Hospital desk</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { href: hospitalId ? `/hospital/${hospitalId}` : "/hospital", icon: "⌂", label: "Hospital console", desc: "Doctors, slots & availability", onClick: () => { setMode("hospital"); } },
              { href: "/insights", icon: "📊", label: "Insights", desc: "Pulse, recommendations, doctor & machine intelligence" },
              { href: "/reception", icon: "📋", label: "Today's Board", desc: "Live overview of all doctors and queues" },
              { href: "/register", icon: "✚", label: "Register / book patient", desc: "Search returning patients or create new" },
              { href: "/opd", icon: "🩺", label: "OPD live board", desc: "Queue depths and ETAs by doctor" },
              { href: "/scans", icon: "🔬", label: "Scan queue board", desc: "MRI, CT, X-Ray, Ultrasound machines" },
            ].map((item) => (
              <Link key={item.href + item.label} href={item.href} onClick={item.onClick} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                <span style={{ fontSize: 18, marginTop: 1 }}>{item.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)" }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{item.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">Network overview</span></div>
          <div style={{ padding: "12px 20px" }}>
            {[
              ["Hospitals", "Manage from Platform Admin"],
              ["Doctors", "Enroll & set timings per hospital"],
              ["Patients", "Book via register or patient portal"],
              ["Training data", trained ? `${summary?.total_samples?.toLocaleString()} samples ✓` : "Run training first"],
            ].map(([key, value]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span style={{ color: "var(--muted)" }}>{key}</span>
                <span style={{ fontWeight: 500, color: "var(--ink-2)" }}>{value}</span>
              </div>
            ))}
            <div style={{ paddingTop: 12, display: "flex", gap: 8 }}>
              <Link href="/admin" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setMode("admin")}>Admin →</Link>
              <Link href="/training" className="btn btn-primary" style={{ flex: 1 }}>{trained ? "Re-train →" : "Train →"}</Link>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
