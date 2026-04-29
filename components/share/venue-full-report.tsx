"use client";

import { useRouter } from "next/navigation";

import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import { AdditionalSpendCard } from "@/components/dashboard/events/additional-spend-card";
import { VenueDailyReportBlock } from "./venue-daily-report-block";

/**
 * components/share/venue-full-report.tsx
 *
 * Linear venue report page used by both the internal full-report route
 * and the external venue share route. This intentionally does NOT reuse
 * the collapsed client-portal venue card shell; the full report should
 * follow the same top-to-bottom order as the per-event share report.
 *
 * Single-responsibility: this file does NO data fetching; the
 * parent page pre-filters the portal payload down to the venue
 * scope before passing it in.
 */

interface Props {
  /**
   * Token forwarded to `ClientPortalVenueTable` for the per-row
   * tickets/additional-spend endpoints. External usage passes a
   * venue-scope share token; internal usage passes empty string —
   * the table falls back to event-detail navigation for editing
   * (see `VenueTicketsClickEdit`).
   */
  token?: string;
  clientId: string;
  /** The venue's `event_code` — the pivot key for venue-scope writes. */
  eventCode: string;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  londonOnsaleSpend: number | null;
  londonPresaleSpend: number | null;
  isInternal?: boolean;
  /**
   * Controls whether the venue additional-spend card renders in
   * read-only mode on the share surface. Defaults to read-only for
   * external shares that weren't explicitly flagged editable — matches
   * the per-event share card's contract.
   */
  canEdit?: boolean;
}

export function VenueFullReport({
  token = "",
  clientId,
  eventCode,
  events: initialEvents,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  isInternal = false,
  canEdit = false,
}: Props) {
  const router = useRouter();
  // Venue-scope additional spend. Internal surface: cookie auth,
  // always editable. Share surface: token auth, editable iff the
  // share row was minted with `can_edit=true`.
  const mode: "dashboard" | "share" = isInternal ? "dashboard" : "share";
  const readOnly = !isInternal && !canEdit;

  return (
    <div className="space-y-6">
      <VenueLiveReportTabs />
      <div className="rounded-md border border-border bg-background p-4">
        <AdditionalSpendCard
          scope={{ kind: "venue", clientId, venueEventCode: eventCode }}
          mode={mode}
          shareToken={mode === "share" ? token : undefined}
          readOnly={readOnly}
          onAfterMutate={() => router.refresh()}
        />
      </div>
      <VenueDailyReportBlock
        eventCode={eventCode}
        events={initialEvents}
        dailyEntries={dailyEntries}
        dailyRollups={dailyRollups}
        additionalSpend={additionalSpend}
        mode={mode}
      />
    </div>
  );
}

function VenueLiveReportTabs() {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Live report
          </p>
          <h2 className="font-heading text-lg tracking-wide">
            Channel performance
          </h2>
        </div>
        <div
          role="tablist"
          aria-label="Live report channels"
          className="inline-flex rounded-md border border-border bg-muted/30 p-1 text-xs"
        >
          {(["Meta", "TikTok", "Google Ads"] as const).map((label, index) => {
            const active = index === 0;
            return (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={!active}
                className={`rounded px-3 py-1.5 font-medium transition ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground opacity-60"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Venue-scoped Meta, TikTok and Google Ads live report panels will attach
        here in the next tiers. This scaffold fixes the report order without
        adding a second data path.
      </div>
    </section>
  );
}
