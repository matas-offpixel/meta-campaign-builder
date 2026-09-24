/**
 * Representable ad-group targeting for TikTok import.
 *
 * The draft has one campaign-level `audiences`. Ad groups that differ
 * only in budget, name and creative assignment can all be carried.
 * Targeting `applyTargeting` maps is compared; fields in
 * `TIKTOK_IMPORT_UNCARRIABLE_TARGETING_FIELDS` are dropped for every
 * group equally and are not part of the comparison.
 */

import { TIKTOK_AGE_GROUP_RANGES, TIKTOK_LOCATION_IDS_BY_CODE } from "../write/mapping.ts";
import { requireObjectFromCandidates } from "./envelope.ts";
import type { TikTokAdGroupGetRow, TikTokImportLiveBundle } from "./readers.ts";
import type { TikTokImportNotCarried } from "./types.ts";

const LOCATION_CODES_BY_ID = Object.fromEntries(
  Object.entries(TIKTOK_LOCATION_IDS_BY_CODE).map(([code, id]) => [id, code]),
);

export type RepresentableTargeting = {
  locationCodes: string[];
  age: { min: number; max: number } | "absent" | { unmapped: unknown };
  genders: string[];
  languages: string[];
  interestCategoryIds: string[];
  interestKeywordIds: string[];
  behaviourCategoryIds: string[];
  customAudienceIds: string[];
};

export type ImportAdGroupView = {
  index: number;
  id: string;
  name: string;
  raw: Record<string, unknown>;
  targeting: RepresentableTargeting;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean)
    .sort();
}

function mapLocationCodes(ids: unknown): string[] {
  return asStringArray(ids).map((id) => LOCATION_CODES_BY_ID[id] ?? id);
}

function mapAgeRange(ageGroups: unknown): { min: number; max: number } | null {
  const groups = asStringArray(ageGroups);
  const ranges = TIKTOK_AGE_GROUP_RANGES.filter((bucket) =>
    groups.includes(bucket.id),
  );
  if (ranges.length === 0) return null;
  return {
    min: Math.min(...ranges.map((bucket) => bucket.min)),
    max: Math.max(...ranges.map((bucket) => bucket.max)),
  };
}

function hasAgeGroups(source: Record<string, unknown>): boolean {
  return "age_groups" in source && source.age_groups != null &&
    !(Array.isArray(source.age_groups) && source.age_groups.length === 0) &&
    source.age_groups !== "";
}

export function unwrapManualTargeting(
  group: TikTokAdGroupGetRow,
): Record<string, unknown> {
  if (group.targeting_spec && typeof group.targeting_spec === "object") {
    return { ...group, ...group.targeting_spec };
  }
  return group;
}

export function unwrapUpgradedTargeting(
  group: TikTokAdGroupGetRow,
): Record<string, unknown> {
  const spec = requireObjectFromCandidates(
    group,
    ["targeting_spec"],
    "/smart_plus/adgroup/get/ targeting_spec",
  );
  return { ...group, ...spec };
}

/**
 * The fields `applyTargeting` in `map.ts` writes onto `draft.audiences`.
 * Keep this list in lock-step with that function.
 */
export function representableTargeting(
  source: Record<string, unknown>,
): RepresentableTargeting {
  let age: RepresentableTargeting["age"] = "absent";
  if (hasAgeGroups(source)) {
    const mapped = mapAgeRange(source.age_groups);
    age = mapped ?? { unmapped: source.age_groups };
  }
  const gender = asString(source.gender);
  let genders: string[] = [];
  if (gender === "GENDER_MALE") genders = ["MALE"];
  else if (gender === "GENDER_FEMALE") genders = ["FEMALE"];
  const behaviour = asStringArray(
    (source.actions as Array<{ action_category_ids?: unknown }> | undefined)
      ?.flatMap((action) => asStringArray(action.action_category_ids)) ??
      source.action_category_ids,
  );
  return {
    locationCodes: mapLocationCodes(source.location_ids),
    age,
    genders,
    languages: asStringArray(source.languages),
    interestCategoryIds: asStringArray(source.interest_category_ids),
    interestKeywordIds: asStringArray(source.interest_keyword_ids),
    behaviourCategoryIds: behaviour,
    customAudienceIds: asStringArray(source.audience_ids),
  };
}

export function targetingEqual(
  a: RepresentableTargeting,
  b: RepresentableTargeting,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatAge(age: RepresentableTargeting["age"]): string {
  if (age === "absent") return "no age restriction";
  if ("unmapped" in age) return JSON.stringify(age.unmapped);
  return `${age.min}–${age.max}`;
}

function formatList(values: string[], empty: string): string {
  return values.length === 0 ? empty : values.join(", ");
}

const FIELD_FORMATTERS: Record<
  keyof RepresentableTargeting,
  (value: RepresentableTargeting[keyof RepresentableTargeting]) => string
> = {
  locationCodes: (value) =>
    formatList(value as string[], "no locations"),
  age: (value) => formatAge(value as RepresentableTargeting["age"]),
  genders: (value) => {
    const genders = value as string[];
    if (genders.length === 0) return "all genders";
    return genders.join(", ");
  },
  languages: (value) => formatList(value as string[], "no languages"),
  interestCategoryIds: (value) =>
    formatList(value as string[], "no interest categories"),
  interestKeywordIds: (value) =>
    formatList(value as string[], "no interest keywords"),
  behaviourCategoryIds: (value) =>
    formatList(value as string[], "no behaviours"),
  customAudienceIds: (value) =>
    formatList(value as string[], "no custom audiences"),
};

const FIELD_NOUN: Record<keyof RepresentableTargeting, string> = {
  locationCodes: "locations",
  age: "ages",
  genders: "gender",
  languages: "languages",
  interestCategoryIds: "interest categories",
  interestKeywordIds: "interest keywords",
  behaviourCategoryIds: "behaviours",
  customAudienceIds: "custom audiences",
};

function differingFields(
  a: RepresentableTargeting,
  b: RepresentableTargeting,
): Array<keyof RepresentableTargeting> {
  return (Object.keys(a) as Array<keyof RepresentableTargeting>).filter(
    (field) => JSON.stringify(a[field]) !== JSON.stringify(b[field]),
  );
}

function groupLabel(group: ImportAdGroupView): string {
  return `ad group ${group.index} "${group.name}"`;
}

/**
 * Null when every group's representable targeting is identical.
 * Otherwise a sentence the operator can act on: which field, both
 * values, and that the draft holds one audience.
 */
export function formatAdGroupTargetingDiff(
  groups: readonly ImportAdGroupView[],
  kind: TikTokImportLiveBundle["kind"],
): string | null {
  if (groups.length <= 1) return null;
  const first = groups[0]!;
  const diffs: string[] = [];
  for (const group of groups.slice(1)) {
    const fields = differingFields(first.targeting, group.targeting);
    for (const field of fields) {
      const noun = FIELD_NOUN[field];
      const theirs = FIELD_FORMATTERS[field](group.targeting[field]);
      const ours = FIELD_FORMATTERS[field](first.targeting[field]);
      diffs.push(
        `${groupLabel(group)} targets ${noun} ${theirs} where ${groupLabel(first)} targets ${ours}`,
      );
    }
  }
  if (diffs.length === 0) return null;
  const smart = kind === "smart_plus" ? " Smart+" : "";
  return (
    `the source campaign has ${groups.length}${smart} ad groups whose targeting the draft cannot hold together. ` +
    `${diffs.join("; ")} — the draft holds one audience for the whole campaign. ` +
    `Pick one ad group in the picker to import it.`
  );
}

export function viewsFromAdGroups(
  adGroups: readonly TikTokAdGroupGetRow[],
  kind: TikTokImportLiveBundle["kind"],
): ImportAdGroupView[] {
  const unwrap =
    kind === "smart_plus" ? unwrapUpgradedTargeting : unwrapManualTargeting;
  return adGroups.map((group, index) => {
    const raw = unwrap(group);
    return {
      index: index + 1,
      id: asString(raw.adgroup_id) ?? `import-adgroup-${index + 1}`,
      name: asString(raw.adgroup_name) ?? "Imported ad group",
      raw,
      targeting: representableTargeting(raw),
    };
  });
}

export function inspectImportAdGroups(bundle: TikTokImportLiveBundle): {
  groups: Array<{ id: string; name: string }>;
  targetingDiffers: boolean;
  targetingDiffMessage: string | null;
} {
  if (bundle.kind === "legacy_smart_plus") {
    return { groups: [], targetingDiffers: false, targetingDiffMessage: null };
  }
  try {
    const views = viewsFromAdGroups(bundle.adGroups, bundle.kind);
    const message = formatAdGroupTargetingDiff(views, bundle.kind);
    return {
      groups: views.map((group) => ({ id: group.id, name: group.name })),
      targetingDiffers: Boolean(message),
      targetingDiffMessage: message,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      groups: bundle.adGroups.map((group, index) => ({
        id: asString(group.adgroup_id) ?? `import-adgroup-${index + 1}`,
        name: asString(group.adgroup_name) ?? "Imported ad group",
      })),
      targetingDiffers: bundle.adGroups.length > 1,
      targetingDiffMessage:
        bundle.adGroups.length > 1
          ? `the source campaign has ${bundle.adGroups.length} ad groups and their targeting could not be compared (${message}). Pick one ad group in the picker to import it.`
          : null,
    };
  }
}

export function filterBundleToAdGroup(
  bundle: TikTokImportLiveBundle,
  adGroupId: string,
): TikTokImportLiveBundle {
  return {
    ...bundle,
    adGroups: bundle.adGroups.filter(
      (group) => asString(group.adgroup_id) === adGroupId,
    ),
    ads: bundle.ads.filter((ad) => asString(ad.adgroup_id) === adGroupId),
    smartPlusAds: bundle.smartPlusAds.filter(
      (ad) => asString(ad.adgroup_id) === adGroupId,
    ),
  };
}

export function notCarriedForSkippedAdGroups(
  skipped: readonly ImportAdGroupView[],
): TikTokImportNotCarried[] {
  return skipped.map((group) => ({
    adId: group.id,
    name: group.name,
    videoId: null,
    reason: "adgroup_targeting_differs",
    adFormat: null,
  }));
}
