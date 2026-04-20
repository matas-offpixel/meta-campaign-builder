/**
 * Shared types for the campaign overview dashboard
 * (lib/db/overview-server.ts → /api/overview → /overview).
 *
 * Lives in `lib/types/` (alongside tiktok.ts / google-ads.ts) so client
 * components can import the shape without dragging in `server-only`.
 */

export type OverviewFilter = "future" | "past";

export interface OverviewClientRef {
  id: string;
  name: string;
  slug: string | null;
  /**
   * Free-text in the DB (`clients.primary_type`); typical values are
   * 'promoter' | 'festival' | 'brand' | 'other'. Treated as opaque
   * here so we don't have to keep this list in sync with the schema.
   */
  primary_type: string | null;
}

export interface OverviewPhaseMarker {
  /** Phase label as stored on `ad_plan_days.phase_marker` or moments. */
  name: string;
  /** YYYY-MM-DD. */
  date: string;
  /**
   * Visual hint for the table pill. Resolved from `name` on the server
   * so client components don't have to re-derive it; keeps colour
   * mapping in one place.
   */
  color: PhasePillColor;
}

export type PhasePillColor =
  | "orange"
  | "green"
  | "blue"
  | "purple"
  | "grey";

export interface OverviewActivity {
  description: string;
  /** YYYY-MM-DD. */
  date: string;
}

/**
 * One row of the campaign overview table.
 *
 * Spend fields (`spend_total`, `spend_yesterday`, `budget_left`,
 * `left_per_day`) are intentionally null on the initial fetch — they
 * cost a Meta Graph round-trip per event so we lazy-load them via
 * GET /api/overview/stats when the user clicks "Load Stats".
 */
export interface OverviewRow {
  event_id: string;
  /** YYYY-MM-DD or null when the date is TBC. */
  event_date: string | null;
  name: string;
  venue_name: string | null;
  venue_city: string | null;
  event_code: string | null;
  capacity: number | null;
  /**
   * Resolved tickets sold using the priority chain:
   *   1. Latest client_report_weekly_snapshots.tickets_sold
   *   2. Latest ad_plan_days.tickets_sold_cumulative
   *   3. events.tickets_sold (legacy override)
   */
  tickets_sold: number | null;
  budget_marketing: number | null;
  /** Negative when `event_date` is in the past. */
  days_until: number | null;
  next_phase: OverviewPhaseMarker | null;
  next_activity: OverviewActivity | null;
  client: OverviewClientRef | null;
  meta_ad_account_id: string | null;
  /** Lazy-loaded fields. Null until /api/overview/stats fills them. */
  spend_total: number | null;
  spend_yesterday: number | null;
  budget_left: number | null;
  left_per_day: number | null;
}

/**
 * Per-event spend payload returned by GET /api/overview/stats.
 * Indexed by event_id so the client component can merge into the
 * existing OverviewRow[] without a positional pairing.
 */
export interface OverviewSpendStats {
  spend_total: number | null;
  spend_yesterday: number | null;
}

export type OverviewSpendResponse = Record<string, OverviewSpendStats>;
