/**
 * lib/dashboard/wc26-london-split.ts
 *
 * WC26 London 3-way spend-split for the shared umbrella campaigns
 * [WC26-LONDON-PRESALE] and [WC26-LONDON-ONSALE].
 *
 * CONTEXT
 * -------
 * Two Meta campaigns drive traffic across THREE London WC26 venues (Tottenham,
 * Shoreditch, Kentish Town). Shepherds Bush has its own dedicated campaigns and
 * is NOT included in this split. Because the campaigns are named after the
 * umbrella codes, their spend lands on synthetic event rows in
 * `event_daily_rollups` and must be redistributed to the actual per-fixture
 * rows before dashboard reporting is accurate.
 *
 *   WC26-LONDON-PRESALE   — presale campaign    (£878 lifetime)
 *   WC26-LONDON-ONSALE    — on-sale campaign     (£1,684 lifetime)
 *
 * TARGET events (3 venues × 4 fixtures = 12 cells):
 *   WC26-LONDON-TOTTENHAM  × {Croatia, Ghana, Panama, Last32}
 *   WC26-LONDON-SHOREDITCH × {Croatia, Ghana, Panama, Last32}
 *   WC26-LONDON-KENTISH    × {Croatia, Ghana, Panama, Last32}
 *
 * SPLIT LOGIC
 * -----------
 * For each calendar day and for each source campaign (PRESALE + ONSALE):
 *   venue_share  = day_spend / 3           (equal thirds to each venue)
 *   fixture_share = venue_share / N_fixtures   (N usually 4, derived from DB)
 *
 * The split is written to `event_daily_rollups.ad_spend_allocated` on each
 * target fixture event. After the split, the source rows receive
 * `ad_spend_allocated = 0` so `metaPaidSpendOf()` returns £0 for them
 * (raw `ad_spend` still holds the Meta total for audit).
 *
 * This mirrors the Glasgow umbrella pattern (lib/dashboard/wc26-glasgow-umbrella.ts)
 * but uses an even-split model rather than a temporal cutover model.
 *
 * USAGE
 * -----
 * Called from `app/api/admin/event-rollup-backfill/route.ts` as a
 * post-processing step after the regular rollup sync.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertAllocatedSpendRollups } from "@/lib/db/event-daily-rollups";
import { FOURTHEFANS_CLIENT_ID } from "@/lib/dashboard/rollup-meta-reconcile-log";

// ─── source event codes ────────────────────────────────────────────────────

export const WC26_LONDON_PRESALE_CODE = "WC26-LONDON-PRESALE";
export const WC26_LONDON_ONSALE_CODE = "WC26-LONDON-ONSALE";

// ─── target venue codes (Shepherds Bush is intentionally excluded) ─────────

export const WC26_LONDON_TARGET_VENUE_CODES = [
  "WC26-LONDON-TOTTENHAM",
  "WC26-LONDON-SHOREDITCH",
  "WC26-LONDON-KENTISH",
] as const;

export type LondonVenueCode = (typeof WC26_LONDON_TARGET_VENUE_CODES)[number];

// ─── result shape ──────────────────────────────────────────────────────────

export interface LondonSplitResult {
  ok: boolean;
  sourceEventsFound: number;
  targetEventsFound: number;
  daysProcessed: number;
  totalRowsUpserted: number;
  sourceRowsZeroed: number;
  error?: string;
}

// ─── implementation ────────────────────────────────────────────────────────

function asAny(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as any;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Run the WC26 London 3-way split backfill.
 *
 * Idempotent: re-running on the same data produces the same allocations.
 * Safe to call after every rollup backfill — it no-ops when the source
 * events have no spend rows.
 */
export async function runWc26LondonSplit(
  supabase: SupabaseClient,
): Promise<LondonSplitResult> {
  // ── 1. Look up source event IDs ─────────────────────────────────────────

  const { data: sourceEvs, error: srcErr } = await asAny(supabase)
    .from("events")
    .select("id, user_id, event_code")
    .eq("client_id", FOURTHEFANS_CLIENT_ID)
    .in("event_code", [WC26_LONDON_PRESALE_CODE, WC26_LONDON_ONSALE_CODE]);

  if (srcErr) {
    return { ok: false, sourceEventsFound: 0, targetEventsFound: 0, daysProcessed: 0, totalRowsUpserted: 0, sourceRowsZeroed: 0, error: srcErr.message };
  }

  const sourceEvents = (sourceEvs ?? []) as Array<{ id: string; user_id: string; event_code: string }>;
  if (sourceEvents.length === 0) {
    return { ok: true, sourceEventsFound: 0, targetEventsFound: 0, daysProcessed: 0, totalRowsUpserted: 0, sourceRowsZeroed: 0 };
  }

  const userId = sourceEvents[0].user_id;
  const sourceIds = sourceEvents.map((e) => e.id);

  // ── 2. Read daily rollup rows for source events ──────────────────────────

  const { data: sourceRollups, error: rollupErr } = await asAny(supabase)
    .from("event_daily_rollups")
    .select("event_id, date, ad_spend")
    .in("event_id", sourceIds)
    .order("date", { ascending: true });

  if (rollupErr) {
    return { ok: false, sourceEventsFound: sourceEvents.length, targetEventsFound: 0, daysProcessed: 0, totalRowsUpserted: 0, sourceRowsZeroed: 0, error: rollupErr.message };
  }

  const dailyRows = (sourceRollups ?? []) as Array<{
    event_id: string;
    date: string;
    ad_spend: number | null;
  }>;

  // Group spend by date across BOTH source campaigns
  const spendByDate = new Map<string, number>();
  for (const row of dailyRows) {
    const spend = typeof row.ad_spend === "number" ? row.ad_spend : 0;
    spendByDate.set(row.date, (spendByDate.get(row.date) ?? 0) + spend);
  }

  if (spendByDate.size === 0) {
    return { ok: true, sourceEventsFound: sourceEvents.length, targetEventsFound: 0, daysProcessed: 0, totalRowsUpserted: 0, sourceRowsZeroed: 0 };
  }

  // ── 3. Look up target events grouped by venue code ───────────────────────

  const { data: targetEvs, error: targetErr } = await asAny(supabase)
    .from("events")
    .select("id, user_id, event_code")
    .eq("client_id", FOURTHEFANS_CLIENT_ID)
    .in("event_code", [...WC26_LONDON_TARGET_VENUE_CODES]);

  if (targetErr) {
    return { ok: false, sourceEventsFound: sourceEvents.length, targetEventsFound: 0, daysProcessed: 0, totalRowsUpserted: 0, sourceRowsZeroed: 0, error: targetErr.message };
  }

  const targetEvents = (targetEvs ?? []) as Array<{ id: string; user_id: string; event_code: string }>;
  if (targetEvents.length === 0) {
    return { ok: true, sourceEventsFound: sourceEvents.length, targetEventsFound: 0, daysProcessed: 0, totalRowsUpserted: 0, sourceRowsZeroed: 0 };
  }

  // Group target events by venue code
  const byVenue = new Map<LondonVenueCode, string[]>();
  for (const ev of targetEvents) {
    const code = ev.event_code as LondonVenueCode;
    if (!byVenue.has(code)) byVenue.set(code, []);
    byVenue.get(code)!.push(ev.id);
  }

  // Total fixture count = sum of events across all 3 venues
  const totalFixtures = [...byVenue.values()].reduce(
    (acc, ids) => acc + ids.length,
    0,
  );
  const numVenues = byVenue.size; // should be 3

  // ── 4. Compute per-fixture allocation and upsert ─────────────────────────

  let totalRowsUpserted = 0;
  const dates = [...spendByDate.keys()].sort();

  for (const [venueCode, fixtureIds] of byVenue) {
    for (const fixtureId of fixtureIds) {
      const allocationRows = dates
        .map((date) => {
          const dayTotal = spendByDate.get(date) ?? 0;
          if (dayTotal === 0) return null;
          // Equal split: 1/numVenues per venue, 1/fixtureIds.length per fixture
          const fixtureShare = round2(
            dayTotal / numVenues / fixtureIds.length,
          );
          return {
            date,
            ad_spend_allocated: fixtureShare,
            ad_spend_specific: fixtureShare,
            ad_spend_generic_share: 0,
            ad_spend_presale: 0,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (allocationRows.length === 0) continue;

      await upsertAllocatedSpendRollups(supabase, {
        userId,
        eventId: fixtureId,
        rows: allocationRows,
      });
      totalRowsUpserted += allocationRows.length;
      console.info(
        `[wc26-london-split] venue=${venueCode} event=${fixtureId} rows=${allocationRows.length} total_allocated=${allocationRows.reduce((s, r) => s + r.ad_spend_allocated, 0).toFixed(2)}`,
      );
    }
  }

  // ── 5. Zero out allocation on source events ──────────────────────────────
  // Writes ad_spend_allocated=0 so metaPaidSpendOf() returns £0 for them.
  // Raw ad_spend is preserved for audit.

  let sourceRowsZeroed = 0;
  for (const sourceEv of sourceEvents) {
    const zeroRows = dates
      .filter((date) => (spendByDate.get(date) ?? 0) > 0)
      .map((date) => ({
        date,
        ad_spend_allocated: 0,
        ad_spend_specific: 0,
        ad_spend_generic_share: 0,
        ad_spend_presale: 0,
      }));

    if (zeroRows.length > 0) {
      await upsertAllocatedSpendRollups(supabase, {
        userId,
        eventId: sourceEv.id,
        rows: zeroRows,
      });
      sourceRowsZeroed += zeroRows.length;
    }
  }

  console.info(
    `[wc26-london-split] done venues=${numVenues} total_fixtures=${totalFixtures} days=${dates.length} rows_upserted=${totalRowsUpserted} source_zeroed=${sourceRowsZeroed}`,
  );

  return {
    ok: true,
    sourceEventsFound: sourceEvents.length,
    targetEventsFound: targetEvents.length,
    daysProcessed: dates.length,
    totalRowsUpserted,
    sourceRowsZeroed,
  };
}
