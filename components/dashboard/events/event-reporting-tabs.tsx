"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { TikTokReportTab } from "@/components/dashboard/events/tiktok-report-tab";
import { GoogleAdsReportTab } from "@/components/dashboard/events/google-ads-report-tab";

type ReportChannel = "meta" | "tiktok" | "google-ads";

interface Props {
  eventId: string;
  /** UUID of the client owning the event. Required by the TikTok import POST. */
  clientId: string;
  /** Live Meta report rendered by the parent server-resolved tree. */
  metaPanel: ReactNode;
  initialTikTokAccountId: string | null;
  /**
   * google_ad_plans.id when an existing plan is linked to this event,
   * otherwise null. Drives the Google Ads tab between "create plan"
   * CTA and the placeholder stat grid.
   */
  initialGoogleAdsPlanId: string | null;
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
  clientId,
  metaPanel,
  initialTikTokAccountId,
  initialGoogleAdsPlanId,
}: Props) {
  const [active, setActive] = useState<ReportChannel>("meta");

  return (
    <div className="space-y-4">
      <Tabs
        tabs={[
          { id: "meta", label: "Meta" },
          { id: "tiktok", label: "TikTok" },
          { id: "google-ads", label: "Google Ads" },
        ]}
        activeTab={active}
        onTabChange={(id) => setActive(id as ReportChannel)}
      />

      <TabPanel active={active === "meta"}>{metaPanel}</TabPanel>

      <TabPanel active={active === "tiktok"}>
        <TikTokReportTab
          eventId={eventId}
          clientId={clientId}
          initialTikTokAccountId={initialTikTokAccountId}
        />
      </TabPanel>

      <TabPanel active={active === "google-ads"}>
        <GoogleAdsReportTab
          eventId={eventId}
          initialPlanId={initialGoogleAdsPlanId}
        />
      </TabPanel>
    </div>
  );
}
