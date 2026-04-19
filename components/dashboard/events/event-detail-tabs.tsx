"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import {
  parseEventTab,
  type EventTab,
} from "@/lib/dashboard/format";

export type { EventTab };

interface Props {
  active: EventTab;
  campaignsCount: number;
}

/**
 * Thin client wrapper around the shared <Tabs> primitive. The active tab
 * comes from the parent server component (which read it from searchParams).
 * Clicking a tab pushes a new URL — the route then re-renders server-side
 * with the new searchParams, no client-side fetching, browser back/forward
 * and refresh-stable.
 */
export function EventDetailTabs({ active, campaignsCount }: Props) {
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

  return (
    <Tabs
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "plan", label: "Plan" },
        { id: "campaigns", label: "Campaigns", count: campaignsCount },
        { id: "reporting", label: "Reporting" },
      ]}
      activeTab={active}
      onTabChange={handleChange}
    />
  );
}
