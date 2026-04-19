"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  eventId: string;
  /** Plan id when one exists for this event, otherwise null. */
  initialPlanId: string | null;
}

const GOOGLE_BLUE = "#4285F4";

const PLACEHOLDER_STATS: ReadonlyArray<{ label: string }> = [
  { label: "Impressions" },
  { label: "Clicks" },
  { label: "Spend" },
  { label: "Conversions" },
  { label: "CTR" },
  { label: "CPC" },
  { label: "Conversion Rate" },
  { label: "Cost / Conversion" },
];

/**
 * Google Ads reporting tab — placeholder. Mirrors the TikTok tab
 * layout for consistency.
 *
 * Two states:
 *   - No plan exists: prompt to create one (deep links to the plan
 *     builder).
 *   - Plan exists: show the placeholder StatCard grid with a "Live
 *     reporting coming soon" banner. The plan summary itself is
 *     expected to render in the plan builder UI; the report tab is
 *     specifically about live performance data.
 */
export function GoogleAdsReportTab({ eventId, initialPlanId }: Props) {
  if (!initialPlanId) {
    return (
      <section className="rounded-md border border-border bg-card p-5">
        <div className="mb-3 flex items-start gap-3">
          <Search className="mt-0.5 h-4 w-4" style={{ color: GOOGLE_BLUE }} />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">
              Google Ads
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              No Google Ads plan for this event yet. Build one to define
              the search-side budget allocation, geo modifiers and RLSA
              boosts.
            </p>
          </div>
        </div>
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
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Search
              className="mt-0.5 h-4 w-4"
              style={{ color: GOOGLE_BLUE }}
            />
            <div className="min-w-0">
              <h2 className="font-heading text-base tracking-wide">
                Google Ads
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Plan saved. Live reporting coming soon — impressions,
                clicks and conversions will surface here once the
                Google Ads API integration is wired.
              </p>
            </div>
          </div>
          <Link href={`/google-ads`}>
            <Button size="sm" variant="ghost">
              Edit plan
            </Button>
          </Link>
        </div>
      </section>

      <section
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Google Ads placeholder stats"
      >
        {PLACEHOLDER_STATS.map((stat) => (
          <PlaceholderStatCard key={stat.label} label={stat.label} />
        ))}
      </section>
    </div>
  );
}

function PlaceholderStatCard({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-muted-foreground">—</p>
    </div>
  );
}
