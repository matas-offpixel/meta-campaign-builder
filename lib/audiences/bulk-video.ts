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
import { mergeVideoSourcesDeduped } from "./merge-video-sources.ts";
import { eventCodeMatchesPrefix } from "./event-code-prefix-scanner.ts";
import {
  fetchAudienceCampaigns,
  fetchAudienceCampaignVideos,
} from "./sources.ts";
import {
  BULK_FUNNEL_CONFIG,
  type BulkFunnelStage,
  type BulkPreviewAudience,
  type BulkPreviewRow,
} from "./bulk-types.ts";
import type { Database } from "../db/database.types.ts";

export { BULK_FUNNEL_CONFIG, isBulkFunnelStage, previewRowsToInserts } from "./bulk-types.ts";
export type { BulkFunnelStage, BulkPreviewAudience, BulkPreviewRow } from "./bulk-types.ts";

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
}

/**
 * Resolves the full preview for a bulk video-views run.
 * Pure dry-run: no DB writes, no Meta writes.
 */
export async function runBulkVideoPreview(
  opts: RunBulkPreviewOpts,
): Promise<BulkPreviewRow[]> {
  const { supabase, userId, clientId, metaAdAccountId, clientName, clientSlug, token, eventCodePrefix, funnelStages } = opts;

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

  // 3. Process each event (capped at 5 concurrent)
  const rows = await mapConcurrent(events, 5, async (event): Promise<BulkPreviewRow> => {
    const code = event.event_code!.toUpperCase();

    const matched = allCampaigns.filter((c) =>
      campaignMatchesBracketedEventCode(c.name, code),
    );

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

    // 4. Fetch videos for each matched campaign
    const videoResults = await Promise.allSettled(
      matched.map((c) => fetchAudienceCampaignVideos(metaAdAccountId, c.id, token)),
    );

    let totalOrphan = 0;
    const videoGroups: Array<{ id: string }[]> = [];
    const contextCounts = new Map<string, number>();
    let errorMsg: string | undefined;

    for (const result of videoResults) {
      if (result.status === "rejected") {
        const msg =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        errorMsg = /rate.limit|429/i.test(msg)
          ? "Meta rate limit — retry in a few minutes."
          : `Failed to fetch videos: ${msg}`;
        continue;
      }
      const { videos, skippedCount, contextPageId: cpid } = result.value;
      totalOrphan += skippedCount;
      videoGroups.push(videos);
      if (cpid) {
        contextCounts.set(cpid, (contextCounts.get(cpid) ?? 0) + videos.length);
      }
    }

    const contextPageId =
      contextCounts.size > 0
        ? [...contextCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0]
        : undefined;

    const mergedVideos = mergeVideoSourcesDeduped(videoGroups);
    const campaignSummaries = matched.map((c) => ({ id: c.id, name: c.name }));
    const campaignIds = matched.map((c) => c.id);
    const videoIds = mergedVideos.map((v) => v.id);

    if (errorMsg) {
      return {
        eventId: event.id,
        eventCode: code,
        eventName: event.name,
        matchedCampaigns: campaignSummaries,
        pagePublishedVideos: mergedVideos.length,
        orphanVideos: totalOrphan,
        contextPageId,
        audiences: [],
        skipped: true,
        skipReason: errorMsg,
      };
    }

    if (mergedVideos.length === 0) {
      return {
        eventId: event.id,
        eventCode: code,
        eventName: event.name,
        matchedCampaigns: campaignSummaries,
        pagePublishedVideos: 0,
        orphanVideos: totalOrphan,
        contextPageId,
        audiences: [],
        skipped: true,
        skipReason:
          totalOrphan > 0
            ? "No page-published videos — all found videos were uploaded directly to the ad account."
            : "No videos found in matched campaigns.",
      };
    }

    // 5. Build proposed audiences per funnel stage
    const audiences: BulkPreviewAudience[] = funnelStages.map((stage) => {
      const { threshold, retentionDays } = BULK_FUNNEL_CONFIG[stage];
      const name = buildAudienceName({
        scope: "event",
        client: { slug: clientSlug, name: clientName },
        event: { eventCode: code, name: event.name },
        subtype: "video_views",
        retentionDays,
        threshold,
        campaignNames: campaignSummaries.map((c) => c.name),
      });
      return { funnelStage: stage, name, threshold, retentionDays, videoIds, campaignIds, campaignSummaries };
    });

    return {
      eventId: event.id,
      eventCode: code,
      eventName: event.name,
      matchedCampaigns: campaignSummaries,
      pagePublishedVideos: mergedVideos.length,
      orphanVideos: totalOrphan,
      contextPageId,
      audiences,
      skipped: false,
    };
  });

  return rows;
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

