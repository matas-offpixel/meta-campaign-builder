/**
 * Imported ad sets name their places with the ids the importer wrote
 * (`country:AE`, `country_group:europe`, …). A later edit can drop the
 * group objects those ids point at. Put the groups back from the id, and
 * when the ids themselves are empty, from the geo the import recorded on
 * `importMeta.dropped`.
 */

import type { MetaImportDropped } from "../meta/import/types.ts";
import type {
  CampaignDraft,
  LocationSelection,
  LocationTargetingGroup,
} from "../types.ts";

const IMPORT_ID = /^(country|country_group|region|city):/;

export function repairImportedLocations(draft: CampaignDraft): void {
  const schedule = draft.budgetSchedule;
  if (!schedule) return;
  const groups = [...(schedule.locationGroups ?? [])];
  const seen = new Set(groups.map((group) => group.id));

  const ensure = (id: string): boolean => {
    if (seen.has(id)) return true;
    const built = groupFromImportedLocationId(id);
    if (!built) return false;
    groups.push(built);
    seen.add(id);
    return true;
  };

  const meta = draft.importMeta;
  const restored = new Set(meta?.restoredDroppedLocationAdSetIds ?? []);

  for (const adSet of draft.adSetSuggestions ?? []) {
    if (!adSet.importedFromAdSetId) continue;
    for (const id of adSet.locationGroupIds ?? []) ensure(id);

    const ids = adSet.locationGroupIds ?? [];
    if (ids.length > 0 || adSet.locationGroupId || restored.has(adSet.id) || !meta) continue;
    const fromDropped: string[] = [];
    for (const id of locationIdsFromDropped(meta.dropped ?? [], adSet.id)) {
      if (ensure(id)) fromDropped.push(id);
    }
    if (fromDropped.length === 0) continue;
    adSet.locationGroupIds = fromDropped;
    restored.add(adSet.id);
  }

  schedule.locationGroups = groups;
  if (meta && restored.size > (meta.restoredDroppedLocationAdSetIds?.length ?? 0)) {
    meta.restoredDroppedLocationAdSetIds = [...restored];
  }
}

function groupFromImportedLocationId(id: string): LocationTargetingGroup | null {
  if (!IMPORT_ID.test(id)) return null;
  if (id.startsWith("country:")) {
    const code = id.slice("country:".length);
    if (!/^[A-Za-z]{2}$/.test(code)) return null;
    return group(id, code, {
      id,
      source: "search",
      label: code,
      mode: "include",
      locationType: "country",
      countryCode: code,
    });
  }
  if (id.startsWith("country_group:")) {
    const key = id.slice("country_group:".length);
    if (!key || key.includes(":")) return null;
    return group(id, key, {
      id,
      source: "search",
      label: key,
      mode: "include",
      locationType: "country_group",
      locationKey: key,
    });
  }
  if (id.startsWith("region:")) {
    const key = id.slice("region:".length);
    if (!key || key.includes(":")) return null;
    return group(id, key, {
      id,
      source: "search",
      label: key,
      mode: "include",
      locationType: "region",
      locationKey: key,
    });
  }
  const city = cityFromId(id);
  if (!city) return null;
  return group(id, city.label, {
    id,
    source: "search",
    label: city.label,
    mode: "include",
    locationType: "city",
    locationKey: city.key,
    radius: city.radius,
    distanceUnit: city.distanceUnit,
    countryCode: city.countryCode,
  });
}

function group(
  id: string,
  label: string,
  selection: LocationSelection,
): LocationTargetingGroup {
  return { id, label, source: "manual", selections: [selection] };
}

function cityFromId(id: string): {
  key: string;
  label: string;
  radius?: number;
  distanceUnit?: "kilometer" | "mile";
  countryCode?: string;
} | null {
  if (!id.startsWith("city:")) return null;
  const [key, radiusRaw, unitRaw, countryRaw] = id.slice("city:".length).split(":");
  if (!key) return null;
  const radius = radiusRaw ? Number(radiusRaw) : undefined;
  const distanceUnit = unitRaw === "mile" || unitRaw === "kilometer" ? unitRaw : undefined;
  return {
    key,
    label: key,
    radius: radius != null && Number.isFinite(radius) ? radius : undefined,
    distanceUnit,
    countryCode: countryRaw || undefined,
  };
}

function locationIdsFromDropped(dropped: readonly MetaImportDropped[], adSetId: string): string[] {
  const ids: string[] = [];
  for (const row of dropped) {
    if (row.adSetId !== adSetId || !Array.isArray(row.value)) continue;
    if (row.field === "countries") {
      for (const code of row.value) {
        if (typeof code === "string" && code.trim()) ids.push(`country:${code.trim()}`);
      }
    } else if (row.field === "country_groups") {
      for (const raw of row.value) {
        const key = recordKey(raw);
        if (key) ids.push(`country_group:${key}`);
      }
    } else if (row.field === "regions") {
      for (const raw of row.value) {
        const key = recordKey(raw);
        if (key) ids.push(`region:${key}`);
      }
    } else if (row.field === "cities") {
      for (const raw of row.value) {
        const cityId = cityIdFromDropped(raw);
        if (cityId) ids.push(cityId);
      }
    }
  }
  return ids;
}

function recordKey(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const key = (raw as { key?: unknown }).key;
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

function cityIdFromDropped(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as { key?: unknown; radius?: unknown; distance_unit?: unknown; country?: unknown };
  if (typeof row.key !== "string" || !row.key.trim()) return null;
  const radius = typeof row.radius === "number" && Number.isFinite(row.radius) ? String(row.radius) : "";
  const unit = row.distance_unit === "mile" || row.distance_unit === "kilometer" ? row.distance_unit : "";
  return `city:${row.key.trim()}:${radius}:${unit}`;
}
