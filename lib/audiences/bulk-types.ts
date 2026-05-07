/**
 * Pure types, constants and converters for bulk video audience creation.
 * No runtime dependencies on lib/meta/* so tests can import without
 * hitting MetaApiError (TS parameter properties, strip-only incompatible).
 */
import type { FunnelStage, MetaCustomAudienceInsert } from "../types/audience.ts";

// ── Funnel stage configuration ────────────────────────────────────────────────

export type BulkFunnelStage = "top_of_funnel" | "mid_funnel" | "bottom_funnel";

export const BULK_FUNNEL_CONFIG: Record<
  BulkFunnelStage,
  { threshold: 25 | 50 | 75 | 95 | 100; retentionDays: number }
> = {
  top_of_funnel: { threshold: 50, retentionDays: 365 },
  mid_funnel: { threshold: 75, retentionDays: 60 },
  bottom_funnel: { threshold: 95, retentionDays: 30 },
};

export function isBulkFunnelStage(v: unknown): v is BulkFunnelStage {
  return (
    v === "top_of_funnel" || v === "mid_funnel" || v === "bottom_funnel"
  );
}

// ── Preview types ─────────────────────────────────────────────────────────────

export interface BulkPreviewAudience {
  funnelStage: BulkFunnelStage;
  name: string;
  threshold: number;
  retentionDays: number;
  videoIds: string[];
  campaignIds: string[];
  campaignSummaries: Array<{ id: string; name: string }>;
}

export interface BulkPreviewRow {
  eventId: string;
  eventCode: string;
  eventName: string;
  matchedCampaigns: Array<{ id: string; name: string }>;
  /** Page-published videos available (after orphan filter). */
  pagePublishedVideos: number;
  /** Videos dropped because they had no FB Page link. */
  orphanVideos: number;
  contextPageId?: string;
  /** Proposed audiences for this event (one per requested funnel stage). */
  audiences: BulkPreviewAudience[];
  skipped: boolean;
  skipReason?: string;
}

// ── Preview → DB insert conversion ───────────────────────────────────────────

/**
 * Converts non-skipped preview rows into `MetaCustomAudienceInsert[]` ready
 * for `createAudienceDrafts`. Skipped rows are excluded.
 */
export function previewRowsToInserts(
  rows: BulkPreviewRow[],
  opts: {
    userId: string;
    clientId: string;
    metaAdAccountId: string;
    funnelStages: BulkFunnelStage[];
  },
): MetaCustomAudienceInsert[] {
  const inserts: MetaCustomAudienceInsert[] = [];
  for (const row of rows) {
    if (row.skipped) continue;
    for (const audience of row.audiences) {
      inserts.push({
        userId: opts.userId,
        clientId: opts.clientId,
        eventId: row.eventId,
        name: audience.name,
        funnelStage: audience.funnelStage as FunnelStage,
        audienceSubtype: "video_views",
        retentionDays: audience.retentionDays,
        sourceId: audience.videoIds.join(","),
        sourceMeta: {
          subtype: "video_views",
          threshold: audience.threshold as 25 | 50 | 75 | 95 | 100,
          videoIds: audience.videoIds,
          campaignId: audience.campaignIds[0],
          campaignIds: audience.campaignIds,
          campaignSummaries: audience.campaignSummaries,
          campaignName: audience.campaignSummaries[0]?.name,
        },
        metaAdAccountId: opts.metaAdAccountId,
      });
    }
  }
  return inserts;
}
