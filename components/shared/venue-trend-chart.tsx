"use client";

import { useEffect, useState } from "react";

import { EventTrendChart } from "@/components/dashboard/events/event-trend-chart";
import type { TrendChartPoint } from "@/lib/dashboard/trend-chart-data";
import type { MailchimpSnapshotRow } from "@/lib/mailchimp/compute-registrations";

/**
 * components/shared/venue-trend-chart.tsx
 *
 * Thin wrapper around `EventTrendChart` (LegacyTrendChart path) that
 * consolidates the Mailchimp snapshot fetch in one place.
 *
 * Before this component existed, two surfaces each duplicated the same
 * `useState + useEffect → fetch /api/events/:id/mailchimp/snapshots`
 * block:
 *   - components/share/venue-daily-report-block.tsx `VenueTrendChartSection`
 *   - components/share/client-portal-venue-table.tsx `VenueSection`
 *
 * Now both delegate here. Adding a new chart series only requires
 * touching `LegacyTrendChart`'s `METRICS` array — the fetch machinery
 * and auto-enable logic propagate automatically.
 *
 * The `BrandCampaignTrendChart` path (kind="brand_campaign") is
 * intentionally separate — it shows the full launch timeline and is not
 * the venue-report chart. `EventTrendChart` routes to that variant when
 * `kind` is supplied; this wrapper never sets `kind`, so it always
 * renders `LegacyTrendChart`.
 */
export interface VenueTrendChartProps {
  /** Pre-built per-day spend/tickets/revenue/clicks points. */
  points: TrendChartPoint[];
  /** Chart section title. Defaults to "Daily trend". */
  title?: string;
  /** Optional className forwarded to the chart card. */
  className?: string;
  /**
   * When set, the component fetches Mailchimp snapshots from
   * `/api/events/{eventId}/mailchimp/snapshots` and passes them to
   * `EventTrendChart`, enabling the Registrations + CPR series.
   *
   * Supply both or neither — if either is absent the fetch is skipped
   * and the chart renders without Mailchimp data.
   */
  mailchimpTag?: string | null;
  /** Primary event ID used to fetch Mailchimp snapshots. */
  eventId?: string | null;
  /**
   * Pre-resolved snapshots. When provided, the component skips the
   * client-side fetch entirely. Useful when the parent already holds
   * the rows (e.g. share report page-level data load).
   */
  mailchimpSnapshots?: MailchimpSnapshotRow[];
}

export function VenueTrendChart({
  points,
  title,
  className,
  mailchimpTag,
  eventId,
  mailchimpSnapshots: snapshotsProp,
}: VenueTrendChartProps) {
  const [fetchedSnapshots, setFetchedSnapshots] = useState<
    MailchimpSnapshotRow[] | undefined
  >(undefined);

  useEffect(() => {
    // Skip fetch if the caller provided snapshots directly, or if the
    // tag / event ID are missing.
    if (snapshotsProp !== undefined) return;
    if (!mailchimpTag || !eventId) return;

    fetch(
      `/api/events/${encodeURIComponent(eventId)}/mailchimp/snapshots`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          rows?: MailchimpSnapshotRow[];
        };
        if (json.ok && Array.isArray(json.rows) && json.rows.length > 0) {
          setFetchedSnapshots(json.rows);
        }
      })
      .catch(() => {});
  }, [mailchimpTag, eventId, snapshotsProp]);

  const mailchimpSnapshots = snapshotsProp ?? fetchedSnapshots;

  return (
    <EventTrendChart
      points={points}
      title={title}
      className={className}
      mailchimpSnapshots={mailchimpSnapshots}
    />
  );
}
