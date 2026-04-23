import type { SupabaseClient } from "@supabase/supabase-js";

import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

/**
 * lib/db/active-creatives-snapshots.ts
 *
 * Read + write helpers for `active_creatives_snapshots` (migration
 * 041). The table is the snapshot-first cache for the public share
 * report's "Active creatives" section — a row per
 * `(event_id, date_preset, custom_since, custom_until)` carrying the
 * full `ShareActiveCreativesResult` so the share render path can
 * serve from Postgres without ever fanning out to Meta.
 *
 * Architectural rationale lives in
 * `docs/META_INDEPENDENCE_RESEARCH.md` — TL;DR: user-triggered Meta
 * fan-outs on a cold cache caused 80004 account-wide rate-limit
 * lockouts; moving share-page reads onto a cron-populated snapshot
 * eliminates that traffic shape entirely.
 *
 * Why no `import "server-only"` directive
 *   The two main exports take a `SupabaseClient` as input — they
 *   don't read env vars, don't touch process / fs, and never
 *   construct a service-role client of their own. Skipping the
 *   directive keeps the module importable from
 *   `node --experimental-strip-types` for unit tests (Next's
 *   `server-only` shim doesn't resolve in raw Node). Server-only
 *   enforcement still happens at the call site: the only consumers
 *   are the share-report page, the cron route, and the internal
 *   refresh route — all server-component / route-handler files —
 *   and the migration's RLS policy is `false` for everyone, so a
 *   hypothetical client-side import wouldn't be able to read or
 *   write rows even if it tried.
 *
 * Two read shapes by design:
 *   - `readActiveCreativesSnapshot` returns the row regardless of
 *     `expires_at` so the share page can serve last-good with a
 *     stale banner. Freshness is reported on the returned record
 *     (`isStale`, `ageMs`) and via `isSnapshotFresh` so callers
 *     stay declarative.
 *   - The TTL is advisory for the BACKGROUND refresher, not a
 *     bust-on-expiry for readers. Differs from
 *     `share-snapshots.ts`, where TTL doubles as both — the
 *     active-creatives payload is too expensive to refetch on
 *     read, so we never gate the read on it.
 *
 * Access model
 *   Service role only. Mirrors `share-snapshots.ts`. The migration's
 *   RLS policy is `false` for everyone — defensive backstop in case
 *   a future refactor accidentally swaps in a user-scoped client.
 */

const TABLE = "active_creatives_snapshots";

/**
 * Default cron cadence. Matches the cron entry
 * (`15 / every 6 hours`) in `vercel.json` — one refresh per
 * event × preset every six hours.
 */
export const ACS_DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Tightened cadence used when `events.event_date` is within 14 days.
 * Inside the show-week window the per-event request budget is
 * cheap to spend and operators want fresher numbers. The cron
 * runner is responsible for choosing between the two — the table
 * doesn't know its own cadence.
 */
export const ACS_TIGHT_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Cache key. NULL custom_since / custom_until are correct for every
 * non-custom preset — the unique constraint is NULLS NOT DISTINCT
 * (migration 041), so two preset rows for the same `(event_id,
 * date_preset)` collide on upsert.
 */
export interface ActiveCreativesSnapshotKey {
  eventId: string;
  datePreset: DatePreset;
  /** Required when `datePreset === "custom"`; ignored otherwise. */
  customRange?: CustomDateRange;
}

/**
 * Resolved snapshot row. `payload` is the full
 * `ShareActiveCreativesResult` round-trip — the share page can
 * pass it straight into `<ShareActiveCreativesSection>` without
 * any post-processing.
 *
 * `isStale` is the raw column value. Callers should also consult
 * `isSnapshotFresh(record)` which combines `isStale` with the
 * `expiresAt` clock — a row can be still-fresh by clock yet
 * marked stale by an in-flight refresh, in which case readers
 * should serve it but skip kicking another background fetch.
 */
export interface ActiveCreativesSnapshotRecord {
  payload: ShareActiveCreativesResult;
  fetchedAt: Date;
  expiresAt: Date;
  isStale: boolean;
  /** ms since the row was written. Diagnostic only — drives the
   *  "[active-creatives-snapshots] hit" log line. */
  ageMs: number;
}

interface CacheRow {
  payload: ShareActiveCreativesResult;
  fetched_at: string;
  expires_at: string;
  is_stale: boolean;
}

/**
 * Look up the most recent snapshot for the given key.
 *
 * Returns null on:
 *   - no matching row (cron hasn't populated yet, brand-new event),
 *   - any DB error (we'd rather fall through to the live-fetch
 *     fallback path than 500 the share page).
 *
 * Does NOT gate on `expires_at` — the share page wants the row
 * even if it's expired, so the stale-while-revalidate banner can
 * render with a refresh button. Use `isSnapshotFresh(record)` to
 * decide whether the background refresher should be kicked.
 *
 * NULL filter dance: PostgREST translates `.eq(col, null)` to
 * `WHERE col = NULL` (always false in SQL three-valued logic), so
 * we use `.is(col, null)` for the IS NULL case and `.eq` only
 * when we have a real value. Same fix migration 037 applied to
 * share-snapshots — the unique constraint is NULLS NOT DISTINCT,
 * but the read filter still has to use the right operator.
 */
export async function readActiveCreativesSnapshot(
  supabase: SupabaseClient,
  key: ActiveCreativesSnapshotKey,
): Promise<ActiveCreativesSnapshotRecord | null> {
  // Cast through `any` because regenerated Supabase types haven't
  // caught up with migration 041 on every checkout. Same pattern
  // as `lib/db/share-snapshots.ts`. Contained to this module so
  // callers see the typed surface only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  let q = sb
    .from(TABLE)
    .select("payload, fetched_at, expires_at, is_stale")
    .eq("event_id", key.eventId)
    .eq("date_preset", key.datePreset);
  q = key.customRange
    ? q.eq("custom_since", key.customRange.since)
    : q.is("custom_since", null);
  q = key.customRange
    ? q.eq("custom_until", key.customRange.until)
    : q.is("custom_until", null);
  const { data, error } = await q
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[active-creatives-snapshots] read failed", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as CacheRow;
  const fetchedAt = new Date(row.fetched_at);
  const expiresAt = new Date(row.expires_at);
  const fetchedMs = fetchedAt.getTime();
  const ageMs = Number.isFinite(fetchedMs)
    ? Math.max(0, Date.now() - fetchedMs)
    : 0;

  return {
    payload: row.payload,
    fetchedAt,
    expiresAt,
    isStale: row.is_stale,
    ageMs,
  };
}

/**
 * Upsert the snapshot row, conflicting on
 * `(event_id, date_preset, custom_since, custom_until)`. Sets
 * `expires_at = now + ttlMs` and clears `is_stale` (so a
 * follow-up refresh that succeeds replaces the stale flag set
 * by the in-flight marker).
 *
 * Refusal contract — `kind === "ok"` only.
 *   `skip` and `error` results are NOT written. Overwriting a
 *   good snapshot with a transient skip / error response would
 *   make the share page render an empty section or muted "Meta
 *   unavailable" banner the next time it polls — strictly worse
 *   than serving the last-good payload with a stale banner. The
 *   research doc's "stale > unavailable every time" principle.
 *
 * Best-effort by design — we log on failure but never throw,
 * because a cache write failing must not abort the cron loop.
 * The next cron tick will retry.
 */
export async function writeActiveCreativesSnapshot(
  supabase: SupabaseClient,
  key: ActiveCreativesSnapshotKey & { userId: string },
  payload: ShareActiveCreativesResult,
  ttlMs: number,
): Promise<void> {
  if (payload.kind !== "ok") {
    console.warn(
      `[active-creatives-snapshots] refused write event=${key.eventId} preset=${key.datePreset} kind=${payload.kind} — keeping last-good`,
    );
    return;
  }

  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error } = await sb.from(TABLE).upsert(
    {
      event_id: key.eventId,
      user_id: key.userId,
      date_preset: key.datePreset,
      custom_since: key.customRange?.since ?? null,
      custom_until: key.customRange?.until ?? null,
      payload,
      fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttlMs).toISOString(),
      is_stale: false,
      last_refresh_error: null,
    },
    {
      onConflict: "event_id,date_preset,custom_since,custom_until",
    },
  );
  if (error) {
    console.warn("[active-creatives-snapshots] write failed", error.message);
  }
}

/**
 * Mark a snapshot row stale without overwriting its payload.
 * Called by the internal refresh route to claim the in-flight
 * slot before the (slow) Meta fetch — concurrent share-page
 * loads that read after this flip will see `isStale=true` and
 * skip kicking their own background refresh.
 *
 * Best-effort: a failed update means the worst case is a second
 * concurrent refresh, not a wrong render. Log and move on.
 */
export async function markSnapshotStale(
  supabase: SupabaseClient,
  key: ActiveCreativesSnapshotKey,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  let q = sb
    .from(TABLE)
    .update({ is_stale: true })
    .eq("event_id", key.eventId)
    .eq("date_preset", key.datePreset);
  q = key.customRange
    ? q.eq("custom_since", key.customRange.since)
    : q.is("custom_since", null);
  q = key.customRange
    ? q.eq("custom_until", key.customRange.until)
    : q.is("custom_until", null);
  const { error } = await q;
  if (error) {
    console.warn(
      "[active-creatives-snapshots] markStale failed",
      error.message,
    );
  }
}

/**
 * Decide whether a snapshot is fresh enough to skip kicking a
 * background refresh on read. Combines the column-level `isStale`
 * flag with the wall-clock `expiresAt`:
 *
 *   - `isStale = true` always means "not fresh" (someone is
 *     mid-refresh, but we still serve the payload — see
 *     `readActiveCreativesSnapshot` JSDoc).
 *   - Otherwise: fresh iff `expiresAt > now`.
 *
 * `nowMs` is injectable for tests; defaults to `Date.now()`.
 */
export function isSnapshotFresh(
  record: ActiveCreativesSnapshotRecord,
  nowMs: number = Date.now(),
): boolean {
  if (record.isStale) return false;
  const expiresMs = record.expiresAt.getTime();
  if (!Number.isFinite(expiresMs)) return false;
  return expiresMs > nowMs;
}
