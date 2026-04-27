import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { upsertAllocatedSpendRollups } from "@/lib/db/event-daily-rollups";
import { fetchVenueDailyAdMetrics } from "@/lib/insights/meta";
import {
  allocateVenueSpend,
  type AllocatorAd,
  type AllocatorEvent,
} from "@/lib/dashboard/venue-spend-allocation";

/**
 * lib/dashboard/venue-spend-allocator.ts
 *
 * Thin server-side wrapper that turns the per-venue spend allocator
 * (which is pure — see lib/dashboard/venue-spend-allocation.ts) into
 * a side-effectful runner:
 *
 *   1. Look up every event in the venue (same `event_code` + same
 *      `event_date`, under the same `client_id`).
 *   2. Pull ad-level daily insights from Meta for the bracketed
 *      `[event_code]`.
 *   3. For each calendar day with any ad activity, run the pure
 *      allocator → per-event `(specific, generic_share, allocated)`.
 *   4. Upsert the result into `event_daily_rollups`'s three PR D2
 *      columns (ad_spend_allocated, ad_spend_specific,
 *      ad_spend_generic_share).
 *
 * Called from `runRollupSyncForEvent` after the Meta leg succeeds —
 * it's a deliberate superset of the existing campaign-level rollup
 * (both are keyed by event_code) so the two can share a diagnostic
 * scope in logs without a bespoke cross-process contract.
 *
 * Why we refetch instead of reusing the campaign-level fetch:
 *
 *   The campaign-level helper aggregates daily spend into one
 *   number per day per campaign. The allocator needs per-AD spend
 *   to classify by ad name — there's no way to back-derive it from
 *   the campaign-level aggregate. Both fetches hit the same
 *   endpoint with the same filter + similar fields; Meta returns
 *   both within a couple of seconds for a typical venue.
 *
 * Why we run after the Meta leg rather than in parallel:
 *
 *   The Meta leg writes `ad_spend` (raw venue total per-event). The
 *   allocator writes the SAME row's allocation columns. Running
 *   serially means the allocator can safely upsert without
 *   conflicting on the row's created_at / updated_at dance. The
 *   cost is a small added serial latency on the sync — an extra
 *   1-3s for typical venues.
 */

export interface VenueAllocatorInput {
  /** Service-role or owner-session Supabase client. */
  supabase: SupabaseClient;
  /** The OWNING user_id of the events. Written on insert; does
   *  NOT bypass RLS (the caller is responsible for picking the
   *  right client). */
  userId: string;
  /** client_id scoping the sibling lookup so we don't accidentally
   *  match another client's events that also share the event_code
   *  by coincidence. */
  clientId: string;
  /** Bracket-naked event_code, e.g. "WC26-BRIGHTON". The matcher
   *  wraps it in brackets. */
  eventCode: string;
  /** YYYY-MM-DD `events.event_date` shared by the venue siblings.
   *  Null short-circuits with reason="no_event_date" — can't
   *  group without a date. */
  eventDate: string | null;
  /** "act_…" prefixed ad account id. Null short-circuits the
   *  fetch. */
  adAccountId: string | null;
  /** Meta OAuth token for the owning user. */
  token: string;
  /** YYYY-MM-DD inclusive lower bound for the Meta fetch window.
   *  Kept identical to the parent rollup-sync window so the two
   *  upsert sets cover the same rows. */
  since: string;
  /** YYYY-MM-DD inclusive upper bound for the Meta fetch window. */
  until: string;
}

export interface VenueAllocatorResult {
  ok: boolean;
  /** Short reason code when ok=false. Stable strings for alert
   *  routing / dashboards — never human-facing. */
  reason?:
    | "no_event_code"
    | "no_event_date"
    | "no_ad_account"
    | "no_siblings"
    | "solo_event_skipped"
    | "meta_fetch_failed"
    | "upsert_failed";
  /** Human-safe error text for the route handler to pass through. */
  error?: string;
  /** Sibling events in the venue — stable id order. */
  venueEventIds: string[];
  /** Distinct ad names that survived the bracketed-code filter.
   *  Diagnostics only. */
  adNames: string[];
  /** Rows written across all events × days. */
  rowsWritten: number;
  /** Per-event lifetime totals — surfaced so the caller can log
   *  the reconciliation in one line (this is also what the
   *  verification step reads to confirm Brighton's Croatia row
   *  has the larger allocation). */
  perEventLifetime: Array<{
    eventId: string;
    specific: number;
    genericShare: number;
    allocated: number;
  }>;
  /** Date window that was fetched. */
  windowSince: string;
  windowUntil: string;
}

const EMPTY_RESULT = (
  partial: Partial<VenueAllocatorResult> = {},
): VenueAllocatorResult => ({
  ok: false,
  venueEventIds: [],
  adNames: [],
  rowsWritten: 0,
  perEventLifetime: [],
  windowSince: "",
  windowUntil: "",
  ...partial,
});

/**
 * Allocate venue spend for one event_code + event_date pair.
 *
 * Returns a normal result (never throws) so the parent runner can
 * log per-leg diagnostics and continue — allocator failure never
 * fails the sync (the existing `ad_spend` column stays populated
 * as a fallback, and the reporting layer handles the NULL case).
 */
export async function allocateVenueSpendForCode(
  input: VenueAllocatorInput,
): Promise<VenueAllocatorResult> {
  const {
    supabase,
    userId,
    clientId,
    eventCode,
    eventDate,
    adAccountId,
    token,
    since,
    until,
  } = input;

  if (!eventCode || !eventCode.trim()) {
    return EMPTY_RESULT({
      reason: "no_event_code",
      error: "Event has no event_code set.",
      windowSince: since,
      windowUntil: until,
    });
  }
  if (!eventDate) {
    return EMPTY_RESULT({
      reason: "no_event_date",
      error: "Event has no event_date set.",
      windowSince: since,
      windowUntil: until,
    });
  }
  if (!adAccountId) {
    return EMPTY_RESULT({
      reason: "no_ad_account",
      error: "Client has no Meta ad account linked.",
      windowSince: since,
      windowUntil: until,
    });
  }

  // Sibling lookup — every event at this venue. `event_date` is
  // included in the key so a venue that happens to reuse the same
  // event_code across two tour dates (rare, but possible) stays
  // split across two allocation passes.
  const client = supabase as unknown as SupabaseClient;
  const { data: siblings, error: siblingsErr } = await (client as any)
    .from("events")
    .select("id, name")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .eq("event_date", eventDate);
  if (siblingsErr) {
    return EMPTY_RESULT({
      reason: "upsert_failed",
      error: siblingsErr.message,
      windowSince: since,
      windowUntil: until,
    });
  }
  const siblingRows = (siblings ?? []) as Array<{ id: string; name: string | null }>;
  if (siblingRows.length === 0) {
    return EMPTY_RESULT({
      reason: "no_siblings",
      error: "No events found for this (client, event_code, event_date).",
      windowSince: since,
      windowUntil: until,
    });
  }
  // Solo-event venues are a no-op for allocation: all ad spend is
  // effectively generic and the single event receives 100% of it,
  // which is exactly what the existing `ad_spend` column already
  // says. Skip the extra Meta fetch + upsert and keep the rollup
  // reader on the fallback path.
  if (siblingRows.length === 1) {
    return EMPTY_RESULT({
      ok: true,
      reason: "solo_event_skipped",
      venueEventIds: [siblingRows[0].id],
      windowSince: since,
      windowUntil: until,
    });
  }

  // Stable order used by the allocator for tie-breaks.
  const allocatorEvents: AllocatorEvent[] = siblingRows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, name: r.name ?? null }));

  // Pull ad-level daily insights for the bracketed event_code. The
  // fetch spans the parent runner's window so the two writes cover
  // the same date rows. Meta returns zero rows when no ads are live
  // yet — the allocator handles that cleanly (returns empty
  // perEvent allocations, which we then DON'T upsert).
  const adFetch = await fetchVenueDailyAdMetrics({
    eventCode,
    adAccountId,
    token,
    since,
    until,
  });
  if (!adFetch.ok) {
    return EMPTY_RESULT({
      reason: "meta_fetch_failed",
      error: adFetch.error.message,
      venueEventIds: allocatorEvents.map((e) => e.id),
      windowSince: since,
      windowUntil: until,
    });
  }

  // Bucket ad rows by day so the pure allocator can run one pass
  // per date. Map key is YYYY-MM-DD; value is the list of per-ad
  // spend for that day.
  const byDay = new Map<string, AllocatorAd[]>();
  for (const row of adFetch.rows) {
    const list = byDay.get(row.day) ?? [];
    list.push({ id: row.adId, name: row.adName, spend: row.spend });
    byDay.set(row.day, list);
  }

  // Per-event running totals for the lifetime diagnostic.
  const lifetimeSpecific = new Map<string, number>();
  const lifetimeGenericShare = new Map<string, number>();
  const lifetimeAllocated = new Map<string, number>();

  // Grouped by eventId so the upsert can run one call per event
  // (Supabase's upsert is keyed on (event_id, date), so batching
  // across events in a single payload would require onConflict
  // resolution Supabase doesn't support cleanly — one upsert per
  // event keeps the failure scope local).
  const upsertPayloads = new Map<
    string,
    Array<{
      date: string;
      ad_spend_allocated: number;
      ad_spend_specific: number;
      ad_spend_generic_share: number;
    }>
  >();

  for (const [day, ads] of byDay) {
    const result = allocateVenueSpend(allocatorEvents, ads);
    for (const r of result.perEvent) {
      lifetimeSpecific.set(
        r.eventId,
        (lifetimeSpecific.get(r.eventId) ?? 0) + r.specific,
      );
      lifetimeGenericShare.set(
        r.eventId,
        (lifetimeGenericShare.get(r.eventId) ?? 0) + r.genericShare,
      );
      lifetimeAllocated.set(
        r.eventId,
        (lifetimeAllocated.get(r.eventId) ?? 0) + r.allocated,
      );
      const list = upsertPayloads.get(r.eventId) ?? [];
      list.push({
        date: day,
        ad_spend_allocated: round2(r.allocated),
        ad_spend_specific: round2(r.specific),
        ad_spend_generic_share: round2(r.genericShare),
      });
      upsertPayloads.set(r.eventId, list);
    }
  }

  let rowsWritten = 0;
  for (const [eventId, rows] of upsertPayloads) {
    if (rows.length === 0) continue;
    try {
      await upsertAllocatedSpendRollups(supabase, {
        userId,
        eventId,
        rows,
      });
      rowsWritten += rows.length;
    } catch (err) {
      return EMPTY_RESULT({
        reason: "upsert_failed",
        error: err instanceof Error ? err.message : "Unknown error",
        venueEventIds: allocatorEvents.map((e) => e.id),
        adNames: adFetch.adNames,
        rowsWritten,
        perEventLifetime: toLifetime(
          allocatorEvents,
          lifetimeSpecific,
          lifetimeGenericShare,
          lifetimeAllocated,
        ),
        windowSince: since,
        windowUntil: until,
      });
    }
  }

  return {
    ok: true,
    venueEventIds: allocatorEvents.map((e) => e.id),
    adNames: adFetch.adNames,
    rowsWritten,
    perEventLifetime: toLifetime(
      allocatorEvents,
      lifetimeSpecific,
      lifetimeGenericShare,
      lifetimeAllocated,
    ),
    windowSince: since,
    windowUntil: until,
  };
}

function toLifetime(
  events: readonly AllocatorEvent[],
  specific: Map<string, number>,
  genericShare: Map<string, number>,
  allocated: Map<string, number>,
): VenueAllocatorResult["perEventLifetime"] {
  return events.map((e) => ({
    eventId: e.id,
    specific: round2(specific.get(e.id) ?? 0),
    genericShare: round2(genericShare.get(e.id) ?? 0),
    allocated: round2(allocated.get(e.id) ?? 0),
  }));
}

function round2(n: number): number {
  // Two decimal places — matches numeric(12, 2) on the column.
  // Also keeps the diagnostic logs readable (without this, a
  // generic share of £561.60 shows up as 561.5999999999).
  return Math.round(n * 100) / 100;
}
