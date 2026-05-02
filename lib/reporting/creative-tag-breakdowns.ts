import type {
  CreativeTagDimension,
  CreativeTagAssignmentRow,
  MotionCreativeTagRow,
} from "@/lib/db/creative-tags";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

export const SHARE_TAG_BREAKDOWN_DIMENSIONS = [
  "asset_type",
  "hook_tactic",
  "messaging_angle",
  "intended_audience",
] as const satisfies readonly CreativeTagDimension[];

const SHARE_TAG_BREAKDOWN_DIMENSION_ORDER = new Map<CreativeTagDimension, number>(
  SHARE_TAG_BREAKDOWN_DIMENSIONS.map((dimension, index) => [dimension, index]),
);

export interface CreativeTagBreakdownRow {
  value_key: string;
  value_label: string;
  ad_count: number;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  cpr: number | null;
  registrations: number;
  purchases: number;
}

export interface CreativeTagBreakdown {
  dimension: CreativeTagDimension;
  rows: CreativeTagBreakdownRow[];
}

export type CreativeTagAssignmentWithTag = CreativeTagAssignmentRow & {
  tag?:
    | Pick<MotionCreativeTagRow, "dimension" | "value_key" | "value_label">
    | null;
};

export interface CreativeTagTile {
  dimension: CreativeTagDimension;
  value_key: string;
  value_label: string;
  spend: number;
  registrations: number;
  impressions: number;
  reach: number;
  clicks: number;
  purchases: number;
  thumbnails: string[];
  fallbackLabel: string;
}

export function buildCreativeTagBreakdowns(
  groups: ConceptGroupRow[],
  assignments: CreativeTagAssignmentWithTag[],
): CreativeTagBreakdown[] {
  if (groups.length === 0 || assignments.length === 0) return [];

  const groupsByCreativeName = new Map<string, ConceptGroupRow[]>();
  for (const group of groups) {
    for (const name of candidateNamesForGroup(group)) {
      const key = normalizeCreativeName(name);
      if (!key) continue;
      const list = groupsByCreativeName.get(key) ?? [];
      list.push(group);
      groupsByCreativeName.set(key, list);
    }
  }

  const buckets = new Map<
    CreativeTagDimension,
    Map<string, CreativeTagBreakdownRow>
  >();
  const seen = new Set<string>();

  for (const assignment of assignments) {
    const tag = assignment.tag;
    if (!isSupportedDimension(tag?.dimension) || !tag.value_key || !tag.value_label) {
      continue;
    }
    const matchingGroups =
      groupsByCreativeName.get(normalizeCreativeName(assignment.creative_name)) ??
      [];

    for (const group of matchingGroups) {
      const seenKey = `${tag.dimension}\u0000${tag.value_key}\u0000${group.group_key}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const rowsByValue = buckets.get(tag.dimension) ?? new Map();
      const current =
        rowsByValue.get(tag.value_key) ??
        emptyRow(tag.value_key, tag.value_label);
      rowsByValue.set(tag.value_key, addGroup(current, group));
      buckets.set(tag.dimension, rowsByValue);
    }
  }

  return [...buckets.entries()]
    .map(([dimension, rowsByValue]) => ({
      dimension,
      rows: [...rowsByValue.values()]
        .map(recomputeRates)
        .sort((a, b) => b.spend - a.spend),
    }))
    .filter((breakdown) => breakdown.rows.length > 0)
    .sort(sortBreakdowns);
}

export function buildCreativeTagTiles(
  groups: ConceptGroupRow[],
  assignments: CreativeTagAssignmentWithTag[],
): CreativeTagTile[] {
  if (groups.length === 0 || assignments.length === 0) return [];

  const groupsByCreativeName = buildGroupsByCreativeName(groups);
  const buckets = new Map<string, { tag: NonNullable<CreativeTagAssignmentWithTag["tag"]>; groups: Map<string, ConceptGroupRow> }>();

  for (const assignment of assignments) {
    const tag = assignment.tag;
    if (!isSupportedDimension(tag?.dimension) || !tag.value_key || !tag.value_label) {
      continue;
    }
    const matchingGroups =
      groupsByCreativeName.get(normalizeCreativeName(assignment.creative_name)) ??
      [];
    const key = tagKey(tag.dimension, tag.value_key);
    const bucket = buckets.get(key) ?? { tag, groups: new Map<string, ConceptGroupRow>() };
    for (const group of matchingGroups) {
      bucket.groups.set(group.group_key, group);
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map(({ tag, groups: grouped }) => {
      const matchedGroups = [...grouped.values()];
      const totals = matchedGroups.reduce(
        (acc, group) => ({
          spend: acc.spend + group.spend,
          registrations: acc.registrations + group.registrations,
          impressions: acc.impressions + group.impressions,
          reach: acc.reach + group.reach,
          clicks: acc.clicks + group.clicks,
          purchases: acc.purchases + group.purchases,
        }),
        {
          spend: 0,
          registrations: 0,
          impressions: 0,
          reach: 0,
          clicks: 0,
          purchases: 0,
        },
      );
      const thumbnails = matchedGroups
        .filter((group) => Boolean(group.representative_thumbnail))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 4)
        .map((group) => group.representative_thumbnail as string);

      return {
        dimension: tag.dimension,
        value_key: tag.value_key,
        value_label: tag.value_label,
        ...totals,
        thumbnails,
        fallbackLabel: tag.value_label,
      };
    })
    .sort((a, b) => {
      const dimensionOrder =
        (SHARE_TAG_BREAKDOWN_DIMENSION_ORDER.get(a.dimension) ?? 99) -
        (SHARE_TAG_BREAKDOWN_DIMENSION_ORDER.get(b.dimension) ?? 99);
      if (dimensionOrder !== 0) return dimensionOrder;
      return b.spend - a.spend;
    });
}

function candidateNamesForGroup(group: ConceptGroupRow): string[] {
  return [group.display_name, ...group.ad_names].filter(Boolean);
}

function buildGroupsByCreativeName(
  groups: ConceptGroupRow[],
): Map<string, ConceptGroupRow[]> {
  const groupsByCreativeName = new Map<string, ConceptGroupRow[]>();
  for (const group of groups) {
    for (const name of candidateNamesForGroup(group)) {
      const key = normalizeCreativeName(name);
      if (!key) continue;
      const list = groupsByCreativeName.get(key) ?? [];
      list.push(group);
      groupsByCreativeName.set(key, list);
    }
  }
  return groupsByCreativeName;
}

function normalizeCreativeName(value: string | null | undefined): string {
  return (
    value
      ?.replace(/^\s*\[[^\]]+\]\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase() ?? ""
  );
}

function emptyRow(valueKey: string, valueLabel: string): CreativeTagBreakdownRow {
  return {
    value_key: valueKey,
    value_label: valueLabel,
    ad_count: 0,
    spend: 0,
    impressions: 0,
    reach: 0,
    clicks: 0,
    ctr: null,
    cpr: null,
    registrations: 0,
    purchases: 0,
  };
}

function isSupportedDimension(
  value: unknown,
): value is (typeof SHARE_TAG_BREAKDOWN_DIMENSIONS)[number] {
  return SHARE_TAG_BREAKDOWN_DIMENSIONS.includes(
    value as (typeof SHARE_TAG_BREAKDOWN_DIMENSIONS)[number],
  );
}

function sortBreakdowns(a: CreativeTagBreakdown, b: CreativeTagBreakdown): number {
  return (
    (SHARE_TAG_BREAKDOWN_DIMENSION_ORDER.get(a.dimension) ?? 99) -
    (SHARE_TAG_BREAKDOWN_DIMENSION_ORDER.get(b.dimension) ?? 99)
  );
}

function tagKey(dimension: CreativeTagDimension, valueKey: string): string {
  return `${dimension}\u0000${valueKey}`;
}

function addGroup(
  row: CreativeTagBreakdownRow,
  group: ConceptGroupRow,
): CreativeTagBreakdownRow {
  return {
    ...row,
    ad_count: row.ad_count + group.ad_count,
    spend: row.spend + group.spend,
    impressions: row.impressions + group.impressions,
    reach: row.reach + group.reach,
    clicks: row.clicks + group.clicks,
    registrations: row.registrations + group.registrations,
    purchases: row.purchases + group.purchases,
  };
}

function recomputeRates(row: CreativeTagBreakdownRow): CreativeTagBreakdownRow {
  return {
    ...row,
    ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null,
    cpr: row.registrations > 0 ? row.spend / row.registrations : null,
  };
}
