"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { DoctorLiveToggle } from "@/components/DoctorLiveToggle";
import { api, Doctor } from "@/lib/api";
import { useRole } from "@/lib/role";
import { formatSlotsList, slotShort } from "@/lib/slots";

export default function DoctorsPage() {
  const { hospital, hospitalId, setMode } = useRole();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [error, setError] = useState("");
  const selectedId = hospitalId || hospital?.id || null;

  useEffect(() => { setMode("hospital"); }, [setMode]);

  useEffect(() => {
    if (!selectedId) {
      setDoctors([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await api.doctors(selectedId);
        if (!cancelled) setDoctors(rows);
      } catch {
        if (!cancelled) setDoctors([]);
      }
    };
    load();
    const t = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(t); };
  }, [selectedId]);

  const live = doctors.filter((d) => d.is_live).length;

  return (
    <Shell title="Doctors" subtitle={hospital ? `${hospital.name}` : undefined}>
      <div className="board-hero">
        <div className="board-hero-stats">
          <div>
            <span className="board-hero-num">{live}</span>
            <span className="board-hero-label">live</span>
          </div>
          <div>
            <span className="board-hero-num">{doctors.length - live}</span>
            <span className="board-hero-label">offline</span>
          </div>
        </div>
        <Link href={selectedId ? `/hospital/${selectedId}` : "/hospital"} className="btn btn-secondary btn-sm">
          Edit schedules
        </Link>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!selectedId ? (
        <p className="empty-hint">Select a hospital to manage doctors.</p>
      ) : (
        <div className="doctor-list">
          {doctors.map((d) => (
            <div key={d.id} className="doctor-list-row">
              <div className="doctor-list-main">
                <strong>{d.name}</strong>
                <span>{d.department}</span>
                <span className="doctor-list-slots">
                  {formatSlotsList(d.slots)}
                  {d.is_live && d.active_slot ? ` · live ${slotShort(d.active_slot)}` : ""}
                </span>
                <span style={{ fontSize: 12, color: "var(--accent-dark)", fontWeight: 600 }}>
                  ₹{d.consultation_fee ?? 500} new · ₹{d.follow_up_fee ?? 300} follow-up
                </span>
              </div>
              <DoctorLiveToggle
                externalId={d.external_id}
                isLive={d.is_live}
                slots={d.slots}
                activeSlot={d.active_slot}
                onChanged={(updated) => setDoctors((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
                onError={setError}
              />
              <Link href={`/room/${d.external_id}`} className="btn btn-ghost btn-sm">Room</Link>
            </div>
          ))}
          {doctors.length === 0 && <p className="empty-hint">No doctors enrolled yet.</p>}
        </div>
      )}
    </Shell>
  );
}
