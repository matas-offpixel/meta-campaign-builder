import type {
  CreativeTagAssignmentRow,
  MotionCreativeTagRow,
} from "@/lib/db/creative-tags";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

export interface CreativeTagBreakdownRow {
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
  dimension: string;
  rows: CreativeTagBreakdownRow[];
}

export type CreativeTagAssignmentWithTag = CreativeTagAssignmentRow & {
  tag?: Pick<MotionCreativeTagRow, "dimension" | "value_label"> | null;
};

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

  const buckets = new Map<string, Map<string, CreativeTagBreakdownRow>>();
  const seen = new Set<string>();

  for (const assignment of assignments) {
    const tag = assignment.tag;
    if (!tag?.dimension || !tag.value_label) continue;
    const matchingGroups =
      groupsByCreativeName.get(normalizeCreativeName(assignment.creative_name)) ??
      [];

    for (const group of matchingGroups) {
      const seenKey = `${tag.dimension}\u0000${tag.value_label}\u0000${group.group_key}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      const rowsByValue = buckets.get(tag.dimension) ?? new Map();
      const current =
        rowsByValue.get(tag.value_label) ??
        emptyRow(tag.value_label);
      rowsByValue.set(tag.value_label, addGroup(current, group));
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
    .sort((a, b) => a.dimension.localeCompare(b.dimension));
}

function candidateNamesForGroup(group: ConceptGroupRow): string[] {
  return [group.display_name, ...group.ad_names].filter(Boolean);
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

function emptyRow(valueLabel: string): CreativeTagBreakdownRow {
  return {
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
