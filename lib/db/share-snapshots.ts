import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CustomDateRange,
  DatePreset,
  EventInsightsPayload,
  InsightsErrorReason,
} from "@/lib/insights/types";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

/*
 * activeCreatives left in the payload type as an optional field
 * for BACKWARD COMPATIBILITY with rows written before the
 * snapshot-first cache landed (PR #82+). Old rows still carry
 * the field and we don't want them to fail to parse on read; new
 * writes set it to undefined and active-creatives lives in
 * `active_creatives_snapshots` instead. Once every cached row
 * older than `SHARE_SNAPSHOT_TTL_MS` has rolled off (5 min after
 * the deploy), the field can be removed from the type entirely.
 */

/**
 * lib/db/share-snapshots.ts
 *
 * Read + write helpers for `share_insight_snapshots` (migration
 * 036). The table is a CACHE keyed on
 * `(share_token, date_preset, custom_since, custom_until)` — one
 * row per (share, window) — that backs the public share report so
 * TF flicks are instant after the first cold fetch and creative
 * thumbnails stay frozen inside the TTL window.
 *
 * Why no `import "server-only"` directive
 *   The two exports take a `SupabaseClient` as input — they don't
 *   read env vars, don't touch process / fs, and never construct a
 *   service-role client of their own. Skipping the directive keeps
 *   the module importable from `node --experimental-strip-types`
 *   for unit tests (Next's `server-only` shim doesn't resolve in
 *   raw Node). Server-only enforcement still happens at the call
 *   site: the only consumer is `app/share/report/[token]/page.tsx`
 *   (a Server Component), and the migration's RLS policy is
 *   `false` for everyone, so a hypothetical client-side import
 *   wouldn't be able to read or write rows even if it tried.
 *
 * Two exports only by design: the share page never sees DB
 * shapes, and we don't expose a generic delete / list surface.
 * The page reads via `readSnapshot` and writes via
 * `writeSnapshot`. Anything else means we're using the cache for
 * something it isn't.
 *
 * Access model
 *   Service-role only. Share-page visitors are anonymous so
 *   `app/share/report/[token]/page.tsx` already builds a
 *   service-role client; we reuse it. The migration's RLS policy
 *   is `false` for everyone — defensive backstop in case a future
 *   refactor accidentally swaps in a user-scoped client.
 */

const TABLE = "share_insight_snapshots";

/**
 * Cache TTL — matches the existing `revalidate = 300` on
 * `app/share/report/[token]/page.tsx`. If you bump this, also
 * bump the page-level `revalidate` so ISR and the Supabase cache
 * stay coherent (otherwise the page can serve a Supabase row
 * that's already past its `expires_at` for the rest of the ISR
 * window).
 */
export const SHARE_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

/**
 * The snapshot payload — the full bundle the share page assembles
 * before rendering. Round-trips the existing
 * `EventInsightsPayload` and `ShareActiveCreativesResult` shapes,
 * plus a separate `metaErrorReason` slot so a "headline insights
 * failed but creatives rendered" partial state survives the
 * cache (matches the partial-render path in the page itself).
 *
 * Stored as a single jsonb blob rather than split columns so
 * schema migrations on the underlying types don't drag the table
 * along — the cache stays contract-coupled to the page's render
 * shape, and a stale row from a previous deploy that no longer
 * parses just won't hit because the page would compute a
 * different payload anyway.
 */
export interface ShareSnapshotPayload {
  /**
   * Headline insights — null when the headline call failed (and
   * the page falls through to the partial-render banner) OR when
   * the event is intentionally Meta-less (TikTok-only client).
   */
  metaPayload: EventInsightsPayload | null;
  /**
   * The reason the Meta headline call failed, if any. Lets the
   * page reproduce the correct partial-render state from a cache
   * hit without re-running the Meta call to discover the failure.
   * Null when `metaPayload != null` or when the event was
   * Meta-less to begin with.
   */
  metaErrorReason: InsightsErrorReason | null;
  /**
   * Legacy field — DO NOT WRITE. Active creatives moved to a
   * dedicated `active_creatives_snapshots` table (migration 041)
   * with its own cron-driven refresh cadence. Kept optional on
   * read so rows written by the previous deploy don't fail to
   * parse during the rollover window. Drop after every cached
   * row written pre-deploy has expired (`SHARE_SNAPSHOT_TTL_MS`,
   * currently 5 minutes).
   *
   * @deprecated since the snapshot-first PR — read from
   *   `lib/db/active-creatives-snapshots.ts` instead.
   */
  activeCreatives?: ShareActiveCreativesResult | null;
}

/**
 * Cache key. NULL custom_since / custom_until are correct for
 * every non-custom preset; the unique constraint on the table
 * tolerates that because `(share_token, date_preset)` is unique
 * within a single preset family.
 */
export interface ShareSnapshotKey {
  shareToken: string;
  datePreset: DatePreset;
  /** Required when `datePreset === "custom"`; ignored otherwise. */
  customRange?: CustomDateRange;
}

interface CacheRow {
  payload: ShareSnapshotPayload;
  expires_at: string;
  fetched_at: string;
}

/**
 * Look up a fresh snapshot for the given (token, preset, range).
 * Returns null on:
 *   - no matching row,
 *   - row exists but `expires_at` has passed,
 *   - any DB error (we'd rather fall through to a fresh Meta
 *     fetch than 500 the page).
 *
 * The TTL check happens server-side rather than via a
 * `gt("expires_at", now)` filter so the per-token query plan
 * stays single-row deterministic; the index on
 * `(share_token, date_preset, expires_at desc)` makes either
 * approach O(1) anyway.
 */
export async function readShareSnapshot(
  supabase: SupabaseClient,
  key: ShareSnapshotKey,
): Promise<{ payload: ShareSnapshotPayload; ageMs: number } | null> {
  // Cast through `any` because regenerated Supabase types haven't
  // caught up with migration 036 on every checkout. Same pattern
  // as `lib/db/creative-insight-snapshots.ts`. Contained to this
  // module so callers see the typed surface only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  // NULL filter dance: PostgREST translates `.eq(col, null)` to
  // `WHERE col = NULL` (always false in SQL three-valued logic),
  // which is why every preset query under migration 036 was a
  // 100% miss. Use `.is(col, null)` for the IS NULL case and only
  // fall back to `.eq` when we actually have a value to filter
  // by — that maps to PostgREST's `is.null` operator and matches
  // the rows the writer is upserting after migration 037 makes
  // the unique constraint NULLS NOT DISTINCT.
  let q = sb
    .from(TABLE)
    .select("payload, expires_at, fetched_at")
    .eq("share_token", key.shareToken)
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
    console.warn("[share-snapshots] read failed", error.message);
    return null;
  }
  if (!data) return null;

  const row = data as CacheRow;
  const now = Date.now();
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

  // ageMs is informational (drives the `[share-snapshots] hit`
  // observability log). Negative values are possible if the
  // writer's clock ran ahead of the reader's by a fraction — clamp
  // to 0 so the log line never reads "-12ms old".
  const fetchedAt = new Date(row.fetched_at).getTime();
  const ageMs = Number.isFinite(fetchedAt) ? Math.max(0, now - fetchedAt) : 0;

  return { payload: row.payload, ageMs };
}

/**
 * Upsert the snapshot row, conflicting on
 * `(share_token, date_preset, custom_since, custom_until)`. Sets
 * `expires_at = now + SHARE_SNAPSHOT_TTL_MS`; the unique
 * constraint guarantees we replace rather than append, so the
 * table size is bounded by `(active tokens) × (presets used)`.
 *
 * Best-effort by design — we log on failure but never throw,
 * because a cache write failing must not 500 the user-facing
 * render. The next visitor will just hit Meta cold again.
 */
export async function writeShareSnapshot(
  supabase: SupabaseClient,
  key: ShareSnapshotKey,
  payload: ShareSnapshotPayload,
): Promise<void> {
  const now = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { error } = await sb.from(TABLE).upsert(
    {
      share_token: key.shareToken,
      date_preset: key.datePreset,
      custom_since: key.customRange?.since ?? null,
      custom_until: key.customRange?.until ?? null,
      payload,
      fetched_at: new Date(now).toISOString(),
      expires_at: new Date(now + SHARE_SNAPSHOT_TTL_MS).toISOString(),
    },
    {
      onConflict: "share_token,date_preset,custom_since,custom_until",
    },
  );
  if (error) {
    // Don't throw — see top-of-fn comment. console.warn so it
    // shows up in Vercel logs without burning an error budget.
    console.warn("[share-snapshots] write failed", error.message);
  }
}
