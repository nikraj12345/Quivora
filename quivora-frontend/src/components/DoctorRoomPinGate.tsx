"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";

export function DoctorRoomPinGate({
  doctorRef,
  doctorId,
  children,
}: {
  doctorRef: string;
  doctorId?: number;
  children: React.ReactNode;
}) {
  const { user, doctorRoomLogin } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const allowed =
    user &&
    (user.role === "platform_admin" ||
      user.role === "hospital_admin" ||
      user.role === "hospital_staff" ||
      (user.role === "doctor" && (!doctorId || user.doctor_id === doctorId)));

  if (allowed) return <>{children}</>;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await doctorRoomLogin(doctorRef, pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" style={{ minHeight: "60vh" }}>
      <div className="login-card">
        <h1>Doctor room</h1>
        <p className="login-sub">Enter the room PIN to start consultations.</p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={onSubmit} className="login-form">
          <label className="input-label">
            Room PIN
            <input
              className="input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              required
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "Unlocking…" : "Unlock room"}
          </button>
        </form>
        <p className="login-hints">Demo PIN: <code>1234</code></p>
      </div>
    </div>
  );
}
