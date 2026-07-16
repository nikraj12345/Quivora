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
  "📋": "▤",
  "🩺": "◉",
  "🔬": "◎",
  "👤": "Dr",
};

export function Shell({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  const pathname = usePathname();
  const { mode, hospital, hospitalId } = useRole();

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
            { href: "/checkin", icon: "✚", label: "Self check-in" },
            { href: "/register", icon: "✚", label: "Book visit" },
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
          { href: "/register", icon: "✚", label: "Register" },
          { href: "/reception", icon: "📋", label: "Today's Board" },
          { href: "/opd", icon: "🩺", label: "OPD Board" },
          { href: "/scans", icon: "🔬", label: "Scans" },
          { href: "/doctors", icon: "👤", label: "Doctors" },
        ],
      },
      {
        label: "System",
        links: [{ href: "/training", icon: "⚙", label: "Training" }],
      },
    ];
  }, [mode, hospital, hospitalId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="sidebar-logo" title="Back to Quivora home">
          <div className="logo-mark">Q</div>
          <div className="logo-name">Quivora</div>
          <div className="logo-sub">
            {mode === "admin" ? "Platform" : mode === "patient" ? "Patient" : "Hospital Ops"}
          </div>
        </Link>

        <div className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section">{section.label}</div>
              {section.links.map((l) => {
                const active =
                  l.href === "/" || l.href === "/admin" || l.href === "/patient-portal" || l.href === "/hospital"
                    ? pathname === l.href || (l.href.startsWith("/hospital") && pathname.startsWith("/hospital"))
                    : pathname.startsWith(l.href);
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
