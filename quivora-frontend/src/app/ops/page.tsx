"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, OpdSummary } from "@/lib/api";
import { useRole } from "@/lib/role";

export default function OperationsDashboardPage() {
  const { hospital, hospitalId } = useRole();
  const [health, setHealth] = useState<{ status: string; postgres: boolean; redis: boolean } | null>(null);
  const [summary, setSummary] = useState<OpdSummary | null>(null);
  const [trained, setTrained] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [h, sum] = await Promise.all([api.health(), api.opdSummary(hospitalId || undefined)]);
      setHealth(h);
      setSummary(sum);
      setTrained(sum.total_doctors > 0 && sum.total_samples >= sum.total_doctors * 100);
      setError("");
    } catch { setError("API unreachable"); }
  }, [hospitalId]);

  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

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
      </div>

      <Link
        href={hospitalId ? `/register?hospital=${hospitalId}&source=hospital` : "/register"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 20,
          width: "100%",
          marginBottom: 20,
          padding: "22px 24px",
          borderRadius: 16,
          color: "#fff",
          background: "linear-gradient(135deg, var(--accent-dark), var(--accent))",
          boxShadow: "0 12px 30px rgba(13, 148, 136, 0.22)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: 14,
              background: "rgba(255,255,255,.16)",
              fontSize: 28,
            }}
          >
            ✚
          </span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.72 }}>
              Primary action
            </div>
            <div style={{ marginTop: 3, fontSize: 20, fontWeight: 750 }}>Register / book patient</div>
            <div style={{ marginTop: 3, fontSize: 13, opacity: 0.82 }}>
              Search a returning patient or create a new registration at {hospital?.name || "this hospital"}.
            </div>
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 24 }}>→</span>
      </Link>

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
          <div className="card-header"><span className="card-title">Live operations</span></div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { href: "/reception", icon: "📋", label: "Doctor rooms & availability", desc: "Open consultation rooms, check doctor status and register patients" },
              { href: "/opd", icon: "🩺", label: "Patient queues & ETAs", desc: "Track waiting tokens, priorities and predicted consultation times" },
            ].map((item) => (
              <Link key={item.href} href={item.href} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
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
          </div>
        </div>
      </div>
    </Shell>
  );
}
