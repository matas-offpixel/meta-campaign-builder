import Link from "next/link";

export interface DashboardSubTab {
  id: string;
  label: string;
  href: string;
}

export function SubTabBar({
  tabs,
  activeTab,
  label = "Dashboard section",
}: {
  tabs: DashboardSubTab[];
  activeTab: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`inline-flex items-center rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              isActive
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
