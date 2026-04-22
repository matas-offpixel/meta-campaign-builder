"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  parseEventTab,
  type EventTab,
} from "@/lib/dashboard/format";
import type { EventKind } from "@/lib/db/events";

export type { EventTab };

interface Props {
  active: EventTab;
  campaignsCount: number;
  /**
   * Engagement type. `brand_campaign` rows hide the Plan tab — there's no
   * presale grid to render on a date-ranged awareness push.
   */
  eventKind?: EventKind;
}

/**
 * Thin client wrapper around the shared <Tabs> primitive. The active tab
 * comes from the parent server component (which read it from searchParams).
 * Clicking a tab pushes a new URL — the route then re-renders server-side
 * with the new searchParams, no client-side fetching, browser back/forward
 * and refresh-stable.
 */
export function EventDetailTabs({
  active,
  campaignsCount,
  eventKind = "event",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (id: string) => {
    const next = parseEventTab(id);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "overview") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const tabs = [
    { id: "overview", label: "Overview" },
    ...(eventKind === "brand_campaign"
      ? []
      : [{ id: "plan", label: "Plan" }]),
    { id: "campaigns", label: "Campaigns", count: campaignsCount },
    { id: "reporting", label: "Reporting" },
    { id: "active-creatives", label: "Active Creatives" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <Tabs tabs={tabs} activeTab={active} onTabChange={handleChange} />
  );
}
