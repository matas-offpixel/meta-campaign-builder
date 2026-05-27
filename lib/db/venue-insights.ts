import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveCanonicalVenueTicketsSoldInWindow } from "@/lib/db/canonical-tickets-resolver";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * Venue (multi-event) "tickets sold in window" stat used by the
 * `<VenueLiveReportInsights>` panel + the public venue share page.
 *
 * Delegates to `resolveCanonicalVenueTicketsSoldInWindow` so manual-
 * cadence venues (KOC and future) surface
 * `tier_channel_sales.tickets_sold` as authoritative; API venues
 * (Brighton) keep the rollup-sum behaviour because no manual_backfill
 * rows are present.
 */
export async function sumVenueTicketsSoldInWindow(
  supabase: SupabaseClient,
  eventIds: string[],
  datePreset: DatePreset,
  customRange?: CustomDateRange,
): Promise<number | null> {
  return resolveCanonicalVenueTicketsSoldInWindow(
    supabase,
    eventIds,
    datePreset,
    customRange,
  );
}
