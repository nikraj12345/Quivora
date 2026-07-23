"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor } from "@/lib/api";
import { useRole } from "@/lib/role";
import { useAuth } from "@/lib/auth";
import { formatSlotsList, slotShort } from "@/lib/slots";

export default function PatientPortalPage() {
  const { hospital, hospitalId, setMode } = useRole();
  const { user } = useAuth();
  const [doctors, setDoctors] = useState<Doctor[]>([]);

  useEffect(() => {
    setMode("patient");
  }, [setMode]);

  useEffect(() => {
    if (!hospitalId) return;
    api.doctors(hospitalId).then(setDoctors).catch(() => setDoctors([]));
  }, [hospitalId]);

  const available = doctors.filter((d) => d.is_available);
  const bookHref = hospitalId ? `/register?hospital=${hospitalId}&source=patient` : "/register";
  const signedIn = user?.role === "patient";

  return (
    <Shell
      title="Home"
      subtitle={hospital?.name || user?.hospital_name || "Your care portal"}
    >
      {!signedIn ? (
        <div className="portal-hero">
          <h2>Patient portal</h2>
          <p>
            Sign in with your phone OTP at check-in, or book a visit without an account.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/checkin" className="btn btn-secondary">
              Sign in with phone
            </Link>
            <Link href={bookHref} className="btn btn-primary">
              Book / register
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="portal-hero">
            <h2>{user.name}</h2>
            <p>
              {hospital?.name || user.hospital_name || "Your hospital"}
            </p>
            <Link href={bookHref} className="btn btn-primary">
              Book a visit
            </Link>
          </div>

          <div className="board-hero" style={{ marginBottom: 12 }}>
            <div className="board-hero-stats">
              <div>
                <span className="board-hero-num">{available.length}</span>
                <span className="board-hero-label">available today</span>
              </div>
            </div>
          </div>

          <div className="doctor-list">
            {available.map((d) => (
              <div key={d.id} className="doctor-list-row">
                <div className="doctor-list-main">
                  <strong>{d.name}</strong>
                  <span>{d.department}</span>
                  <span className="doctor-list-slots">{formatSlotsList(d.slots)}</span>
                </div>
                <span className={d.is_live ? "badge badge-live" : "badge badge-off"}>
                  {d.is_live ? `Live · ${slotShort(d.active_slot)}` : "Not started"}
                </span>
              </div>
            ))}
            {available.length === 0 && (
              <p className="empty-hint">No doctors marked available right now.</p>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
