"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  LogOut,
  Plug,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";

/**
 * components/admin/admin-shell.tsx
 *
 * Chrome for the client admin dashboard (OP909): left sidebar nav +
 * sticky top bar + content area. FUNCTIONAL aesthetic — follows the
 * internal dashboard patterns (Tailwind tokens, rounded corners,
 * lucide icons), deliberately NOT the Supreme fan-facing system.
 *
 * Client component (usePathname for active states + client-side logout),
 * receives the resolved membership as props from the server layout.
 */

type NavItem = {
  /** Path segment under /admin/{clientSlug} ("" = dashboard home). */
  segment: string;
  label: string;
  icon: React.ElementType;
};

const NAV_ITEMS: NavItem[] = [
  { segment: "", label: "Dashboard", icon: LayoutDashboard },
  { segment: "pages", label: "Pages", icon: LayoutDashboard },
  { segment: "fans", label: "Fans", icon: Users },
  { segment: "insights", label: "Insights", icon: BarChart3 },
  { segment: "integrations", label: "Integrations", icon: Plug },
  { segment: "settings", label: "Settings", icon: SettingsIcon },
];

export function AdminShell({
  clientSlug,
  clientName,
  children,
}: {
  clientSlug: string;
  clientName: string;
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
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="px-5 py-5 border-b border-border">
          <p className="font-heading text-lg tracking-wide leading-none truncate">
            {clientName}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Landing pages &amp; fans
          </p>
        </div>

        <nav className="flex-1 px-2 py-3">
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
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors
                      ${
                        active
                          ? "bg-primary-light text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="flex-1">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
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

        <div className="px-5 pb-4">
          <p className="text-[10px] text-muted-foreground">
            Powered by Off/Pixel
          </p>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-border bg-card px-4 md:hidden">
          <span className="text-sm font-medium truncate">{clientName}</span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Log out
          </button>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
