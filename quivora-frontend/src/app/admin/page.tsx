"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Hospital } from "@/lib/api";
import { useRole } from "@/lib/role";
import { useAuth } from "@/lib/auth";

export default function AdminPage() {
  const { refresh } = useRole();
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
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
      const h = await api.createHospital({ name: name.trim(), city: city.trim(), address, phone: phone || undefined, timezone });
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
    try {
      await api.updateHospital(h.id, { is_active: !(h.is_active ?? true) });
      await load();
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Update failed");
    }
  };

  const remove = async (h: Hospital) => {
    if (!window.confirm(`Deactivate “${h.name}”? It will be hidden from booking.`)) return;
    try {
      await api.deleteHospital(h.id);
      await load();
      await refresh();
      setMsg(`Deactivated ${h.name}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <Shell title="Platform Admin" subtitle="View and manage hospitals only">
      {!isPlatformAdmin ? (
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: "var(--muted)" }}>Platform admin access required.</p>
        </div>
      ) : (
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
                    {h.city}{h.address ? ` · ${h.address}` : ""}{h.phone ? ` · ${h.phone}` : ""}{h.timezone ? ` · ${h.timezone}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>
                    {h.doctor_count ?? 0} doctors · {h.patient_count ?? 0} patients · {h.machine_count ?? 0} machines
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleActive(h)}>
                    {(h.is_active ?? true) ? "Disable" : "Enable"}
                  </button>
                  {(h.is_active ?? true) && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => remove(h)} style={{ color: "var(--err)" }}>
                      Deactivate
                    </button>
                  )}
                </div>
              </div>
            ))}
            {hospitals.length === 0 && (
              <p style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No hospitals yet — create one.</p>
            )}
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
            <label className="input-label">Timezone
              <select className="input" style={{ marginTop: 4 }} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Asia/Kolkata">India — Asia/Kolkata</option>
                <option value="Asia/Dubai">UAE — Asia/Dubai</option>
                <option value="Europe/London">UK — Europe/London</option>
                <option value="America/New_York">US Eastern — America/New_York</option>
                <option value="America/Chicago">US Central — America/Chicago</option>
                <option value="America/Los_Angeles">US Pacific — America/Los_Angeles</option>
                <option value="UTC">UTC</option>
              </select>
            </label>
            {msg && <p style={{ fontSize: 12, color: msg.startsWith("Created") || msg.startsWith("Deactivated") ? "var(--ok)" : "var(--err)" }}>{msg}</p>}
            <button className="btn btn-primary" disabled={loading} onClick={create}>
              {loading ? "Creating…" : "Create hospital"}
            </button>
          </div>
        </div>
      </div>
      )}
    </Shell>
  );
}
