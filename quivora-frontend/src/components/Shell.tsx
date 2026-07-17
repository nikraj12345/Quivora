"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useMemo } from "react";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { useRole } from "@/lib/role";

const NAV_ICONS: Record<string, string> = {
  "▣": "H",
  "⚙": "⚙",
  "⌂": "⌂",
  "✚": "+",
  "▦": "▦",
  "📊": "◈",
  "📋": "▤",
  "🩺": "◉",
  "🔬": "◎",
  "👤": "Dr",
};

export function Shell({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  const pathname = usePathname();
  const { mode, hospital, hospitalId, doctor } = useRole();

  const sections = useMemo(() => {
    if (mode === "admin") {
      return [
        {
          label: "Platform",
          links: [
            { href: "/admin", icon: "▣", label: "Hospitals" },
            { href: "/training", icon: "⚙", label: "Training" },
          ],
        },
      ];
    }
    if (mode === "patient") {
      return [
        {
          label: "Patient",
          links: [
            { href: "/patient-portal", icon: "⌂", label: "My care" },
            { href: hospitalId ? `/checkin?hospital=${hospitalId}` : "/checkin", icon: "✚", label: "Self check-in" },
            { href: hospitalId ? `/register?hospital=${hospitalId}&source=patient` : "/register", icon: "✚", label: "Book visit" },
          ],
        },
      ];
    }
    if (mode === "doctor") {
      return [
        {
          label: "Doctor",
          links: [
            { href: "/doctor", icon: "👤", label: "My Patients" },
            ...(doctor
              ? [{ href: `/room/${doctor.external_id}`, icon: "🩺", label: "Consultation Room" }]
              : []),
          ],
        },
      ];
    }
    const hid = hospitalId || hospital?.id;
    return [
      {
        label: "Hospital",
        links: [
          { href: hid ? `/hospital/${hid}` : "/hospital", icon: "⌂", label: "Console" },
          { href: "/ops", icon: "▦", label: "Dashboard" },
          { href: "/doctors", icon: "👤", label: "Manage Doctors" },
          { href: "/scans", icon: "🔬", label: "Manage Scans" },
          { href: "/insights", icon: "📊", label: "Insights" },
        ],
      },
    ];
  }, [mode, hospital, hospitalId, doctor]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="sidebar-logo" title="Back to Quivora home">
          <div className="logo-mark">Q</div>
          <div className="logo-name">Quivora</div>
          <div className="logo-sub">
            {mode === "admin" ? "Platform" : mode === "patient" ? "Patient" : mode === "doctor" ? "Doctor" : "Hospital Ops"}
          </div>
        </Link>

        <div className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section">{section.label}</div>
              {section.links.map((l) => {
                const linkPath = l.href.split("?")[0];
                const active =
                  linkPath === "/" || linkPath === "/admin" || linkPath === "/patient-portal" || linkPath === "/hospital"
                    ? pathname === linkPath || (linkPath.startsWith("/hospital") && pathname.startsWith("/hospital"))
                    : pathname.startsWith(linkPath);
                return (
                  <Link key={l.href} href={l.href} className={`sidebar-link ${active ? "active" : ""}`}>
                    <span className="nav-icon">{NAV_ICONS[l.icon] ?? l.icon}</span>
                    {l.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <p>{hospital ? hospital.name : "Select hospital from top-right"}</p>
        </div>
      </aside>

      <div className="main-content">
        <div className="topbar">
          {title && <span className="topbar-title">{title}</span>}
          {subtitle && <span className="topbar-sub">{subtitle}</span>}
          <span className="topbar-live"><i /> Care in motion</span>
          <RoleSwitcher />
        </div>
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
