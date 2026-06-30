import { HoverPrefetchLink } from "@/components/dashboard/_shared/hover-prefetch-link";

export interface DashboardSubTab {
  id: string;
  label: string;
  href: string;
}

export function SubTabBar({
  tabs,
  activeTab,
  label = "Dashboard section",
  prefetchOnHover = false,
}: {
  tabs: DashboardSubTab[];
  activeTab: string;
  label?: string;
  /**
   * Eagerly prefetch each sub-tab route on hover. Enabled for the internal
   * dashboard (instant tab switches); left off for the public share surface.
   */
  prefetchOnHover?: boolean;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <HoverPrefetchLink
            key={tab.id}
            prefetchOnHover={prefetchOnHover}
            href={tab.href}
            className={`inline-flex items-center rounded-full px-4 py-2 text-xs font-medium transition-colors ${
              isActive
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </HoverPrefetchLink>
        );
      })}
    </nav>
  );
}
