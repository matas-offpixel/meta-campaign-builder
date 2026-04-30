"use client";

import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LinkedCampaignsPerformance } from "./linked-campaigns-performance";

interface Props {
  eventId: string;
  hasEventCode: boolean;
  /** Plan id when one exists for this event, otherwise null. */
  initialPlanId: string | null;
}

export function GoogleAdsReportTab({ eventId, hasEventCode, initialPlanId }: Props) {
  const header = (
    <div className="flex items-start gap-3">
      <Search className="mt-0.5 h-4 w-4 text-blue-500" />
      <div className="min-w-0">
        <h2 className="font-heading text-base tracking-wide">Google Ads</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {initialPlanId
            ? "Plan saved. Live campaigns below are matched by event code."
            : "No Google Ads plan for this event yet. Build one to define the budget allocation and linked account."}
        </p>
      </div>
    </div>
  );
  if (!initialPlanId) {
    return (
      <section className="rounded-md border border-border bg-card p-5">
        <div className="mb-3">{header}</div>
        <Link href={`/google-ads/new?eventId=${eventId}`}>
          <Button size="sm" variant="outline">
            <Search className="h-3.5 w-3.5" />
            Create Google Ads plan
          </Button>
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="flex items-start justify-between gap-4 rounded-md border border-border bg-card p-5">
        {header}
        <Link href="/google-ads">
          <Button size="sm" variant="ghost">Edit plan</Button>
        </Link>
      </section>
      <LinkedCampaignsPerformance
        eventId={eventId}
        hasEventCode={hasEventCode}
        initialPlatform="google"
      />
    </div>
  );
}
