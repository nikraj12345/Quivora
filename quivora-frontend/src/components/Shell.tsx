"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useMemo } from "react";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { useRole } from "@/lib/role";
import { useAuth } from "@/lib/auth";

export function Shell({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  const pathname = usePathname();
  const { mode, hospital, hospitalId, doctor } = useRole();
  const { user, logout } = useAuth();
  const isPlatformAdmin = user?.role === "platform_admin";
  const hid = hospitalId || hospital?.id;

  const sections = useMemo(() => {
    if (mode === "admin" && isPlatformAdmin) {
      return [
        {
          label: "Platform",
          links: [
            { href: "/admin", label: "Hospitals" },
          ],
        },
      ];
    }
    if (mode === "patient") {
      return [
        {
          label: "Care",
          links: [
            { href: "/patient-portal", label: "Home" },
            { href: hid ? `/register?hospital=${hid}&source=patient` : "/register", label: "Book" },
            { href: hid ? `/checkin?hospital=${hid}` : "/checkin", label: "Check in" },
          ],
        },
      ];
    }
    if (mode === "doctor") {
      return [
        {
          label: "Clinic",
          links: [
            { href: "/doctor", label: "My patients" },
            ...(doctor ? [{ href: `/room/${doctor.external_id}`, label: "Room" }] : []),
          ],
        },
      ];
    }
    // Hospital — slim primary nav (fewer clicks)
    return [
      {
        label: "Today",
        links: [
          { href: "/opd", label: "Doctor Management" },
          { href: "/scans", label: "Scan Diagnostics" },
          { href: hid ? `/register?hospital=${hid}&source=hospital` : "/register", label: "Register" },
          { href: "/insights", label: "Insights" },
        ],
      },
      {
        label: "More",
        links: [
          { href: hid ? `/hospital/${hid}` : "/hospital", label: "Hospital" },
        ],
      },
    ];
  }, [mode, hospital, hospitalId, doctor, hid, isPlatformAdmin]);

  const isActive = (href: string) => {
    const linkPath = href.split("?")[0];
    if (linkPath === "/opd") return pathname.startsWith("/opd") || pathname.startsWith("/room");
    if (linkPath === "/register") return pathname.startsWith("/register");
    if (linkPath === "/doctors") return pathname.startsWith("/doctors");
    if (linkPath === "/insights") return pathname.startsWith("/insights");
    if (linkPath.startsWith("/hospital")) return pathname.startsWith("/hospital");
    if (linkPath === "/admin") return pathname.startsWith("/admin");
    if (linkPath === "/patient-portal") return pathname.startsWith("/patient-portal");
    if (linkPath === "/doctor") return pathname === "/doctor";
    return pathname.startsWith(linkPath);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="sidebar-logo" title="Quivora home">
          <div className="logo-mark">Q</div>
          <div>
            <div className="logo-name">Quivora</div>
            <div className="logo-sub">
              {mode === "admin" ? "Platform" : mode === "patient" ? "Patient" : mode === "doctor" ? "Doctor" : "Hospital"}
            </div>
          </div>
        </Link>

        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section">{section.label}</div>
              {section.links.map((l) => (
                <Link key={l.href} href={l.href} className={`sidebar-link ${isActive(l.href) ? "active" : ""}`}>
                  {l.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <p>{hospital?.name || "Pick a hospital →"}</p>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-text">
            {title && <h1 className="topbar-title">{title}</h1>}
            {subtitle && <p className="topbar-sub">{subtitle}</p>}
          </div>
          <RoleSwitcher />
          {user ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void logout(); }} style={{ marginLeft: 8 }}>
              Sign out
            </button>
          ) : (
            <Link href="/login" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}>
              Sign in
            </Link>
          )}
        </header>
        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
