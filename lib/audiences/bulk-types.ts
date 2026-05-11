/**
 * Pure types, constants and converters for bulk video audience creation.
 * No runtime dependencies on lib/meta/* so tests can import without
 * hitting MetaApiError (TS parameter properties, strip-only incompatible).
 */
import type { FunnelStage, MetaCustomAudienceInsert } from "../types/audience.ts";

// ── Funnel stage configuration ────────────────────────────────────────────────

export type BulkFunnelStage = "mid_top" | "mid" | "mid_bottom" | "bottom";

export const BULK_FUNNEL_CONFIG: Record<
  BulkFunnelStage,
  { threshold: 25 | 50 | 75 | 95 | 100; retentionDays: number; label: string }
> = {
  mid_top:    { threshold: 50, retentionDays: 365, label: "Mid-Top" },
  mid:        { threshold: 75, retentionDays: 180, label: "Mid" },
  mid_bottom: { threshold: 95, retentionDays: 60,  label: "Mid-Bottom" },
  bottom:     { threshold: 95, retentionDays: 30,  label: "Bottom" },
};

/** Maps bulk preset stages to the canonical DB FunnelStage values. */
const BULK_STAGE_TO_FUNNEL_STAGE: Record<BulkFunnelStage, FunnelStage> = {
  mid_top:    "top_of_funnel",
  mid:        "mid_funnel",
  mid_bottom: "bottom_funnel",
  bottom:     "bottom_funnel",
};

export function isBulkFunnelStage(v: unknown): v is BulkFunnelStage {
  return (
    v === "mid_top" || v === "mid" || v === "mid_bottom" || v === "bottom"
  );
}

// ── Custom stage configuration ────────────────────────────────────────────────

/** Meta's maximum retention window for video-views audiences (days). */
export const META_MAX_RETENTION_DAYS = 365;

/** Valid video-view threshold percentages accepted by Meta. */
export const VALID_VIDEO_THRESHOLDS = [25, 50, 75, 95, 100] as const;
export type VideoThreshold = (typeof VALID_VIDEO_THRESHOLDS)[number];

/**
 * A user-defined (threshold, retentionDays) pair that generates one audience
 * per event — same payload shape as a funnel preset but fully configurable.
 * retentionDays is clamped to META_MAX_RETENTION_DAYS at preview time.
 */
export interface BulkCustomStage {
  threshold: VideoThreshold;
  retentionDays: number;
}

export function isValidCustomStage(v: unknown): v is BulkCustomStage {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    (VALID_VIDEO_THRESHOLDS as readonly number[]).includes(o.threshold as number) &&
    typeof o.retentionDays === "number" &&
    o.retentionDays >= 1
  );
}

/** Returns true when at least one funnel or custom stage is specified. */
export function hasBulkStages(
  funnelStages: BulkFunnelStage[],
  customStages: BulkCustomStage[],
): boolean {
  return funnelStages.length > 0 || customStages.length > 0;
}

// ── Preview types ─────────────────────────────────────────────────────────────

export interface BulkPreviewAudience {
  /** Funnel preset name, or "custom" for user-defined (threshold, retentionDays) pairs. */
  funnelStage: BulkFunnelStage | "custom";
  name: string;
  threshold: number;
  retentionDays: number;
  videoIds: string[];
  campaignIds: string[];
  campaignSummaries: Array<{ id: string; name: string }>;
  /** FB page ID that owns the videos — required for Meta video audience rule (source_meta.contextId). */
  contextId?: string;
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
 * Custom stages (funnelStage === "custom") are stored as "retargeting" in the DB.
 */
export function previewRowsToInserts(
  rows: BulkPreviewRow[],
  opts: {
    userId: string;
    clientId: string;
    metaAdAccountId: string;
  },
): MetaCustomAudienceInsert[] {
  const inserts: MetaCustomAudienceInsert[] = [];
  for (const row of rows) {
    if (row.skipped) continue;
    for (const audience of row.audiences) {
      const funnelStage: FunnelStage =
        audience.funnelStage === "custom"
          ? "retargeting"
          : BULK_STAGE_TO_FUNNEL_STAGE[audience.funnelStage];
      inserts.push({
        userId: opts.userId,
        clientId: opts.clientId,
        eventId: row.eventId,
        name: audience.name,
        funnelStage,
        audienceSubtype: "video_views",
        retentionDays: audience.retentionDays,
        sourceId: audience.videoIds.join(","),
        sourceMeta: {
          subtype: "video_views",
          threshold: audience.threshold as 25 | 50 | 75 | 95 | 100,
          videoIds: audience.videoIds,
          contextId: audience.contextId,
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
