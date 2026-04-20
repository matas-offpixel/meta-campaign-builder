"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  LayoutDashboard,
  LayoutList,
  Users,
  Ticket,
  Megaphone,
  BarChart3,
  Receipt,
  Settings as SettingsIcon,
  LogOut,
  Music2,
  Search,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearFacebookTokenStorage } from "@/lib/facebook-token-storage";
import type { InvoiceRow } from "@/lib/types/invoicing";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  /** If provided, the item is highlighted when the path matches any of these. */
  match?: (pathname: string) => boolean;
  /** Live count badge fetched client-side. */
  badgeKey?: "overdue_invoices";
};

type NavSection = {
  /** Optional uppercase heading shown above this section. */
  heading?: string;
  items: NavItem[];
};

/**
 * Two-section nav. The original flat list is preserved as the unnamed
 * top section; "Platforms" groups the per-channel surfaces (TikTok in
 * Slice 3, Google Ads in Slice 4) introduced by the overnight scaffold.
 */
const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/today", label: "Today", icon: LayoutDashboard },
      {
        href: "/overview",
        label: "Overview",
        icon: LayoutList,
        match: (p) => p === "/overview" || p.startsWith("/overview/"),
      },
      { href: "/calendar", label: "Calendar", icon: CalendarDays },
      {
        href: "/clients",
        label: "Clients",
        icon: Users,
        match: (p) => p === "/clients" || p.startsWith("/clients/"),
      },
      {
        href: "/events",
        label: "Events",
        icon: Ticket,
        match: (p) => p === "/events" || p.startsWith("/events/"),
      },
      {
        href: "/",
        label: "Campaigns",
        icon: Megaphone,
        match: (p) => p === "/" || p.startsWith("/campaign/"),
      },
      { href: "/reporting", label: "Reporting", icon: BarChart3 },
      {
        href: "/invoicing",
        label: "Invoicing",
        icon: Receipt,
        match: (p) => p === "/invoicing" || p.startsWith("/invoicing/"),
        badgeKey: "overdue_invoices",
      },
    ],
  },
  {
    heading: "Platforms",
    items: [
      {
        href: "/tiktok",
        label: "TikTok",
        icon: Music2,
        match: (p) => p === "/tiktok" || p.startsWith("/tiktok/"),
      },
      {
        href: "/google-ads",
        label: "Google Ads",
        icon: Search,
        match: (p) => p === "/google-ads" || p.startsWith("/google-ads/"),
      },
    ],
  },
  {
    items: [{ href: "/settings", label: "Settings", icon: SettingsIcon }],
  },
];

/**
 * Compute overdue invoice count = sent + due_date < today + paid_date null.
 * Done client-side off the same /api/invoicing/invoices endpoint the
 * dashboard already uses, so no extra surface area.
 */
function isOverdue(inv: InvoiceRow): boolean {
  if (inv.status !== "sent") return false;
  if (!inv.due_date) return false;
  const due = new Date(inv.due_date);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return due < today;
}

export function DashboardNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [overdueCount, setOverdueCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCounts() {
      try {
        const res = await fetch("/api/invoicing/invoices?status=sent", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as
          | { ok: true; invoices: InvoiceRow[] }
          | { ok: false };
        if (!("ok" in json) || !json.ok) return;
        if (cancelled) return;
        setOverdueCount(json.invoices.filter(isOverdue).length);
      } catch {
        // Network blip — leave the badge silent rather than flicker an
        // error state into the sidebar.
      }
    }
    void loadCounts();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearFacebookTokenStorage();
    router.push("/login");
  };

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="px-5 py-5 border-b border-border">
        <p className="font-heading text-lg tracking-wide leading-none">
          Off/Pixel
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Agency OS
        </p>
      </div>

      <nav className="flex-1 px-2 py-3 space-y-3">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.heading ?? `section-${idx}`}>
            {section.heading && (
              <p className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                {section.heading}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.match
                  ? item.match(pathname)
                  : pathname === item.href;
                const Icon = item.icon;
                const badgeCount =
                  item.badgeKey === "overdue_invoices"
                    ? overdueCount
                    : null;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors
                        ${
                          active
                            ? "bg-primary-light text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                      {badgeCount != null && badgeCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                          {badgeCount}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-2 py-3 border-t border-border">
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground
            hover:text-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Log out
        </button>
      </div>
    </aside>
  );
}
