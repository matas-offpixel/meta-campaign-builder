import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import {
  ACS_DEFAULT_TTL_MS,
  ACS_TIGHT_TTL_MS,
  writeActiveCreativesSnapshot,
} from "../db/active-creatives-snapshots.ts";
import type {
  fetchShareActiveCreatives,
  ShareActiveCreativesResult,
} from "@/lib/reporting/share-active-creatives";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import type { EventScopedShare } from "@/lib/db/report-shares";

/**
 * Why no `import "server-only"` directive on this module
 *   The runner is exclusively called from server transports (cron
 *   route + internal refresh route), so nothing on the client side
 *   would ever try to import it. Skipping the directive keeps the
 *   module testable under `node --experimental-strip-types` —
 *   `server-only` blows up at import time in raw Node, which would
 *   cascade into every test that touches the runner.
 *
 * Why the default fetcher is a lazy dynamic `import()`
 *   `share-active-creatives` does carry `import "server-only"` (it
 *   talks to Meta), so importing it eagerly here would re-introduce
 *   the test-time blow-up. The default branch dynamic-imports it
 *   inside `refreshActiveCreativesForEvent`; tests that pass
 *   `_fetcher` never trigger the dynamic import at all and never
 *   load the server-only module.
 */

/**
 * lib/reporting/active-creatives-refresh-runner.ts
 *
 * Pre-populates `active_creatives_snapshots` for one event across a
 * set of date presets. Mirrors the `runRollupSyncForEvent`
 * scaffolding in `lib/dashboard/rollup-sync-runner.ts` — same
 * "resolve everything per-event, isolate per-leg failures, return
 * a structured per-leg result" shape — so the two cron loops can
 * stay shaped identically and the same diagnostics surface in
 * Vercel logs.
 *
 * Three transports use this runner today:
 *
 *   1. GET  /api/cron/refresh-active-creatives — Vercel Cron, every 6h.
 *   2. POST /api/internal/refresh-active-creatives — share-page
 *      stale-while-revalidate background trigger AND owner-side
 *      "Refresh now" button.
 *   3. (Future) backfill scripts.
 *
 * Per-preset isolation
 *   The preset loop is `try/catch` per iteration. One preset
 *   throwing (token expired, transient Meta 5xx, etc.) MUST NOT
 *   abort the rest — the share page can still serve `last_30d` if
 *   `last_7d` failed. Each preset's outcome is reported on the
 *   `presetResults` array.
 *
 * Refusal-to-overwrite
 *   `writeActiveCreativesSnapshot` itself short-circuits on `kind
 *   === "skip" | "error"`. The runner records `wroteSnapshot=false`
 *   for those branches so callers can tell the difference between
 *   "preset succeeded and was persisted" and "preset succeeded but
 *   the cache was deliberately not touched". Last-good > unavailable.
 */

/**
 * Default presets the cron warms. Mirrors the timeframes the share
 * page actually exposes via the `?tf=` selector (see
 * `lib/insights/types.ts` `DATE_PRESETS`). `today` / `yesterday`
 * are deliberately omitted — those are cheap to compute live from
 * `event_daily_rollups` and rarely link-shared.
 */
export const DEFAULT_REFRESH_PRESETS: readonly DatePreset[] = [
  "maximum",
  "last_30d",
  "last_14d",
  "last_7d",
];

/**
 * Inside this many days of `event_date` the cron runs at the
 * tightened cadence (`ACS_TIGHT_TTL_MS`). Mirrors the
 * "daily vs weekly cadence" pattern already in MEMORY.
 */
export const TIGHT_TTL_WINDOW_DAYS = 14;

export interface RefreshInput {
  /** Service-role Supabase client. Cron / internal route resolves
   *  this once per request and threads it through. */
  supabase: SupabaseClient<Database>;
  eventId: string;
  /** OWNING user_id — the principal whose Facebook OAuth token is
   *  used for the Meta calls. Mirrors `RollupSyncInput`. */
  userId: string;
  /** Bracket-stripped event_code. Null short-circuits every preset
   *  with `kind="skip"` reason `no_event_code`. */
  eventCode: string | null;
  /** Resolved Meta ad account id (e.g. "act_…"). Null short-
   *  circuits with `kind="skip"` reason `no_ad_account`. */
  adAccountId: string | null;
  /** `events.event_date` (or null). Used to pick between
   *  `ACS_DEFAULT_TTL_MS` and `ACS_TIGHT_TTL_MS`. The runner does
   *  the comparison itself so callers can pass through the raw
   *  column value. */
  eventDate: Date | null;
  /** Presets to refresh. Defaults to `DEFAULT_REFRESH_PRESETS`. */
  presets?: readonly DatePreset[];
  /** Optional custom range — only used when `presets` includes
   *  "custom". Snapshot key is keyed on the range so this is
   *  applied uniformly across whichever presets request it. */
  customRange?: CustomDateRange;
  /**
   * INTERNAL — fetch fn injection point. Production callers leave
   * this undefined and the runner dynamic-imports
   * `fetchShareActiveCreatives` lazily. Tests pass a fake so the
   * runner doesn't load the server-only module at all. Flagged
   * with the underscore prefix to discourage external callers.
   */
  _fetcher?: typeof fetchShareActiveCreatives;
  /**
   * INTERNAL — called only after a fresh ok payload has been written
   * to `active_creatives_snapshots`. Cron uses this to run sidecar
   * work against persisted payloads without moving any Meta/OpenAI
   * traffic into the public viewer path.
   */
  onSnapshotWritten?: (args: {
    eventId: string;
    userId: string;
    preset: DatePreset;
    payload: Extract<ShareActiveCreativesResult, { kind: "ok" }>;
  }) => Promise<void>;
}

export interface PresetRefreshResult {
  preset: DatePreset;
  /** True iff `kind === "ok"` AND no exception was thrown. False
   *  for skip/error and for thrown failures. */
  ok: boolean;
  kind: ShareActiveCreativesResult["kind"];
  error?: string;
  /** True iff the snapshot table was upserted on this iteration.
   *  Always false for `kind="skip"` / `kind="error"` per the
   *  refusal-to-overwrite contract. */
  wroteSnapshot: boolean;
  durationMs: number;
}

export interface RefreshResult {
  eventId: string;
  /** True iff every preset's `ok` is true. Surfaced so the cron
   *  can flip its overall HTTP status to 207 on partial failure. */
  ok: boolean;
  presetResults: PresetRefreshResult[];
  /** Set when the runner itself died (e.g. failed to construct
   *  the synthetic share row). Per-preset failures live in
   *  `presetResults`, not here. */
  error?: string;
}

/**
 * Synthesize a minimal `EventScopedShare` so the runner can call
 * `fetchShareActiveCreatives` from a CRON context where no real
 * share row was resolved. The fetch helper only reads
 * `share.scope`, `share.user_id`, `share.event_id`, and
 * `share.token` (for log lines), so the rest of the
 * `ResolvedShareBase` fields are filled with safe defaults.
 *
 * `token` is the constant `"cron-refresh"` so log filters can
 * distinguish runner-driven traffic from real share-page traffic.
 */
function synthesizeShareForRunner(
  eventId: string,
  userId: string,
): EventScopedShare {
  return {
    scope: "event",
    event_id: eventId,
    client_id: null,
    user_id: userId,
    token: "cron-refresh",
    can_edit: false,
    enabled: true,
    expires_at: null,
    view_count: 0,
    last_viewed_at: null,
    created_at: new Date(0).toISOString(),
  };
}

/**
 * Pick the TTL based on how close `event_date` is.
 *
 * Inside `TIGHT_TTL_WINDOW_DAYS` of the show → `ACS_TIGHT_TTL_MS`.
 * Past the show, far before, or unknown → `ACS_DEFAULT_TTL_MS`.
 * Past-show events keep the default cadence because revenue trickle
 * (refunds, comp scans) is much slower than show-week ad pacing.
 */
export function pickTtlMs(
  eventDate: Date | null,
  nowMs: number = Date.now(),
): number {
  if (!eventDate) return ACS_DEFAULT_TTL_MS;
  const ms = eventDate.getTime();
  if (!Number.isFinite(ms)) return ACS_DEFAULT_TTL_MS;
  const diffDays = (ms - nowMs) / (24 * 60 * 60 * 1000);
  // Tighten when within 14 days BEFORE the show. Past-show events
  // (negative diffDays) revert to the default cadence — revenue
  // trickle settles within ~2 weeks anyway, and the operational
  // budget should go to events still pacing.
  if (diffDays >= 0 && diffDays <= TIGHT_TTL_WINDOW_DAYS) {
    return ACS_TIGHT_TTL_MS;
  }
  return ACS_DEFAULT_TTL_MS;
}

export async function refreshActiveCreativesForEvent(
  input: RefreshInput,
): Promise<RefreshResult> {
  const presets = input.presets ?? DEFAULT_REFRESH_PRESETS;
  const ttlMs = pickTtlMs(input.eventDate);
  const share = synthesizeShareForRunner(input.eventId, input.userId);
  const fetcher: typeof fetchShareActiveCreatives =
    input._fetcher ??
    (await import("@/lib/reporting/share-active-creatives"))
      .fetchShareActiveCreatives;
  const presetResults: PresetRefreshResult[] = [];

  for (const preset of presets) {
    const t0 = Date.now();
    let kind: ShareActiveCreativesResult["kind"] = "error";
    let ok = false;
    let wroteSnapshot = false;
    let error: string | undefined;

    try {
      // `fetchShareActiveCreatives` already wraps Meta calls in
      // try/catch and returns a discriminated-union result —
      // either we get a structured kind/reason or an exception
      // bubbles out. We treat both branches as failure of THIS
      // preset only; the next preset still runs.
      const result = await fetcher({
        share,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        admin: input.supabase as any,
        eventCode: input.eventCode,
        adAccountId: input.adAccountId,
        datePreset: preset,
        customRange: preset === "custom" ? input.customRange : undefined,
        enrichVideoThumbnails: true,
      });
      kind = result.kind;
      if (result.kind === "ok") {
        ok = true;
        try {
          await writeActiveCreativesSnapshot(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            input.supabase as any,
            {
              eventId: input.eventId,
              userId: input.userId,
              datePreset: preset,
              customRange: preset === "custom" ? input.customRange : undefined,
            },
            result,
            ttlMs,
          );
          wroteSnapshot = true;
          if (input.onSnapshotWritten) {
            await input.onSnapshotWritten({
              eventId: input.eventId,
              userId: input.userId,
              preset,
              payload: result,
            });
          }
        } catch (writeErr) {
          // Write failures from inside the helper are already
          // logged + swallowed there; this catch is defence in
          // depth in case the helper's contract changes.
          error =
            writeErr instanceof Error
              ? writeErr.message
              : String(writeErr);
        }
      } else {
        // skip/error are reported as "preset completed without
        // exception, but the snapshot table was deliberately not
        // touched". Flag `ok=false` so the cron's per-event
        // summary surfaces the partial state.
        ok = false;
        if (result.kind === "error") {
          error = result.message;
        }
      }
    } catch (err) {
      kind = "error";
      ok = false;
      error = err instanceof Error ? err.message : String(err);
      console.error(
        `[active-creatives-refresh] event=${input.eventId} preset=${preset} threw: ${error}`,
      );
    }

    presetResults.push({
      preset,
      ok,
      kind,
      error,
      wroteSnapshot,
      durationMs: Date.now() - t0,
    });
  }

  const allOk = presetResults.every((r) => r.ok);
  return {
    eventId: input.eventId,
    ok: allOk,
    presetResults,
  };
}
