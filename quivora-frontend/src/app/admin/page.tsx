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
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  // Modal / Credential update state
  const [credHospital, setCredHospital] = useState<Hospital | null>(null);
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credLoading, setCredLoading] = useState(false);
  const [credMsg, setCredMsg] = useState("");

  const load = async () => {
    const hs = await api.hospitals();
    setHospitals(hs);
  };

  useEffect(() => { load().catch(() => {}); }, []);

  const create = async () => {
    if (!name.trim() || !city.trim()) { setMsg("Name and city are required"); return; }
    setLoading(true); setMsg("");
    try {
      const h = await api.createHospital({
        name: name.trim(),
        city: city.trim(),
        address: address.trim(),
        phone: phone.trim() || undefined,
        timezone,
        admin_email: adminEmail.trim() || undefined,
        admin_password: adminPassword || undefined,
      });
      setName(""); setCity(""); setAddress(""); setPhone(""); setAdminEmail(""); setAdminPassword("");
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

  const openCredModal = (h: Hospital) => {
    setCredHospital(h);
    setCredEmail(h.admin_email || "");
    setCredPassword("");
    setCredMsg("");
  };

  const saveCredentials = async () => {
    if (!credHospital) return;
    if (!credEmail.trim() || !credPassword.trim()) {
      setCredMsg("User ID / Email and Password are required");
      return;
    }
    setCredLoading(true); setCredMsg("");
    try {
      await api.setHospitalCredentials(credHospital.id, {
        admin_email: credEmail.trim(),
        admin_password: credPassword,
      });
      await load();
      setCredMsg("Login credentials updated successfully!");
      setTimeout(() => setCredHospital(null), 1200);
    } catch (e) {
      setCredMsg(e instanceof Error ? e.message : "Failed to set credentials");
    } finally {
      setCredLoading(false);
    }
  };

  return (
    <Shell title="Platform Admin" subtitle="View and manage hospitals and login accounts">
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
              <div key={h.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 14px", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{h.name}</span>
                      <span className={(h.is_active ?? true) ? "badge badge-live" : "badge badge-off"}>
                        {(h.is_active ?? true) ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                      {h.city}{h.address ? ` · ${h.address}` : ""}{h.phone ? ` · ${h.phone}` : ""}{h.timezone ? ` · ${h.timezone}` : ""}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--muted-2)" }}>Admin Login:</span>
                      {h.admin_email ? (
                        <code style={{ background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 4, fontSize: 12 }}>
                          {h.admin_email}
                        </code>
                      ) : (
                        <span style={{ color: "var(--muted)", fontStyle: "italic", fontSize: 11 }}>No login set</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>
                      {h.doctor_count ?? 0} doctors · {h.patient_count ?? 0} patients · {h.machine_count ?? 0} machines
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCredModal(h)}>
                      {h.admin_email ? "Reset Login" : "Set Login"}
                    </button>
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
              </div>
            ))}
            {hospitals.length === 0 && (
              <p style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>No hospitals yet — create one below.</p>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: 20, alignSelf: "start" }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>Add hospital</div>
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

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)", marginBottom: 8 }}>
                Hospital Login Account (Optional)
              </div>
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10 }}>
                Set up initial User ID & Password so hospital admin can sign in directly at <code>/login</code>.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label className="input-label">User ID / Email
                  <input className="input" style={{ marginTop: 4 }} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="e.g. admin-east@quivora.local or eastclinic" />
                </label>
                <label className="input-label">Password
                  <input className="input" type="password" style={{ marginTop: 4 }} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="••••••••" />
                </label>
              </div>
            </div>

            {msg && <p style={{ fontSize: 12, color: msg.startsWith("Created") || msg.startsWith("Deactivated") ? "var(--ok)" : "var(--err)" }}>{msg}</p>}
            <button className="btn btn-primary" disabled={loading} onClick={create} style={{ marginTop: 6 }}>
              {loading ? "Creating…" : "Create hospital"}
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Modal to Set/Reset Hospital Login Credentials */}
      {credHospital && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16
        }}>
          <div className="card" style={{ width: "100%", maxWidth: 440, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Hospital Login Credentials</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCredHospital(null)}>✕</button>
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
              Set or update User ID and Password for <strong>{credHospital.name}</strong>.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label className="input-label">User ID / Email
                <input className="input" style={{ marginTop: 4 }} value={credEmail} onChange={(e) => setCredEmail(e.target.value)} placeholder="e.g. admin-east@quivora.local or eastclinic" />
              </label>
              <label className="input-label">New Password
                <input className="input" type="password" style={{ marginTop: 4 }} value={credPassword} onChange={(e) => setCredPassword(e.target.value)} placeholder="Enter new password" />
              </label>
              {credMsg && (
                <p style={{ fontSize: 12, color: credMsg.includes("successfully") ? "var(--ok)" : "var(--err)" }}>
                  {credMsg}
                </p>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setCredHospital(null)}>Cancel</button>
                <button type="button" className="btn btn-primary" disabled={credLoading} onClick={saveCredentials}>
                  {credLoading ? "Saving…" : "Save Credentials"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
