"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/components/Shell";
import { useRole } from "@/lib/role";

export default function HospitalIndexPage() {
  const { hospitalId, hospitals, setHospitalId } = useRole();
  const router = useRouter();

  useEffect(() => {
    const id = hospitalId || hospitals[0]?.id;
    if (id) {
      setHospitalId(id);
      router.replace(`/hospital/${id}`);
    }
  }, [hospitalId, hospitals, router, setHospitalId]);

  return (
    <Shell title="Hospital Console">
      <div className="card" style={{ padding: 24 }}>
        <p style={{ color: "var(--muted)" }}>Select a hospital from the top-right switcher.</p>
      </div>
    </Shell>
  );
}
