import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/db/event-code-lifetime-meta-cache.ts
 *
 * Server-side CRUD for `event_code_lifetime_meta_cache` (migration 068).
 * One row per `(client_id, event_code)` holding the campaign-window
 * deduplicated lifetime Meta totals — Reach is the headline use-case
 * (PR #414, Plan PR for venue-card vs Meta-UI reconciliation).
 *
 * Why this lives in its own file rather than alongside
 * `event-daily-rollups.ts`:
 *   - Different write cadence (once per `(client_id, event_code)` per
 *     cron tick, not per-event-per-day).
 *   - Different read semantics (one number per venue, not a per-day
 *     timeseries).
 *   - Smaller surface — keeping it focused makes the
 *     "what's deduplicated-lifetime?" rule easy to find.
 *
 * Like `event-daily-rollups.ts`, queries go through an `as any` cast
 * because `lib/db/database.types.ts` is regenerated separately and
 * doesn't carry every recent migration.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAny(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

export interface EventCodeLifetimeMetaCacheRow {
  client_id: string;
  event_code: string;
  meta_reach: number | null;
  meta_impressions: number | null;
  meta_link_clicks: number | null;
  meta_regs: number | null;
  meta_video_plays_3s: number | null;
  meta_video_plays_15s: number | null;
  meta_video_plays_p100: number | null;
  meta_engagements: number | null;
  campaign_names: string[];
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

/** Subset of writeable fields. `created_at` / `updated_at` are managed
 *  by the trigger, `fetched_at` we set explicitly to `now()` on every
 *  upsert so the cron freshness probe is unambiguous.
 *
 *  Note: `clientId` / `eventCode` use camelCase to match the rest of
 *  the call-site argument idiom (`fetchEventLifetimeMetaMetrics`
 *  uses `eventCode` / `adAccountId`); the column-level fields stay
 *  snake_case so the upsert payload threads straight to PostgREST. */
export interface EventCodeLifetimeMetaCacheUpsert {
  clientId: string;
  eventCode: string;
  meta_reach: number | null;
  meta_impressions: number | null;
  meta_link_clicks: number | null;
  meta_regs: number | null;
  meta_video_plays_3s: number | null;
  meta_video_plays_15s: number | null;
  meta_video_plays_p100: number | null;
  meta_engagements: number | null;
  campaign_names: string[];
}

/**
 * Read the cached lifetime totals for a single `(client_id, event_code)`
 * pair. Returns `null` when no row exists (cron hasn't written yet, or
 * the venue has no matching campaigns). Surface as the venue-card
 * "Reach" cell when present; the page falls back to `—` otherwise.
 */
export async function loadEventCodeLifetimeMetaCache(
  supabase: AnySupabaseClient,
  args: { clientId: string; eventCode: string },
): Promise<EventCodeLifetimeMetaCacheRow | null> {
  const { data, error } = await asAny(supabase)
    .from("event_code_lifetime_meta_cache")
    .select(
      "client_id, event_code, meta_reach, meta_impressions, meta_link_clicks, meta_regs, meta_video_plays_3s, meta_video_plays_15s, meta_video_plays_p100, meta_engagements, campaign_names, fetched_at, created_at, updated_at",
    )
    .eq("client_id", args.clientId)
    .eq("event_code", args.eventCode)
    .maybeSingle();

  if (error) {
    console.warn(
      `[event-code-lifetime-meta-cache] read failed client_id=${args.clientId} event_code=${args.eventCode} error=${error.message}`,
    );
    return null;
  }
  if (!data) return null;
  return normaliseRow(data);
}

/**
 * Bulk-load the cache for every `event_code` belonging to a client.
 * Used by `loadPortalForClientId` so the venue payload carries the
 * cached totals without N+1ing the cache table per venue.
 */
export async function loadEventCodeLifetimeMetaCacheForClient(
  supabase: AnySupabaseClient,
  clientId: string,
): Promise<EventCodeLifetimeMetaCacheRow[]> {
  const { data, error } = await asAny(supabase)
    .from("event_code_lifetime_meta_cache")
    .select(
      "client_id, event_code, meta_reach, meta_impressions, meta_link_clicks, meta_regs, meta_video_plays_3s, meta_video_plays_15s, meta_video_plays_p100, meta_engagements, campaign_names, fetched_at, created_at, updated_at",
    )
    .eq("client_id", clientId);

  if (error) {
    console.warn(
      `[event-code-lifetime-meta-cache] bulk read failed client_id=${clientId} error=${error.message}`,
    );
    return [];
  }
  return (data ?? []).map(normaliseRow);
}

/**
 * Upsert one cache row. Idempotent — re-running with the same totals
 * leaves the row unchanged except for `fetched_at` (refreshed to
 * `now()`) and `updated_at` (managed by the trigger).
 *
 * `campaign_names` is stored as a JSONB array of distinct strings;
 * callers should pass the sorted distinct list returned by
 * `fetchEventLifetimeMetaMetrics`.
 */
export async function upsertEventCodeLifetimeMetaCache(
  supabase: AnySupabaseClient,
  args: EventCodeLifetimeMetaCacheUpsert,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fetchedAt = new Date().toISOString();
  const { error } = await asAny(supabase)
    .from("event_code_lifetime_meta_cache")
    .upsert(
      {
        client_id: args.clientId,
        event_code: args.eventCode,
        meta_reach: args.meta_reach,
        meta_impressions: args.meta_impressions,
        meta_link_clicks: args.meta_link_clicks,
        meta_regs: args.meta_regs,
        meta_video_plays_3s: args.meta_video_plays_3s,
        meta_video_plays_15s: args.meta_video_plays_15s,
        meta_video_plays_p100: args.meta_video_plays_p100,
        meta_engagements: args.meta_engagements,
        campaign_names: args.campaign_names,
        fetched_at: fetchedAt,
      },
      { onConflict: "client_id,event_code" },
    );

  if (error) {
    console.error(
      `[event-code-lifetime-meta-cache] upsert failed clientId=${args.clientId} eventCode=${args.eventCode} error=${error.message}`,
    );
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Returns true when the cache row for `(clientId, eventCode)` was
 * fetched within `freshnessSeconds`. Used by the rollup-sync runner to
 * skip the lifetime fetch on the 2nd / 3rd / 4th sibling event of a
 * multi-fixture venue within the same cron tick — the first sibling
 * populates the cache, the rest see it fresh and short-circuit.
 *
 * Returns false on read errors (defensive — better one extra Meta call
 * than a stale value). `freshnessSeconds` defaults to 30 minutes,
 * comfortably under the cron cadence (every 6 hours) AND the typical
 * 4-event venue sync duration.
 */
export async function isEventCodeLifetimeMetaCacheFresh(
  supabase: AnySupabaseClient,
  args: {
    clientId: string;
    eventCode: string;
    freshnessSeconds?: number;
  },
): Promise<boolean> {
  const freshnessSeconds = args.freshnessSeconds ?? 30 * 60;
  const cutoffIso = new Date(
    Date.now() - freshnessSeconds * 1000,
  ).toISOString();

  const { data, error } = await asAny(supabase)
    .from("event_code_lifetime_meta_cache")
    .select("fetched_at")
    .eq("client_id", args.clientId)
    .eq("event_code", args.eventCode)
    .gte("fetched_at", cutoffIso)
    .maybeSingle();

  if (error) return false;
  return data != null;
}

function normaliseRow(raw: unknown): EventCodeLifetimeMetaCacheRow {
  const r = raw as Record<string, unknown>;
  return {
    client_id: String(r.client_id ?? ""),
    event_code: String(r.event_code ?? ""),
    meta_reach: numericOrNull(r.meta_reach),
    meta_impressions: numericOrNull(r.meta_impressions),
    meta_link_clicks: numericOrNull(r.meta_link_clicks),
    meta_regs: numericOrNull(r.meta_regs),
    meta_video_plays_3s: numericOrNull(r.meta_video_plays_3s),
    meta_video_plays_15s: numericOrNull(r.meta_video_plays_15s),
    meta_video_plays_p100: numericOrNull(r.meta_video_plays_p100),
    meta_engagements: numericOrNull(r.meta_engagements),
    campaign_names: Array.isArray(r.campaign_names)
      ? r.campaign_names.filter((s): s is string => typeof s === "string")
      : [],
    fetched_at: String(r.fetched_at ?? new Date(0).toISOString()),
    created_at: String(r.created_at ?? new Date(0).toISOString()),
    updated_at: String(r.updated_at ?? new Date(0).toISOString()),
  };
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
