import type { SupabaseClient } from "@supabase/supabase-js";

import {
  readActiveCreativesSnapshot,
  type ActiveCreativesSnapshotRecord,
} from "../db/active-creatives-snapshots.ts";
import type { ShareActiveCreativesResult } from "../reporting/share-active-creatives.ts";

/**
 * lib/audiences/snapshot-video-sources.ts
 *
 * Cache-read resolver for the bulk video-views audience builder.
 * Reads `active_creatives_snapshots.payload.audience_video_sources`
 * (populated by the cron writer — see
 * `lib/reporting/active-creatives-fetch.ts`) so the builder can
 * serve from cache with zero Meta calls for any event the cron
 * has already seen. Existence motivation: PR-snapshot-cache /
 * `docs/META_API_BOTTLENECKS_2026-05-08.md` — the live walk
 * repeatedly tripped Meta rate limits (#80004 ad-account, #17
 * user) and timed out at scale (WC26 61 events, Junction 2
 * high-spend). Cache reads eliminate the per-build Meta fan-out.
 *
 * Read posture
 *   Service-role only — `active_creatives_snapshots` policy is
 *   `false` for all roles (migration 041). Caller MUST pre-filter
 *   `eventIds` against the user-scoped client so we never expose
 *   another tenant's payload (`userClient → eventIds →
 *   serviceClient → snapshots` pattern — same as the dashboard's
 *   feedback / share snapshots).
 *
 *   This module accepts an `admin` Supabase client rather than
 *   constructing one of its own so tests can pass a recorder
 *   stub without process-env mocking.
 *
 * Freshness / build-version
 *   Defers to `readActiveCreativesSnapshot` which already returns
 *   `null` for build-version mismatches (mig 067 — deploy
 *   invalidation). For `is_stale === true` rows, we still serve
 *   the payload (the cron's next cycle replaces it) — same
 *   stale-while-revalidate posture as the share page. The
 *   audience builder treats a missing or empty
 *   `audience_video_sources` the same as a cache miss → live-walk
 *   fallback for THAT event only.
 *
 * Preset choice
 *   We read `date_preset = "maximum"` because (a) `maximum` is in
 *   `DEFAULT_REFRESH_PRESETS` so the cron always populates it,
 *   and (b) it carries every video that has ever spent on the
 *   event — narrower presets would drop videos paused before the
 *   window. The audience-builder wants the union of all known
 *   videos, not the timeframe-filtered slice the share page wants.
 *
 * Per-event granularity
 *   `getVideoSourcesFromSnapshot` returns a Map keyed on eventId.
 *   The caller (runBulkVideoPreview Phase 1) classifies each
 *   event independently: hit → skip live walk, miss → live walk
 *   for that event only. No all-or-nothing fallback so one stale
 *   event can't drag the whole batch back onto Meta.
 */

/** Per-event cache lookup outcome. */
export type SnapshotVideoSourcesResult =
  | {
      kind: "hit";
      /**
       * Deduped (video_id, context_page_id) pairs written by the
       * cron after PR-snapshot-cache. Same shape that the live
       * walk's `walkCampaignAds` produces per ad, just
       * pre-extracted.
       */
      sources: Array<{ videoId: string; contextPageId: string }>;
      /**
       * `true` when the row's `is_stale` flag is set OR the row
       * is past its `expires_at`. Surfaced so the preview UI can
       * label rows "live (cache stale)" vs "from cache" — Matas
       * needs to see which events will trigger a Meta refresh on
       * the next cron cycle without having to grep logs.
       */
      stale: boolean;
      /** Wall-clock fetched_at on the snapshot row (diagnostic). */
      fetchedAt: Date;
    }
  | {
      kind: "miss";
      /**
       * "no_snapshot" → cron hasn't seen this event yet (or build
       * version mismatched, which `readActiveCreativesSnapshot`
       * returns as null).
       * "no_audience_sources" → snapshot exists but was written
       * before PR-snapshot-cache (or by a "skip"/"error" branch
       * the writer's refusal contract preserves last-good for).
       *   Either way: fall back to the live walk for this event.
       */
      reason: "no_snapshot" | "no_audience_sources";
    };

const SNAPSHOT_PRESET = "maximum" as const;

/**
 * Look up cached `(video_id, context_page_id)` pairs for a set of
 * eventIds owned by the caller. Service-role only.
 *
 * @param admin     Service-role Supabase client. Caller is
 *                  responsible for constructing this via
 *                  `createServiceRoleClient()` in the route.
 * @param eventIds  Already-filtered to events the user owns
 *                  (per `userClient → eventIds → serviceClient`).
 * @returns         Map keyed on eventId. Events whose lookup
 *                  errored at the DB layer surface as `miss` /
 *                  `no_snapshot` so the builder degrades to live
 *                  walk rather than throwing.
 */
export async function getVideoSourcesFromSnapshot(
  admin: SupabaseClient,
  eventIds: readonly string[],
): Promise<Map<string, SnapshotVideoSourcesResult>> {
  const out = new Map<string, SnapshotVideoSourcesResult>();
  if (eventIds.length === 0) return out;

  // Per-event serial reads — pattern matches `readActiveCreativesSnapshot`
  // which is the only typed wrapper we have around the cache table.
  // The eventIds list is at most ~60 (WC26 worst case), reads are
  // single-row PostgREST calls (~5-15ms each), so total latency sits
  // comfortably under the route's 300s `maxDuration`. Parallelising
  // would shave wall-clock at the cost of an opaque concurrency
  // tunable we'd have to revisit when the table grows; sequential
  // keeps the worst-case predictable and the code easy to reason
  // about. Tuning to `mapConcurrent` is a follow-up if profiles
  // show it's the bottleneck — which is unlikely versus the
  // 30-60s campaign walk it's replacing.
  for (const eventId of eventIds) {
    out.set(eventId, await resolveOne(admin, eventId));
  }
  return out;
}

async function resolveOne(
  admin: SupabaseClient,
  eventId: string,
): Promise<SnapshotVideoSourcesResult> {
  let record: ActiveCreativesSnapshotRecord | null = null;
  try {
    record = await readActiveCreativesSnapshot(admin, {
      eventId,
      datePreset: SNAPSHOT_PRESET,
    });
  } catch (err) {
    // Defensive: `readActiveCreativesSnapshot` already swallows
    // errors into `null`, but a future refactor could let one
    // bubble. Degrade to a miss so the live walk picks up.
    console.warn(
      `[snapshot-video-sources] read threw event=${eventId} — falling back to live walk: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { kind: "miss", reason: "no_snapshot" };
  }

  if (!record) {
    return { kind: "miss", reason: "no_snapshot" };
  }

  const payload = record.payload as ShareActiveCreativesResult;
  if (payload.kind !== "ok") {
    // Snapshot exists but holds a `skip`/`error` discriminant —
    // shouldn't happen given the writer's refusal contract, but
    // defensively fall back rather than throwing.
    return { kind: "miss", reason: "no_audience_sources" };
  }

  const sources = payload.audience_video_sources;
  if (!sources || sources.length === 0) {
    // Snapshot was written before this PR — `audience_video_sources`
    // is undefined on rows from earlier cron cycles. Next refresh
    // (≤6h) populates the field; in the meantime the live walk
    // covers this event.
    return { kind: "miss", reason: "no_audience_sources" };
  }

  return {
    kind: "hit",
    sources: sources.map((s) => ({
      videoId: s.video_id,
      contextPageId: s.context_page_id,
    })),
    // `is_stale` flag OR past `expires_at` both render as stale to
    // the UI. The user-facing label is informational only — the
    // builder still serves the cached payload (matches the
    // share-page stale-while-revalidate behaviour).
    stale: record.isStale || record.expiresAt.getTime() <= Date.now(),
    fetchedAt: record.fetchedAt,
  };
}
