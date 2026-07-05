"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  LayoutList,
  Plug,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * components/admin/admin-shell.tsx — OP909 dashboard chrome.
 *
 * Sprint 1 aesthetic pivot: the dashboard now speaks the fan-facing LP's
 * language — mono lowercase nav, Futura Bold Italic product wordmark in a
 * brand-accent box (mirrors the LP box logo), zero radius, 0.5px black
 * hairlines, pure white. The whole tree is wrapped in `.op909-admin` with
 * the client accent set as `--admin-accent` so it inherits down (and never
 * leaks to the operator surfaces).
 *
 * NOTE (resolved spec conflict): the brief's Goal 1 says "sidebar keeps its
 * dark bg" but Goal 3 defines the active item as BLACK text with hover =
 * "text darken only" — only coherent on a LIGHT sidebar. Shipped light
 * (matches the all-white Supreme target + the accent box-logo pop). Flip to
 * a dark rail later if desired — it's a single bg + text-color swap here.
 *
 * "OP909" is the working product name; swap the PRODUCT_WORDMARK string once
 * Commercial+Ops locks the final name.
 */

const PRODUCT_WORDMARK = "OP909";

type NavItem = {
  segment: string;
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { segment: "", label: "dashboard", icon: LayoutDashboard },
  { segment: "pages", label: "pages", icon: LayoutList },
  { segment: "fans", label: "fans", icon: Users },
  { segment: "insights", label: "insights", icon: BarChart3 },
  { segment: "integrations", label: "integrations", icon: Plug },
  { segment: "settings", label: "settings", icon: SettingsIcon },
];

export function AdminShell({
  clientSlug,
  clientName,
  accent,
  children,
}: {
  clientSlug: string;
  clientName: string;
  accent: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const base = `/admin/${clientSlug}`;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
  };

  return (
    <div
      className="op909-admin flex min-h-screen"
      style={{ ["--admin-accent" as string]: accent }}
    >
      <aside className="hidden w-60 shrink-0 flex-col border-r-[0.5px] border-black bg-white md:flex">
        <div className="px-6 py-6">
          <span
            className="admin-heading inline-block px-2.5 py-1 text-[16px] text-white"
            style={{ backgroundColor: accent }}
          >
            {PRODUCT_WORDMARK}
          </span>
          <p className="mt-2 font-[family-name:var(--admin-mono)] text-[10px] leading-snug text-[#999]">
            for {clientName}
          </p>
        </div>

        <nav className="flex-1 px-3 py-2">
          <ul className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const href = item.segment ? `${base}/${item.segment}` : base;
              const active = item.segment
                ? pathname === href || pathname.startsWith(`${href}/`)
                : pathname === base;
              const Icon = item.icon;
              return (
                <li key={item.segment || "home"}>
                  <Link
                    href={href}
                    prefetch
                    className={`flex items-center gap-2.5 py-2 pl-3 font-[family-name:var(--admin-mono)] text-[12px] lowercase transition-colors ${
                      active
                        ? "border-l-2 font-medium text-black"
                        : "border-l-2 border-transparent text-[#999] hover:text-black"
                    }`}
                    style={active ? { borderColor: accent } : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="px-3 py-4">
          <button
            type="button"
            onClick={handleLogout}
            className="py-2 pl-3 font-[family-name:var(--admin-mono)] text-[11px] uppercase tracking-[1px] text-[#999] transition-colors hover:text-black"
          >
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b-[0.5px] border-black bg-white px-4 md:hidden">
          <span
            className="admin-heading inline-block px-2 py-0.5 text-[13px] text-white"
            style={{ backgroundColor: accent }}
          >
            {PRODUCT_WORDMARK}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="font-[family-name:var(--admin-mono)] text-[11px] uppercase tracking-[1px] text-[#999] hover:text-black"
          >
            Log out
          </button>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
