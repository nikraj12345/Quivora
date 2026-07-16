"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Hospital } from "@/lib/api";
import { useRole } from "@/lib/role";

export default function AdminPage() {
  const { refresh, setMode, setHospitalId } = useRole();
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const hs = await api.hospitals();
    setHospitals(hs);
  };

  useEffect(() => { load().catch(() => {}); }, []);

  const create = async () => {
    if (!name.trim() || !city.trim()) { setMsg("Name and city are required"); return; }
    setLoading(true); setMsg("");
    try {
      const h = await api.createHospital({ name: name.trim(), city: city.trim(), address, phone: phone || undefined });
      setName(""); setCity(""); setAddress(""); setPhone("");
      await load();
      await refresh();
      setMsg(`Created ${h.name}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (h: Hospital) => {
    await api.updateHospital(h.id, { is_active: !(h.is_active ?? true) });
    await load();
    await refresh();
  };

  return (
    <Shell title="Platform Admin" subtitle="Manage hospitals">
      <div className="page-grid-2">
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-header">
            <span className="card-title">Hospitals ({hospitals.length})</span>
          </div>
          <div style={{ padding: 8 }}>
            {hospitals.map((h) => (
              <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700 }}>{h.name}</span>
                    <span className={(h.is_active ?? true) ? "badge badge-live" : "badge badge-off"}>
                      {(h.is_active ?? true) ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    {h.city}{h.address ? ` · ${h.address}` : ""}{h.phone ? ` · ${h.phone}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>
                    {h.doctor_count ?? 0} doctors · {h.patient_count ?? 0} patients · {h.machine_count ?? 0} machines
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(h)}>
                    {(h.is_active ?? true) ? "Disable" : "Enable"}
                  </button>
                  <Link
                    href={`/hospital/${h.id}`}
                    className="btn btn-primary btn-sm"
                    onClick={() => { setMode("hospital"); setHospitalId(h.id); }}
                  >
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 20, alignSelf: "start" }}>
          <div style={{ fontWeight: 700, marginBottom: 14 }}>Add hospital</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label className="input-label">Name
              <input className="input" style={{ marginTop: 4 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quivora East Clinic" />
            </label>
            <label className="input-label">City
              <input className="input" style={{ marginTop: 4 }} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Pune" />
            </label>
            <label className="input-label">Address
              <input className="input" style={{ marginTop: 4 }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area" />
            </label>
            <label className="input-label">Phone
              <input className="input" style={{ marginTop: 4 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" />
            </label>
            {msg && <p style={{ fontSize: 12, color: msg.startsWith("Created") ? "var(--ok)" : "var(--err)" }}>{msg}</p>}
            <button className="btn btn-primary" disabled={loading} onClick={create}>
              {loading ? "Creating…" : "Create hospital"}
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}
