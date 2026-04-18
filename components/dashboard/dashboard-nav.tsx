"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  Ticket,
  Megaphone,
  BarChart3,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearFacebookTokenStorage } from "@/lib/facebook-token-storage";

type NavItem = {
  href: string;
  label: string;
  icon: React.ElementType;
  /** If provided, the item is highlighted when the path matches any of these. */
  match?: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/today",
    label: "Today",
    icon: LayoutDashboard,
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: CalendarDays,
  },
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
    // Campaigns is the existing library at '/' and the wizard under '/campaign/...'
    match: (p) => p === "/" || p.startsWith("/campaign/"),
  },
  {
    href: "/reporting",
    label: "Reporting",
    icon: BarChart3,
  },
  {
    href: "/settings",
    label: "Settings",
    icon: SettingsIcon,
  },
];

export function DashboardNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();

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

      <nav className="flex-1 px-2 py-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.match
              ? item.match(pathname)
              : pathname === item.href;
            const Icon = item.icon;
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
                  {item.label}
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
    </aside>
  );
}
