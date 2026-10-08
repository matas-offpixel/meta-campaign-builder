/**
 * Ad set facts the insights row does not carry. Under OUTCOME_SALES the
 * row says OFFSITE_CONVERSIONS for Complete Registration and Purchase
 * alike; the event is on the ad set's promoted_object (probe 2026-10-08).
 *
 * One batched `GET /?ids=…` per ≤50 ad set ids, one attempt each. The
 * nightly run reads only ad sets whose promoted event it does not
 * already have, in this run or on ad_daily_insights, so a steady state
 * costs about zero extra calls.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { GraphGet } from "./fetch.ts";

export const ADSET_BATCH = 50;

export type AdSetMeta = {
  campaignObjective: string | null;
  optimizationGoal: string | null;
  promotedEvent: string | null;
};

type RawAdSet = {
  optimization_goal?: string;
  promoted_object?: { custom_event_type?: string };
  campaign?: { objective?: string };
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Batched read of `fields` for `ids`. Stops at the first failed call and
 * returns what it has; every call made is counted.
 */
export async function fetchAdSetMeta(
  graphGet: GraphGet,
  ids: readonly string[],
  fields: string,
): Promise<{ meta: Map<string, AdSetMeta>; calls: number; error?: string; code?: number }> {
  const meta = new Map<string, AdSetMeta>();
  let calls = 0;
  for (let start = 0; start < ids.length; start += ADSET_BATCH) {
    const chunk = ids.slice(start, start + ADSET_BATCH);
    calls++;
    let body: unknown;
    try {
      body = await graphGet("/", { ids: chunk.join(","), fields });
    } catch (err) {
      const code = (err as { code?: unknown })?.code;
      return {
        meta,
        calls,
        error: err instanceof Error ? err.message : String(err),
        ...(typeof code === "number" ? { code } : {}),
      };
    }
    const byId = (body ?? {}) as Record<string, RawAdSet | undefined>;
    for (const id of chunk) {
      const row = byId[id];
      if (!row) continue;
      meta.set(id, {
        campaignObjective: text(row.campaign?.objective),
        optimizationGoal: text(row.optimization_goal),
        promotedEvent: text(row.promoted_object?.custom_event_type),
      });
    }
  }
  return { meta, calls };
}

const DB_ID_CHUNK = 50;
const DB_PAGE = 1000;

type StoredEvent = { meta_adset_id: string | null; promoted_event: string | null };

/**
 * meta_adset_id → stored non-null promoted_event, for every id that has
 * one. PostgREST has no DISTINCT, so each page drops the ad sets already
 * found and asks again for the rest: every page finds at least one new ad
 * set, and an ad set with thousands of ad-days cannot push another out.
 * A read error throws; the caller treats those ids as unknown.
 */
export async function readStoredPromotedEvents(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let start = 0; start < ids.length; start += DB_ID_CHUNK) {
    let remaining = ids.slice(start, start + DB_ID_CHUNK);
    while (remaining.length > 0) {
      const { data, error } = await db
        .from("ad_daily_insights")
        .select("meta_adset_id, promoted_event")
        .in("meta_adset_id", remaining)
        .not("promoted_event", "is", null)
        .order("meta_adset_id")
        .limit(DB_PAGE);
      if (error) throw new Error(`ad_daily_insights promoted_event read: ${error.message}`);
      const rows = (data ?? []) as StoredEvent[];
      for (const row of rows) {
        if (row.meta_adset_id && row.promoted_event && !found.has(row.meta_adset_id)) {
          found.set(row.meta_adset_id, row.promoted_event);
        }
      }
      if (rows.length < DB_PAGE) break;
      const next = remaining.filter((id) => !found.has(id));
      if (next.length === remaining.length) throw new Error("ad_daily_insights promoted_event read made no progress");
      remaining = next;
    }
  }
  return found;
}

/**
 * Per-run promoted event map. `resolve` reads the events already on
 * ad_daily_insights, then asks Meta for the rest. `eventOf` returns only
 * an event known this run; anything else is undefined and the runner
 * leaves the column out of the upsert, so a stored value is never
 * overwritten with NULL. Unknown covers: a stored read that failed (Meta
 * is not asked for those ids), Meta answering with no promoted event,
 * and Meta reads stopped after a failed call (the next run retries).
 */
export function createPromotedEventLookup(db: SupabaseClient, graphGet: GraphGet) {
  const events = new Map<string, string>();
  const settled = new Set<string>();
  let stopped = false;

  return {
    async resolve(adsetIds: readonly string[]): Promise<{ calls: number; error?: string; storedReadError?: string }> {
      const unknown = [...new Set(adsetIds)].filter((id) => !settled.has(id));
      if (unknown.length === 0) return { calls: 0 };
      let stored: Map<string, string>;
      try {
        stored = await readStoredPromotedEvents(db, unknown);
      } catch (err) {
        const storedReadError = err instanceof Error ? err.message : String(err);
        console.error(`[ad-daily-insights] ${storedReadError}; ${unknown.length} ad sets left unknown this run`);
        return { calls: 0, storedReadError };
      }
      for (const [id, event] of stored) {
        events.set(id, event);
        settled.add(id);
      }
      const missing = unknown.filter((id) => !settled.has(id));
      if (missing.length === 0 || stopped) return { calls: 0 };
      const fetched = await fetchAdSetMeta(graphGet, missing, "promoted_object");
      for (const [id, meta] of fetched.meta) {
        settled.add(id);
        if (meta.promotedEvent) events.set(id, meta.promotedEvent);
      }
      if (fetched.error) stopped = true;
      return { calls: fetched.calls, ...(fetched.error ? { error: fetched.error } : {}) };
    },
    eventOf(adsetId: string | null): string | undefined {
      return adsetId ? events.get(adsetId) : undefined;
    },
  };
}
