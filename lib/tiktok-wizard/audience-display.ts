import { canonicalTikTokLocationId } from "../tiktok/write/mapping.ts";

export const TIKTOK_REGION_SEARCH_LIMIT = 50;
export const TIKTOK_PICKER_ROW_LIMIT = 80;

export interface TikTokNamedRegion {
  id: string;
  name: string;
  countryCode?: string | null;
}

export interface TikTokNamedLanguage {
  id: string;
  name: string;
}

export interface TikTokCategoryDisplayRow {
  id: string;
  parent_id: string | null;
  label: string;
  depth: number;
}

export function filterTikTokRegions(
  regions: TikTokNamedRegion[],
  query: string,
  limit = TIKTOK_REGION_SEARCH_LIMIT,
): { rows: TikTokNamedRegion[]; total: number } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { rows: [], total: 0 };
  const matched = regions.filter((region) =>
    `${region.name} ${region.countryCode ?? ""} ${region.id}`
      .toLowerCase()
      .includes(needle),
  );
  return { rows: matched.slice(0, limit), total: matched.length };
}

export function visibleTikTokCategoryRows<T extends TikTokCategoryDisplayRow>(
  rows: T[],
  options: {
    query: string;
    expandedIds: readonly string[];
    limit?: number;
  },
): { rows: T[]; total: number; capped: boolean } {
  const limit = options.limit ?? TIKTOK_PICKER_ROW_LIMIT;
  const needle = options.query.trim().toLowerCase();
  const expanded = new Set(options.expandedIds);
  const filtered = needle
    ? rows.filter((row) => row.label.toLowerCase().includes(needle))
    : rows.filter(
        (row) => row.parent_id == null || expanded.has(row.parent_id),
      );
  return {
    rows: filtered.slice(0, limit),
    total: filtered.length,
    capped: filtered.length > limit,
  };
}

export function resolveTikTokLocationLabel(
  code: string,
  labels: Record<string, string>,
  regions: TikTokNamedRegion[],
): string {
  const stored = labels[code]?.trim();
  if (stored) return stored;
  const byId = regions.find((region) => region.id === code);
  if (byId?.name.trim()) return byId.name.trim();
  const byCountry = regions.find((region) => region.countryCode === code);
  if (byCountry?.name.trim()) return byCountry.name.trim();
  const canon = canonicalTikTokLocationId(code);
  if (canon && canon !== code) {
    const byCanon = regions.find((region) => region.id === canon);
    if (byCanon?.name.trim()) return byCanon.name.trim();
  }
  return code;
}

export function resolveTikTokLanguageLabel(
  code: string,
  labels: Record<string, string>,
  languages: TikTokNamedLanguage[],
): string {
  const stored = labels[code]?.trim();
  if (stored) return stored;
  const found = languages.find((language) => language.id === code);
  if (found?.name.trim()) return found.name.trim();
  return code;
}

export function resolveTikTokGenderLabel(gender: string): string {
  if (gender === "MALE") return "Male";
  if (gender === "FEMALE") return "Female";
  if (gender === "UNKNOWN") return "Unknown";
  return gender;
}
