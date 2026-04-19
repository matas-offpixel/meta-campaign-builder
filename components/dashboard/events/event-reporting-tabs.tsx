"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { TikTokReportTab } from "@/components/dashboard/events/tiktok-report-tab";

type ReportChannel = "meta" | "tiktok";

interface Props {
  eventId: string;
  /** Live Meta report rendered by the parent server-resolved tree. */
  metaPanel: ReactNode;
  initialTikTokAccountId: string | null;
}

/**
 * Sub-tabs inside the event Reporting panel. Splits Meta (the existing
 * live report), TikTok (placeholder until OAuth lands), and Google Ads
 * (placeholder until the plan + reporting flow lands) into peer panels.
 *
 * Active sub-tab is local state — not URL-synced — because it switches
 * frequently as users compare channels and full URL state would compete
 * with the existing top-level `?tab=reporting` carrier on the parent
 * event detail tabs.
 */
export function EventReportingTabs({
  eventId,
  metaPanel,
  initialTikTokAccountId,
}: Props) {
  const [active, setActive] = useState<ReportChannel>("meta");

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: "meta", label: "Meta" },
          { id: "tiktok", label: "TikTok" },
        ]}
        activeTab={active}
        onTabChange={(id) => setActive(id as ReportChannel)}
      />

      <TabPanel active={active === "meta"}>{metaPanel}</TabPanel>

      <TabPanel active={active === "tiktok"}>
        <TikTokReportTab
          eventId={eventId}
          initialTikTokAccountId={initialTikTokAccountId}
        />
      </TabPanel>
    </div>
  );
}
