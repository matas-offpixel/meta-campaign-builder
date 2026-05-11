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
import {
  BULK_FUNNEL_CONFIG,
  META_MAX_RETENTION_DAYS,
  type BulkCustomStage,
  type BulkFunnelStage,
  type BulkPreviewAudience,
  type BulkPreviewRow,
} from "./bulk-types.ts";
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
}

/**
 * Resolves the full preview for a bulk video-views run.
 * Pure dry-run: no DB writes, no Meta writes.
 *
 * Three-phase design to eliminate cross-event duplicate video metadata fetches:
 *   Phase 1 — walk every event's campaign ads (collect raw video IDs, no metadata calls).
 *   Phase 2 — hydrate the unified Set<video_id> once via batched /?ids= with concurrency=5.
 *   Phase 3 — apply orphan filter and build audience payloads per event from the cache.
 */
export async function runBulkVideoPreview(
  opts: RunBulkPreviewOpts,
): Promise<BulkPreviewRow[]> {
  const {
    supabase, userId, clientId, metaAdAccountId, clientName, clientSlug,
    token, eventCodePrefix, funnelStages, customStages,
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
  } catch {
    return events.map((e) => ({
      eventId: e.id,
      eventCode: e.event_code!.toUpperCase(),
      eventName: e.name,
      matchedCampaigns: [],
      pagePublishedVideos: 0,
      orphanVideos: 0,
      audiences: [],
      skipped: true,
      skipReason: "Failed to fetch campaigns from Meta — check ad account connection.",
    }));
  }

  const expectedAccountId = withoutActPrefix(metaAdAccountId);

  // Phase 1 — walk each event's matched campaigns to collect raw video IDs.
  // No metadata fetches yet; 5 events processed concurrently.
  type EventWalk = {
    event: EventRow;
    code: string;
    matched: Array<{ id: string; name: string }>;
    rawVideoIds: Set<string>;
    pageIds: string[];
    errorMsg?: string;
  };

  const walks = await mapConcurrent(events, 5, async (event): Promise<EventWalk> => {
    const code = event.event_code!.toUpperCase();
    const matched = allCampaigns.filter((c) =>
      campaignMatchesBracketedEventCode(c.name, code),
    );

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

    return { event, code, matched, rawVideoIds, pageIds, errorMsg };
  });

  // Phase 2 — unified metadata hydration across ALL events.
  // Build one flat Set, hydrate once (chunks ≤50, concurrency=5).
  const unifiedVideoIds = new Set<string>();
  for (const walk of walks) {
    for (const id of walk.rawVideoIds) unifiedVideoIds.add(id);
  }

  let videoCache: Awaited<ReturnType<typeof hydrateVideoMetadataConcurrent>> = new Map();

  if (unifiedVideoIds.size > 0) {
    try {
      videoCache = await hydrateVideoMetadataConcurrent(Array.from(unifiedVideoIds), token);
    } catch (err) {
      if (isMetaAdAccountRateLimitError(err)) {
        // Rate-limit abort: mark every event as skipped, no partial writes.
        const skipReason =
          "User request limit reached (Meta #17) — try again in a few minutes.";
        return walks.map((w) => ({
          eventId: w.event.id,
          eventCode: w.code,
          eventName: w.event.name,
          matchedCampaigns: w.matched.map((c) => ({ id: c.id, name: c.name })),
          pagePublishedVideos: 0,
          orphanVideos: 0,
          audiences: [],
          skipped: true,
          skipReason,
        }));
      }
      throw err;
    }
  }

  // Phase 3 — build per-event rows from the cached metadata.
  return walks.map((walk): BulkPreviewRow => {
    const { event, code, matched, rawVideoIds, pageIds, errorMsg } = walk;
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
      };
    }

    // contextPageId: most-common page from creative-level extraction.
    const pageCounts = new Map<string, number>();
    for (const id of pageIds) {
      pageCounts.set(id, (pageCounts.get(id) ?? 0) + 1);
    }
    let contextPageId =
      pageCounts.size > 0
        ? [...pageCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        : undefined;

    // Orphan filter: drop videos with no FB Page association (no from.id).
    // Happens once here using the unified metadata cache — not per-event re-fetch.
    const videoFromPageCounts = new Map<string, number>();
    const validVideoIds: string[] = [];
    let orphanCount = 0;

    for (const videoId of rawVideoIds) {
      const meta = videoCache.get(videoId);
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
          ` (event ${code}). Meta requires videos to be published from a FB Page.`,
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
      const { threshold, retentionDays } = BULK_FUNNEL_CONFIG[stage];
      const name = buildAudienceName({ ...namingOpts, retentionDays, threshold });
      return { funnelStage: stage, name, threshold, retentionDays, videoIds: validVideoIds, campaignIds, campaignSummaries };
    });

    const customAudiences: BulkPreviewAudience[] = customStages.map((cs) => {
      const retentionDays = Math.min(META_MAX_RETENTION_DAYS, Math.max(1, Math.trunc(cs.retentionDays)));
      const name = buildAudienceName({ ...namingOpts, retentionDays, threshold: cs.threshold });
      return { funnelStage: "custom", name, threshold: cs.threshold, retentionDays, videoIds: validVideoIds, campaignIds, campaignSummaries };
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
