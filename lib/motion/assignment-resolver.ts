import type { CreativeTagDimension } from "../db/creative-tags.ts";

export interface MotionAssignmentEvent {
  id: string;
  event_code: string | null;
}

export interface ResolvedMotionAssignment {
  event_id: string;
  creative_name: string;
  dimension: CreativeTagDimension;
  value_key: string;
  source: "manual";
}

export interface MotionAssignmentDrop {
  creative_id: string;
  reason:
    | "missing_motion_insight"
    | "missing_campaign_event_code"
    | "unknown_event_code"
    | "missing_creative_name";
  campaign_name?: string | null;
}

export interface MotionAssignmentCoverageReport {
  mapped_creatives: number;
  dropped_creatives: number;
  dropped_by_reason: Record<MotionAssignmentDrop["reason"], number>;
  drops: MotionAssignmentDrop[];
}

export interface ResolveMotionAssignmentsResult {
  assignments: ResolvedMotionAssignment[];
  report: MotionAssignmentCoverageReport;
}

interface MotionCreativeTag {
  creativeId: string;
  dimension: CreativeTagDimension;
  valueKey: string;
}

interface MotionInsightCreative {
  creativeKey: string;
  adName: string | null;
  campaignName: string | null;
}

const DIMENSION_ALIASES: Record<string, CreativeTagDimension> = {
  "asset type": "asset_type",
  asset_type: "asset_type",
  "visual format": "visual_format",
  visual_format: "visual_format",
  "messaging angle": "messaging_angle",
  messaging_angle: "messaging_angle",
  "messaging theme": "messaging_angle",
  "intended audience": "intended_audience",
  intended_audience: "intended_audience",
  "hook tactic": "hook_tactic",
  hook_tactic: "hook_tactic",
  "headline tactic": "headline_tactic",
  headline_tactic: "headline_tactic",
  "offer type": "offer_type",
  offer_type: "offer_type",
  seasonality: "seasonality",
};

const DROP_REASONS: MotionAssignmentDrop["reason"][] = [
  "missing_motion_insight",
  "missing_campaign_event_code",
  "unknown_event_code",
  "missing_creative_name",
];

export function resolveMotionAssignments(
  glossaryJson: unknown,
  insightsJson: unknown,
  events: MotionAssignmentEvent[],
): ResolveMotionAssignmentsResult {
  const insightsByCreativeId = buildInsightCreativeIndex(insightsJson);
  const eventIdByCode = new Map(
    events
      .filter((event) => event.event_code?.trim())
      .map((event) => [event.event_code!.trim(), event.id]),
  );
  const tags = extractCreativeTags(glossaryJson);
  const assignments: ResolvedMotionAssignment[] = [];
  const assignmentKeys = new Set<string>();
  const mappedCreativeIds = new Set<string>();
  const droppedCreativeIds = new Set<string>();
  const drops: MotionAssignmentDrop[] = [];

  for (const tag of tags) {
    const insight = insightsByCreativeId.get(tag.creativeId);
    if (!insight) {
      recordDrop(tag.creativeId, { reason: "missing_motion_insight" });
      continue;
    }

    const eventCode = parseEventCode(insight.campaignName);
    if (!eventCode) {
      recordDrop(tag.creativeId, {
        reason: "missing_campaign_event_code",
        campaign_name: insight.campaignName,
      });
      continue;
    }

    const eventId = eventIdByCode.get(eventCode);
    if (!eventId) {
      recordDrop(tag.creativeId, {
        reason: "unknown_event_code",
        campaign_name: insight.campaignName,
      });
      continue;
    }

    const creativeName = normalizeCreativeName(insight.adName, eventCode);
    if (!creativeName) {
      recordDrop(tag.creativeId, {
        reason: "missing_creative_name",
        campaign_name: insight.campaignName,
      });
      continue;
    }

    const assignmentKey = [
      eventId,
      creativeName,
      tag.dimension,
      tag.valueKey,
    ].join("\u0000");
    if (assignmentKeys.has(assignmentKey)) continue;
    assignmentKeys.add(assignmentKey);
    mappedCreativeIds.add(tag.creativeId);
    assignments.push({
      event_id: eventId,
      creative_name: creativeName,
      dimension: tag.dimension,
      value_key: tag.valueKey,
      source: "manual",
    });
  }

  const droppedByReason = Object.fromEntries(
    DROP_REASONS.map((reason) => [reason, 0]),
  ) as Record<MotionAssignmentDrop["reason"], number>;
  for (const drop of drops) droppedByReason[drop.reason] += 1;

  return {
    assignments,
    report: {
      mapped_creatives: mappedCreativeIds.size,
      dropped_creatives: droppedCreativeIds.size,
      dropped_by_reason: droppedByReason,
      drops,
    },
  };

  function recordDrop(
    creativeId: string,
    drop: Omit<MotionAssignmentDrop, "creative_id">,
  ) {
    if (droppedCreativeIds.has(creativeId)) return;
    droppedCreativeIds.add(creativeId);
    drops.push({ creative_id: creativeId, ...drop });
  }
}

export function normalizeMotionValueKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function extractCreativeTags(glossaryJson: unknown): MotionCreativeTag[] {
  if (!isRecord(glossaryJson) || !Array.isArray(glossaryJson.data)) return [];
  const out: MotionCreativeTag[] = [];

  for (const dimensionGroup of glossaryJson.data) {
    if (!isRecord(dimensionGroup)) continue;
    const dimension = normalizeDimension(readString(dimensionGroup, "name"));
    if (!dimension || !Array.isArray(dimensionGroup.values)) continue;

    for (const value of dimensionGroup.values) {
      if (!isRecord(value) || !Array.isArray(value.creativeIds)) continue;
      const valueName = readString(value, "name");
      if (!valueName) continue;
      const valueKey = normalizeMotionValueKey(valueName);
      for (const creativeId of value.creativeIds) {
        if (typeof creativeId === "string" && creativeId.trim()) {
          out.push({
            creativeId: creativeId.trim(),
            dimension,
            valueKey,
          });
        }
      }
    }
  }

  return out;
}

function buildInsightCreativeIndex(
  insightsJson: unknown,
): Map<string, MotionInsightCreative> {
  const rows = readInsightRows(insightsJson);
  const out = new Map<string, MotionInsightCreative>();

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const ad = isRecord(row.ad) ? row.ad : {};
    const insight: MotionInsightCreative = {
      creativeKey: readString(row, "creativeKey") ?? "",
      adName: readString(ad, "name") ?? readString(ad, "adName") ?? null,
      campaignName:
        readString(row, "campaignName") ??
        readString(ad, "campaignName") ??
        null,
    };

    for (const creativeId of collectInsightCreativeIds(row, ad)) {
      if (!out.has(creativeId)) out.set(creativeId, insight);
    }
  }

  return out;
}

function readInsightRows(insightsJson: unknown): unknown[] {
  if (!isRecord(insightsJson)) return [];
  const data = isRecord(insightsJson.data) ? insightsJson.data : {};
  const nestedData = isRecord(data.data) ? data.data : data;
  const insightsResult = isRecord(nestedData.insightsResult)
    ? nestedData.insightsResult
    : {};
  const resultData = isRecord(insightsResult.data) ? insightsResult.data : {};
  return Array.isArray(resultData.insights) ? resultData.insights : [];
}

function collectInsightCreativeIds(
  row: Record<string, unknown>,
  ad: Record<string, unknown>,
): string[] {
  const ids = new Set<string>();
  addString(ids, row.creativeKey);
  addString(ids, row.creativeAssetId);
  addString(ids, ad.creativeAssetId);
  addString(ids, ad.videoCreativeAssetId);
  addString(ids, ad.multiCreativeCreativeAssetId);
  addString(ids, ad.creativeId);
  addStrings(ids, ad.primaryCreativeAssetIds);
  return [...ids];
}

function parseEventCode(campaignName: string | null): string | null {
  const match = campaignName?.match(/\[([^\]]+)\]/);
  return match?.[1]?.trim() || null;
}

function normalizeCreativeName(
  adName: string | null,
  eventCode: string,
): string | null {
  const normalized = adName
    ?.replace(new RegExp(`^\\s*\\[${escapeRegExp(eventCode)}\\]\\s*`), "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function normalizeDimension(
  value: string | undefined,
): CreativeTagDimension | null {
  if (!value) return null;
  return (
    DIMENSION_ALIASES[value.trim().toLowerCase().replace(/-/g, "_")] ?? null
  );
}

function addString(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.trim()) target.add(value.trim());
}

function addStrings(target: Set<string>, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) addString(target, item);
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
