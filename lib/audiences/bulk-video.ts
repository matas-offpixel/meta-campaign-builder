/**
 * Server-side async logic for bulk video views audience generation.
 * Import from route handlers only — depends on sources.ts → lib/meta/client.ts.
 *
 * Pure types/config/converters live in bulk-types.ts so tests can import
 * them without pulling in the MetaApiError TS parameter properties.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  campaignMatchesBracketedEventCode,
} from "../insights/meta-event-code-match.ts";
import { buildAudienceName } from "./naming.ts";
import { eventCodeMatchesPrefix } from "./event-code-prefix-scanner.ts";
import { isMetaAdAccountRateLimitError } from "./meta-rate-limit.ts";
import {
  fetchAudienceCampaigns,
  walkCampaignAds,
  hydrateVideoMetadataConcurrent,
} from "./sources.ts";
import { withoutActPrefix } from "../meta/ad-account-id.ts";
import { MetaApiError } from "../meta/client.ts";
import {
  BULK_FUNNEL_CONFIG,
  META_MAX_RETENTION_DAYS,
  type BulkCustomStage,
  type BulkFunnelStage,
  type BulkPreviewAudience,
  type BulkPreviewRow,
  type BulkPreviewSource,
} from "./bulk-types.ts";
import type { SnapshotVideoSourcesResult } from "./snapshot-video-sources.ts";
import type { Database } from "../db/database.types.ts";

export {
  BULK_FUNNEL_CONFIG,
  isBulkFunnelStage,
  isValidCustomStage,
  hasBulkStages,
  previewRowsToInserts,
} from "./bulk-types.ts";
export type {
  BulkCustomStage,
  BulkFunnelStage,
  BulkPreviewAudience,
  BulkPreviewRow,
} from "./bulk-types.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

interface EventRow {
  id: string;
  name: string;
  event_code: string | null;
  client_id: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function campaignFetchSkipReason(err: unknown): string {
  if (!(err instanceof MetaApiError)) {
    return "Failed to fetch campaigns from Meta — check ad account connection.";
  }
  const { code } = err;
  if (code === 4 || code === 17 || code === 80004) {
    return `Rate limited (#${code}) — retry in a few minutes.`;
  }
  if (code === 190) {
    return "Auth expired (#190) — reconnect Facebook.";
  }
  if (code === 200) {
    return "Missing ad account permission (#200) — re-grant access to ad account.";
  }
  if (code !== undefined) {
    return `Meta API error #${code} — ${err.message}`;
  }
  return "Failed to fetch campaigns from Meta — check ad account connection.";
}

// ── Core resolver ─────────────────────────────────────────────────────────────

export interface RunBulkPreviewOpts {
  supabase: TypedSupabaseClient;
  userId: string;
  clientId: string;
  metaAdAccountId: string;
  clientSlug: string | null;
  clientName: string;
  token: string;
  eventCodePrefix: string;
  funnelStages: BulkFunnelStage[];
  /** User-defined (threshold, retentionDays) pairs; retentionDays clamped to META_MAX_RETENTION_DAYS. */
  customStages: BulkCustomStage[];
  /**
   * Optional snapshot-cache resolver injection point. Production
   * callers leave undefined and the route handler wires in
   * `getVideoSourcesFromSnapshot(createServiceRoleClient(), eventIds)`.
   * Tests pass a deterministic Map so the unit suite can cover
   * cache hit / stale / miss / pre-Part-1 (no audience_video_sources)
   * branches without spinning up a Supabase fixture.
   *
   * When omitted entirely the resolver is treated as cache-disabled
   * — every event takes the live-walk path. Keeps backward
   * compatibility for any caller that hasn't been plumbed through
   * yet (and lets the existing test suite keep running unchanged).
   */
  resolveSnapshotSources?: (
    eventIds: readonly string[],
  ) => Promise<Map<string, SnapshotVideoSourcesResult>>;
}

/**
 * Resolves the full preview for a bulk video-views run.
 * Pure dry-run: no DB writes, no Meta writes.
 *
 * Three-phase design to eliminate cross-event duplicate video metadata fetches:
 *   Phase 1 — walk every event's campaign ads (collect raw video IDs, no metadata calls).
 *   Phase 2 — hydrate the unified Set<video_id> once via batched /?ids= with concurrency=5.
 *   Phase 3  — apply orphan filter and build audience payloads per event from the cache.
 *   Phase 3b — deduplicate by event_code: union video IDs across sibling events sharing
 *              the same event_code; emit one audience per (event_code, threshold, retention).
 */
export async function runBulkVideoPreview(
  opts: RunBulkPreviewOpts,
): Promise<BulkPreviewRow[]> {
  const {
    supabase, userId, clientId, metaAdAccountId, clientName, clientSlug,
    token, eventCodePrefix, funnelStages, customStages, resolveSnapshotSources,
  } = opts;

  // 1. Fetch all events for this client
  const { data: eventsData, error: eventsError } = await supabase
    .from("events")
    .select("id, name, event_code, client_id")
    .eq("client_id", clientId)
    .eq("user_id", userId);

  if (eventsError) throw new Error(eventsError.message);

  const events = ((eventsData ?? []) as EventRow[]).filter(
    (e) => e.event_code && eventCodeMatchesPrefix(e.event_code, eventCodePrefix),
  );

  if (events.length === 0) return [];

  // 2. Fetch all campaigns for the ad account once
  let allCampaigns: Array<{ id: string; name: string }> = [];
  try {
    allCampaigns = await fetchAudienceCampaigns(metaAdAccountId, token, 200);
  } catch (err: unknown) {
    console.error("[bulk-video] campaign fetch failed", err);
    const skipReason = campaignFetchSkipReason(err);
    return events.map((e) => ({
      eventId: e.id,
      eventCode: e.event_code!.toUpperCase(),
      eventName: e.name,
      matchedCampaigns: [],
      pagePublishedVideos: 0,
      orphanVideos: 0,
      audiences: [],
      skipped: true,
      skipReason,
      source: "live" as const,
    }));
  }

  const expectedAccountId = withoutActPrefix(metaAdAccountId);

  // Phase 0 — snapshot-cache classification.
  // Per-event lookup of `active_creatives_snapshots.payload.audience_video_sources`
  // populated by the 6-hourly refresh-active-creatives cron. Events
  // with a hit skip the live walk entirely (zero Meta calls);
  // misses (no row, stale build_version, snapshot written before
  // PR-snapshot-cache, or `audience_video_sources` empty) fall
  // through to the live walk for THAT event only. Per-event
  // granularity matters: one stale event in a batch of 60 shouldn't
  // drag the rest back onto Meta. See
  // `docs/META_API_BOTTLENECKS_2026-05-08.md` for the rate-limit
  // pressure this cache is mitigating.
  let snapshotByEvent: Map<string, SnapshotVideoSourcesResult> = new Map();
  if (resolveSnapshotSources) {
    try {
      snapshotByEvent = await resolveSnapshotSources(events.map((e) => e.id));
    } catch (err) {
      // Cache lookup failure is non-fatal — degrade silently to
      // live walk for every event so the builder never goes down
      // because Supabase had a hiccup.
      console.warn(
        `[bulk-video] snapshot cache lookup failed — falling back to live walk for all events: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      snapshotByEvent = new Map();
    }
  }

  // Phase 1 — collect raw video IDs per event.
  // For cache-hit events: pull directly from snapshot (no Meta call).
  // For cache-miss / stale-build-version events: walk matched
  // campaigns via the existing live path. The live walk path is
  // untouched — same `walkCampaignAds` semantics PR #391 wired up,
  // same per-campaign Promise.allSettled isolation. Events are
  // processed concurrently (5-wide) to keep wall-clock predictable
  // even when most events take the live path.
  type EventWalk = {
    event: EventRow;
    code: string;
    matched: Array<{ id: string; name: string }>;
    rawVideoIds: Set<string>;
    pageIds: string[];
    /**
     * Per-video page-id mapping pre-resolved from the snapshot
     * (cache hit only). When populated, the snapshot stored the
     * Page that owns each video — orphan filter and contextPageId
     * derivation skip the live `hydrateVideoMetadataConcurrent`
     * call for these videos because we already know they have a
     * valid page association by construction (writer only persists
     * pairs that resolved both video_id AND context_page_id).
     */
    snapshotPageByVideo: Map<string, string>;
    errorMsg?: string;
    /** `cache` / `cache_stale` / `live` — drives the preview-row badge. */
    source: BulkPreviewSource;
  };

  const walks = await mapConcurrent(events, 5, async (event): Promise<EventWalk> => {
    const code = event.event_code!.toUpperCase();
    const matched = allCampaigns.filter((c) =>
      campaignMatchesBracketedEventCode(c.name, code),
    );

    const snapshot = snapshotByEvent.get(event.id);

    if (snapshot?.kind === "hit") {
      // Cache hit — pull (video_id, context_page_id) pairs straight
      // out of the snapshot. Each pair already passed the writer's
      // multi-shape page-id resolver, so the orphan filter in
      // Phase 3 is effectively a pass-through. `matchedCampaigns`
      // is still derived from the live campaign list (cheap — one
      // ad-account /campaigns call serves the whole client) so the
      // preview UI keeps its campaign-name display.
      const rawVideoIds = new Set<string>();
      const pageIds: string[] = [];
      const snapshotPageByVideo = new Map<string, string>();
      for (const src of snapshot.sources) {
        rawVideoIds.add(src.videoId);
        pageIds.push(src.contextPageId);
        snapshotPageByVideo.set(src.videoId, src.contextPageId);
      }
      console.info(
        `[bulk-video] event=${code} source=${snapshot.stale ? "cache_stale" : "cache"} videos=${rawVideoIds.size} pairs=${snapshot.sources.length}`,
      );
      return {
        event,
        code,
        matched,
        rawVideoIds,
        pageIds,
        snapshotPageByVideo,
        source: snapshot.stale ? "cache_stale" : "cache",
      };
    }

    // Cache miss (or resolver not provided) — live walk for this
    // event only. Identical to the pre-PR Phase-1 logic.
    const rawVideoIds = new Set<string>();
    const pageIds: string[] = [];
    let errorMsg: string | undefined;

    if (matched.length > 0) {
      const walkResults = await Promise.allSettled(
        matched.map((c) => walkCampaignAds(c.id, expectedAccountId, token)),
      );
      for (const result of walkResults) {
        if (result.status === "rejected") {
          const msg =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          errorMsg = /rate.limit|429/i.test(msg)
            ? "Meta rate limit — retry in a few minutes."
            : `Failed to fetch videos: ${msg}`;
          continue;
        }
        for (const id of result.value.videoIds) rawVideoIds.add(id);
        pageIds.push(...result.value.pageIds);
      }
    }

    return {
      event,
      code,
      matched,
      rawVideoIds,
      pageIds,
      snapshotPageByVideo: new Map(),
      errorMsg,
      source: "live",
    };
  });

  // Phase 2 — unified metadata hydration across the events that
  // took the LIVE walk. Cache-hit events skip this entirely because
  // the snapshot already pre-resolved (video_id, context_page_id)
  // pairs — every cached video has a known Page association by
  // construction (writer drops orphans), so the live-only
  // `hydrateVideoMetadataConcurrent` orphan-filter pass is moot for
  // them. Net: zero Meta calls for an all-cache batch.
  const unifiedVideoIds = new Set<string>();
  for (const walk of walks) {
    if (walk.source !== "live") continue;
    for (const id of walk.rawVideoIds) unifiedVideoIds.add(id);
  }

  let videoCache: Awaited<ReturnType<typeof hydrateVideoMetadataConcurrent>> = new Map();

  if (unifiedVideoIds.size > 0) {
    try {
      videoCache = await hydrateVideoMetadataConcurrent(Array.from(unifiedVideoIds), token);
    } catch (err) {
      if (isMetaAdAccountRateLimitError(err)) {
        // Rate-limit abort applies only to the live-walk events
        // whose Phase 2 needed Meta. Cache-hit events were already
        // resolved without any Meta traffic, so they survive the
        // rate-limit fence and still produce valid audiences. This
        // is the headline win of the cache integration — a partial
        // Meta outage no longer poisons the whole batch.
        const skipReason =
          "User request limit reached (Meta #17) — try again in a few minutes.";
        return walks.map((w) =>
          w.source === "live"
            ? {
                eventId: w.event.id,
                eventCode: w.code,
                eventName: w.event.name,
                matchedCampaigns: w.matched.map((c) => ({ id: c.id, name: c.name })),
                pagePublishedVideos: 0,
                orphanVideos: 0,
                audiences: [],
                skipped: true,
                skipReason,
                source: w.source,
              }
            : buildRowFromWalk(w, undefined, {
                clientSlug,
                clientName,
                funnelStages,
                customStages,
              }),
        );
      }
      throw err;
    }
  }

  // Phase 3 — build per-event rows from the resolved video data
  // (cache-hit events use snapshot pairs directly; live events use
  // the live-walk + hydration result).
  const rows = walks.map((walk): BulkPreviewRow =>
    buildRowFromWalk(walk, videoCache, {
      clientSlug,
      clientName,
      funnelStages,
      customStages,
    }),
  );

  // Phase 3b — deduplicate audiences by event_code.
  // Events sharing the same event_code (e.g. three Scotland fixtures at O2)
  // produce identical audience names and identical videos. Union their video
  // ID sets into the primary row; clear sibling rows so previewRowsToInserts
  // creates ONE insert per (event_code, threshold, retention) tuple, not one
  // per event.
  return dedupeRowsByEventCode(rows);
}

// ── Per-event row builder ─────────────────────────────────────────────────────

type EventWalkInput = {
  event: EventRow;
  code: string;
  matched: Array<{ id: string; name: string }>;
  rawVideoIds: Set<string>;
  pageIds: string[];
  snapshotPageByVideo: Map<string, string>;
  errorMsg?: string;
  source: BulkPreviewSource;
};

type RowBuilderOpts = {
  clientSlug: string | null;
  clientName: string;
  funnelStages: BulkFunnelStage[];
  customStages: BulkCustomStage[];
};

/**
 * Materialise one BulkPreviewRow from an EventWalk. Cache-hit walks
 * (`source === "cache" | "cache_stale"`) carry their own
 * `snapshotPageByVideo` map so the orphan filter passes through
 * without consulting `videoCache` — the writer only persists pairs
 * with a resolved Page, so a snapshot video is page-published by
 * construction.
 *
 * Live walks orphan-filter against `videoCache` (populated in
 * Phase 2 from `hydrateVideoMetadataConcurrent`). When the caller
 * skips Phase 2 (e.g. rate-limit fence for cache-hit events),
 * `videoCache` is `undefined` and live walks should never reach
 * here — guarded by the rate-limit branch above which short-circuits
 * live events to a skipped row.
 */
function buildRowFromWalk(
  walk: EventWalkInput,
  videoCache:
    | Awaited<ReturnType<typeof hydrateVideoMetadataConcurrent>>
    | undefined,
  opts: RowBuilderOpts,
): BulkPreviewRow {
  const { event, code, matched, rawVideoIds, pageIds, snapshotPageByVideo, errorMsg, source } = walk;
  const { clientSlug, clientName, funnelStages, customStages } = opts;
  const campaignSummaries = matched.map((c) => ({ id: c.id, name: c.name }));
  const campaignIds = matched.map((c) => c.id);

  if (matched.length === 0) {
    return {
      eventId: event.id,
      eventCode: code,
      eventName: event.name,
      matchedCampaigns: [],
      pagePublishedVideos: 0,
      orphanVideos: 0,
      audiences: [],
      skipped: true,
      skipReason: "No campaigns found matching this event code.",
      source,
    };
  }

  // contextPageId: most-common page from creative-level extraction.
  // For cache hits, `pageIds` is the per-video page list pulled from
  // the snapshot — same shape `walkCampaignAds` returns, so this
  // arithmetic is identical.
  const pageCounts = new Map<string, number>();
  for (const id of pageIds) {
    pageCounts.set(id, (pageCounts.get(id) ?? 0) + 1);
  }
  let contextPageId =
    pageCounts.size > 0
      ? [...pageCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
      : undefined;

  // Orphan filter — split by source so cache-hits don't need the
  // expensive video metadata cache:
  //   - Cache hit: every snapshot video has a known context_page_id
  //     by construction (writer drops pairs missing either side).
  //     `snapshotPageByVideo` is the authoritative orphan check.
  //   - Live walk: fall back to `videoCache` + `from.id`, the
  //     pre-PR behaviour.
  const videoFromPageCounts = new Map<string, number>();
  const validVideoIds: string[] = [];
  let orphanCount = 0;

  for (const videoId of rawVideoIds) {
    if (source === "cache" || source === "cache_stale") {
      const pageId = snapshotPageByVideo.get(videoId);
      if (!pageId) {
        // Defensive: shouldn't happen — writer guarantees pairs.
        // If it does, treat as orphan rather than ship a broken
        // audience.
        orphanCount++;
        continue;
      }
      videoFromPageCounts.set(
        pageId,
        (videoFromPageCounts.get(pageId) ?? 0) + 1,
      );
      validVideoIds.push(videoId);
      continue;
    }

    const meta = videoCache?.get(videoId);
    if (!meta?.from?.id) {
      orphanCount++;
      continue;
    }
    videoFromPageCounts.set(meta.from.id, (videoFromPageCounts.get(meta.from.id) ?? 0) + 1);
    validVideoIds.push(videoId);
  }
  validVideoIds.sort();

  // contextPageId fallback: most-common from.id across surviving videos.
  if (!contextPageId && videoFromPageCounts.size > 0) {
    contextPageId = [...videoFromPageCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }

  if (orphanCount > 0) {
    console.warn(
      `[runBulkVideoPreview] Dropped ${orphanCount} video(s) with no Page association` +
        ` (event ${code}, source=${source}). Meta requires videos to be published from a FB Page.`,
    );
  }

  if (errorMsg) {
    return {
      eventId: event.id,
      eventCode: code,
      eventName: event.name,
      matchedCampaigns: campaignSummaries,
      pagePublishedVideos: validVideoIds.length,
      orphanVideos: orphanCount,
      contextPageId,
      audiences: [],
      skipped: true,
      skipReason: errorMsg,
      source,
    };
  }

  if (validVideoIds.length === 0) {
    return {
      eventId: event.id,
      eventCode: code,
      eventName: event.name,
      matchedCampaigns: campaignSummaries,
      pagePublishedVideos: 0,
      orphanVideos: orphanCount,
      contextPageId,
      audiences: [],
      skipped: true,
      skipReason:
        orphanCount > 0
          ? "No page-published videos — all found videos were uploaded directly to the ad account."
          : "No videos found in matched campaigns.",
      source,
    };
  }

  // Build proposed audiences per funnel stage then per custom stage.
  const namingOpts = {
    scope: "event" as const,
    client: { slug: clientSlug, name: clientName },
    event: { eventCode: code, name: event.name },
    subtype: "video_views" as const,
    campaignNames: campaignSummaries.map((c) => c.name),
  };

  const funnelAudiences: BulkPreviewAudience[] = funnelStages.map((stage) => {
    const { threshold, retentionDays, label } = BULK_FUNNEL_CONFIG[stage];
    const name = `[${code}] ${label} — ${threshold}% VV ${retentionDays}d`;
    return { funnelStage: stage, name, threshold, retentionDays, videoIds: validVideoIds, campaignIds, campaignSummaries, contextId: contextPageId };
  });

  const customAudiences: BulkPreviewAudience[] = customStages.map((cs) => {
    const retentionDays = Math.min(META_MAX_RETENTION_DAYS, Math.max(1, Math.trunc(cs.retentionDays)));
    const name = buildAudienceName({ ...namingOpts, retentionDays, threshold: cs.threshold });
    return { funnelStage: "custom", name, threshold: cs.threshold, retentionDays, videoIds: validVideoIds, campaignIds, campaignSummaries, contextId: contextPageId };
  });

  return {
    eventId: event.id,
    eventCode: code,
    eventName: event.name,
    matchedCampaigns: campaignSummaries,
    pagePublishedVideos: validVideoIds.length,
    orphanVideos: orphanCount,
    contextPageId,
    audiences: [...funnelAudiences, ...customAudiences],
    skipped: false,
    source,
  };
}

// ── Event-code dedup ──────────────────────────────────────────────────────────

/**
 * Group rows by event_code; keep ONE set of audiences on the primary (first
 * non-skipped) row per event_code. Union video IDs across all siblings into
 * the primary so a shared trailer/highlight is included even if it only
 * appeared in one sibling event's campaign walk. Sibling rows keep their
 * per-event fields (campaigns, video counts) but get `audiences: []` so
 * previewRowsToInserts produces one draft per (event_code, threshold,
 * retention) tuple rather than one per event.
 *
 * contextPageId on the primary's audiences is updated to the most-common
 * contextPageId across all siblings — correct when siblings share campaigns
 * and a no-op when they have distinct campaigns pointing to the same page.
 */
function dedupeRowsByEventCode(rows: BulkPreviewRow[]): BulkPreviewRow[] {
  type CodeState = {
    primaryIdx: number;
    mergedVideoIds: Set<string>;
    contextPageCounts: Map<string, number>;
  };

  const byCode = new Map<string, CodeState>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.skipped || row.audiences.length === 0) continue;

    if (!byCode.has(row.eventCode)) {
      byCode.set(row.eventCode, {
        primaryIdx: i,
        mergedVideoIds: new Set<string>(),
        contextPageCounts: new Map<string, number>(),
      });
    }
    const state = byCode.get(row.eventCode)!;
    for (const audience of row.audiences) {
      for (const vid of audience.videoIds) state.mergedVideoIds.add(vid);
    }
    if (row.contextPageId) {
      state.contextPageCounts.set(
        row.contextPageId,
        (state.contextPageCounts.get(row.contextPageId) ?? 0) + 1,
      );
    }
  }

  return rows.map((row, i): BulkPreviewRow => {
    if (row.skipped || row.audiences.length === 0) return row;

    const state = byCode.get(row.eventCode);
    if (!state) return row;

    const mergedIds = [...state.mergedVideoIds].sort();
    const mergedContextPageId =
      state.contextPageCounts.size > 0
        ? [...state.contextPageCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        : row.contextPageId;

    if (i !== state.primaryIdx) {
      // Sibling: per-event data intact, audiences cleared — covered by primary.
      return { ...row, audiences: [] };
    }

    // Primary: audiences carry the union of all sibling video IDs + merged contextId.
    return {
      ...row,
      audiences: row.audiences.map((a) => ({
        ...a,
        videoIds: mergedIds,
        contextId: mergedContextPageId,
      })),
    };
  });
}

// ── Concurrency helper ────────────────────────────────────────────────────────

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}
