"use client";

import { useMemo, useState, useCallback } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DollarSign, Zap, Lightbulb, MapPin, Search, X, Loader2, Plus } from "lucide-react";
import type {
  BudgetScheduleSettings,
  BudgetLevel,
  BudgetType,
  AdSetSuggestion,
  AdSetGeoLocations,
  AudienceSettings,
  LocationTargetingGroup,
  LocationSelection,
  LookalikeRange,
} from "@/lib/types";
import { TIMEZONES } from "@/lib/mock-data";
import { suggestAgeRange } from "@/lib/interest-suggestions";
import { useLocationSearch, type LocationSearchResult } from "@/lib/hooks/useMeta";

// ─── Preset definitions ──────────────────────────────────────────────────────
// Presets are resolved at runtime via the same Meta location-search API
// as manual searches, guaranteeing identical location objects.

interface PresetConfig {
  id: string;
  short: string;
  label: string;
  steps: PresetSearchStep[];
}

interface PresetSearchStep {
  query: string;
  type: "city" | "country";
  /** For city, match by country_code to avoid Oxnard-type ambiguity */
  matchCountryCode?: string;
  mode: "include" | "exclude";
  radius?: number;
  distanceUnit?: "kilometer" | "mile";
}

const PRESET_CONFIGS: PresetConfig[] = [
  {
    id: "preset_gb_nationwide",
    short: "UK",
    label: "UK (nationwide)",
    steps: [{ query: "United Kingdom", type: "country", matchCountryCode: "GB", mode: "include" }],
  },
  {
    id: "preset_london_40km",
    short: "London +40km",
    label: "London, England +40 km",
    steps: [
      { query: "London", type: "city", matchCountryCode: "GB", mode: "include", radius: 40, distanceUnit: "kilometer" },
    ],
  },
  {
    id: "preset_uk_excl_london",
    short: "UK excl London +40km",
    label: "UK excluding London +40 km",
    steps: [
      { query: "United Kingdom", type: "country", matchCountryCode: "GB", mode: "include" },
      { query: "London", type: "city", matchCountryCode: "GB", mode: "exclude", radius: 40, distanceUnit: "kilometer" },
    ],
  },
];

/** UK nationwide fallback (country-level, no API call needed) */
const FALLBACK_UK_NATIONWIDE: LocationTargetingGroup = {
  id: "preset_gb_nationwide",
  label: "UK (nationwide)",
  source: "preset",
  selections: [{
    id: "gb_nationwide_include",
    source: "preset",
    label: "United Kingdom",
    mode: "include",
    locationType: "country",
    countryCode: "GB",
  }],
};

// ─── Convert LocationTargetingGroup → AdSetGeoLocations ──────────────────────

function groupToGeo(group: LocationTargetingGroup): AdSetGeoLocations {
  const geo: AdSetGeoLocations = {};
  const excluded: AdSetGeoLocations = {};

  for (const sel of group.selections) {
    if (sel.mode === "include") {
      if (sel.locationType === "country" && sel.countryCode) {
        geo.countries = geo.countries ?? [];
        geo.countries.push(sel.countryCode);
      } else if (sel.locationType === "city" && sel.locationKey) {
        geo.cities = geo.cities ?? [];
        geo.cities.push({
          key: sel.locationKey,
          radius: sel.radius,
          distance_unit: sel.distanceUnit,
        });
      } else if (sel.locationType === "region" && sel.locationKey) {
        geo.regions = geo.regions ?? [];
        geo.regions.push({ key: sel.locationKey });
      }
    } else {
      if (sel.locationType === "city" && sel.locationKey) {
        excluded.cities = excluded.cities ?? [];
        excluded.cities.push({
          key: sel.locationKey,
          radius: sel.radius,
          distance_unit: sel.distanceUnit,
        });
      }
    }
  }

  if (excluded.cities?.length) {
    geo.excluded_geo_locations = excluded;
  }

  return geo;
}

// ─── Build a LocationSelection from a Meta search result ─────────────────────
// This single function is used by BOTH manual search and preset resolution,
// ensuring identical objects.

function searchResultToSelection(
  result: LocationSearchResult,
  mode: "include" | "exclude" = "include",
  radius?: number,
  distanceUnit?: "kilometer" | "mile",
  source: "search" | "preset" = "search",
): LocationSelection {
  const label = [result.name, result.region, result.country_name]
    .filter(Boolean)
    .join(", ");

  return {
    id: `${result.type}_${result.key}_${mode}_${Date.now()}`,
    source,
    label,
    mode,
    locationType: result.type as "city" | "country" | "region",
    locationKey: result.type !== "country" ? result.key : undefined,
    countryCode: result.type === "country" ? result.country_code : undefined,
    radius: result.type === "city" ? (radius ?? 40) : undefined,
    distanceUnit: result.type === "city" ? (distanceUnit ?? "kilometer") : undefined,
  };
}

// Known-good London city key from Meta's location database.
// Used as a fallback if the live Meta search doesn't return GB London.
const LONDON_VERIFIED_KEY = "2421178";

/**
 * Resolve a preset via Meta location search so it produces the identical
 * LocationSelection objects as manual search. Returns null on failure.
 */
async function resolvePreset(config: PresetConfig): Promise<LocationTargetingGroup | null> {
  const selections: LocationSelection[] = [];

  for (const step of config.steps) {
    const typesParam = step.type === "country" ? "country" : "city";
    const res = await fetch(
      `/api/meta/location-search?q=${encodeURIComponent(step.query)}&types=${typesParam}`,
    );
    const json = (await res.json()) as { data?: LocationSearchResult[]; error?: string };
    if (!res.ok || json.error || !json.data?.length) {
      console.warn(`[resolvePreset] No results for "${step.query}" (${step.type})`, json.error);

      // Hardcoded fallback for London to prevent misresolution
      if (step.query === "London" && step.type === "city" && step.matchCountryCode === "GB") {
        selections.push({
          id: `city_${LONDON_VERIFIED_KEY}_${step.mode}_${Date.now()}`,
          source: "preset",
          label: "London, England, United Kingdom",
          mode: step.mode,
          locationType: "city",
          locationKey: LONDON_VERIFIED_KEY,
          radius: step.radius ?? 40,
          distanceUnit: step.distanceUnit ?? "kilometer",
        });
        continue;
      }
      return null;
    }

    let match = step.matchCountryCode
      ? json.data.find((r) => r.country_code === step.matchCountryCode && r.type === step.type)
      : json.data[0];

    // Fallback: if Meta search didn't return a GB London city, use verified key
    if (!match && step.query === "London" && step.type === "city" && step.matchCountryCode === "GB") {
      console.warn(`[resolvePreset] Using verified London key ${LONDON_VERIFIED_KEY} as fallback`);
      selections.push({
        id: `city_${LONDON_VERIFIED_KEY}_${step.mode}_${Date.now()}`,
        source: "preset",
        label: "London, England, United Kingdom",
        mode: step.mode,
        locationType: "city",
        locationKey: LONDON_VERIFIED_KEY,
        radius: step.radius ?? 40,
        distanceUnit: step.distanceUnit ?? "kilometer",
      });
      continue;
    }

    if (!match) {
      console.warn(`[resolvePreset] No ${step.type} match for "${step.query}" in ${step.matchCountryCode}`);
      return null;
    }

    // Verify London resolves to the known correct key
    if (step.query === "London" && step.matchCountryCode === "GB" && match.key !== LONDON_VERIFIED_KEY) {
      console.warn(
        `[resolvePreset] London resolved to unexpected key ${match.key} (expected ${LONDON_VERIFIED_KEY}), using verified key`,
      );
      match = { ...match, key: LONDON_VERIFIED_KEY };
    }

    selections.push(
      searchResultToSelection(match, step.mode, step.radius, step.distanceUnit, "preset"),
    );
  }

  return { id: config.id, label: config.label, source: "preset", selections };
}

/** Compute a stable fingerprint for a LocationTargetingGroup's effective geo. */
function geoFingerprint(group: LocationTargetingGroup): string {
  const geo = groupToGeo(group);
  return JSON.stringify(geo, Object.keys(geo).sort());
}

/** Deduplicate location groups that produce identical geo_locations payloads. */
function deduplicateLocationGroups(groups: LocationTargetingGroup[]): LocationTargetingGroup[] {
  const seen = new Map<string, LocationTargetingGroup>();
  for (const g of groups) {
    const fp = geoFingerprint(g);
    if (!seen.has(fp)) {
      seen.set(fp, g);
    } else {
      console.log(`[deduplicateLocationGroups] Dropping duplicate: "${g.label}" matches "${seen.get(fp)!.label}"`);
    }
  }
  return Array.from(seen.values());
}

// ─── Ad set generation ───────────────────────────────────────────────────────

interface BudgetScheduleProps {
  budgetSchedule: BudgetScheduleSettings;
  adSetSuggestions: AdSetSuggestion[];
  audiences: AudienceSettings;
  onBudgetChange: (bs: BudgetScheduleSettings) => void;
  onSuggestionsChange: (suggestions: AdSetSuggestion[]) => void;
}

function generateSuggestions(
  audiences: AudienceSettings,
  budget: number,
  locationGroups: LocationTargetingGroup[],
): AdSetSuggestion[] {
  const baseSuggestions: Omit<AdSetSuggestion, "geoLocations" | "locationLabel">[] = [];
  const age = suggestAgeRange(audiences);

  audiences.pageGroups.forEach((g) => {
    if (g.pageIds.length === 0) return;
    baseSuggestions.push({
      id: `as_pg_${g.id}`,
      name: g.name || "Page Group",
      sourceType: "page_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.pageIds.length} pages)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  audiences.customAudienceGroups.forEach((g) => {
    if (g.audienceIds.length === 0) return;
    baseSuggestions.push({
      id: `as_ca_${g.id}`,
      name: g.name || "Custom Audiences",
      sourceType: "custom_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.audienceIds.length} audiences)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  audiences.savedAudiences.audienceIds.forEach((id, i) => {
    baseSuggestions.push({
      id: `as_sa_${id}`,
      name: `Saved Audience ${i + 1}`,
      sourceType: "saved_audience",
      sourceId: id,
      sourceName: id,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  audiences.interestGroups.forEach((g) => {
    if (g.interests.length === 0) return;
    baseSuggestions.push({
      id: `as_ig_${g.id}`,
      name: g.name || "Interest Group",
      sourceType: "interest_group",
      sourceId: g.id,
      sourceName: `${g.name || "Untitled"} (${g.interests.length} interests)`,
      ageMin: age.min,
      ageMax: age.max,
      budgetPerDay: 0,
      advantagePlus: false,
      enabled: true,
    });
  });

  // Lookalike ad sets from page groups with lookalike enabled
  const RANGE_LABELS: Record<string, string> = { "0-1%": "1%", "1-2%": "2%", "2-3%": "3%" };
  audiences.pageGroups.forEach((g) => {
    if (!g.lookalike || g.pageIds.length === 0) return;
    const ranges = g.lookalikeRanges?.length ? g.lookalikeRanges : ["0-1%"];
    for (const range of ranges) {
      const pctLabel = RANGE_LABELS[range] ?? range;
      baseSuggestions.push({
        id: `as_lal_${g.id}_${range}`,
        name: `${g.name || "Page Group"} — ${pctLabel} Lookalike`,
        sourceType: "lookalike_group",
        sourceId: g.id,
        sourceName: `${g.name || "Untitled"} ${pctLabel} Lookalike`,
        ageMin: age.min,
        ageMax: age.max,
        budgetPerDay: 0,
        advantagePlus: false,
        enabled: true,
      });
    }
  });

  // Lookalike ad sets from SelectedPagesLookalikeGroups (one per range per group)
  (audiences.selectedPagesLookalikeGroups ?? []).forEach((g) => {
    if (g.selectedPageIds.length === 0) return;
    const ranges: LookalikeRange[] = g.lookalikeRanges?.length ? g.lookalikeRanges : ["0-1%"];
    for (const range of ranges) {
      const pctLabel = RANGE_LABELS[range] ?? range;
      baseSuggestions.push({
        id: `as_splal_${g.id}_${range}`,
        name: `${g.name || "Selected Pages"} — ${pctLabel} Lookalike`,
        sourceType: "selected_pages_lookalike",
        sourceId: g.id,
        sourceName: `${g.name || "Selected Pages"} (${g.selectedPageIds.length} pages, ${pctLabel})`,
        lookalikeRange: range,
        ageMin: age.min,
        ageMax: age.max,
        budgetPerDay: 0,
        advantagePlus: false,
        enabled: true,
      });
    }
  });

  const groups = locationGroups.length > 0
    ? deduplicateLocationGroups(locationGroups)
    : [FALLBACK_UK_NATIONWIDE];

  const suggestions: AdSetSuggestion[] = [];
  for (const base of baseSuggestions) {
    for (const group of groups) {
      const geo = groupToGeo(group);
      const suffix = groups.length > 1 ? ` — ${group.label}` : "";
      suggestions.push({
        ...base,
        id: groups.length > 1 ? `${base.id}_${group.id}` : base.id,
        name: `${base.name}${suffix}`,
        geoLocations: geo,
        locationLabel: group.label,
      });
    }
  }

  const enabled = suggestions.filter((s) => s.enabled);
  const perSet = enabled.length > 0 ? Math.round((budget / enabled.length) * 100) / 100 : 0;
  return suggestions.map((s) => ({ ...s, budgetPerDay: s.enabled ? perSet : 0 }));
}

// ─── Location Picker Component ───────────────────────────────────────────────

function LocationPicker({
  groups,
  onChange,
}: {
  groups: LocationTargetingGroup[];
  onChange: (groups: LocationTargetingGroup[]) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [addMode, setAddMode] = useState<"include" | "exclude">("include");
  const [addRadius, setAddRadius] = useState(40);
  const [resolvingPreset, setResolvingPreset] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const locationSearch = useLocationSearch();

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    locationSearch.search(value);
  };

  const addFromSearch = (result: LocationSearchResult) => {
    const selection = searchResultToSelection(result, addMode, addRadius);
    const newGroup: LocationTargetingGroup = {
      id: `manual_${Date.now()}`,
      label: selection.label + (result.type === "city" && addRadius ? ` (+${addRadius} km)` : ""),
      source: "manual",
      selections: [selection],
    };
    onChange([...groups, newGroup]);
    setSearchQuery("");
    locationSearch.clear();
  };

  const togglePreset = useCallback(async (config: PresetConfig) => {
    const existing = groups.find((g) => g.id === config.id);
    if (existing) {
      onChange(groups.filter((g) => g.id !== config.id));
      return;
    }

    setResolvingPreset(config.id);
    setPresetError(null);
    try {
      const resolved = await resolvePreset(config);
      if (!resolved) {
        setPresetError(`Could not resolve "${config.short}" from Meta. Try searching manually.`);
        return;
      }
      console.log(`[LocationPicker] Preset "${config.short}" resolved:`, JSON.stringify(resolved, null, 2));
      onChange([...groups, resolved]);
    } catch (err) {
      setPresetError(`Failed to resolve preset: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResolvingPreset(null);
    }
  }, [groups, onChange]);

  const removeGroup = (id: string) => {
    const next = groups.filter((g) => g.id !== id);
    onChange(next);
  };

  const formatResultLabel = (r: LocationSearchResult) => {
    const parts = [r.name, r.region, r.country_name].filter(Boolean);
    return parts.join(", ");
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "city": return "City";
      case "region": return "Region";
      case "country": return "Country";
      default: return t;
    }
  };

  return (
    <div className="space-y-4">
      {/* Preset quick-add buttons — resolved via Meta location search API */}
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick Presets
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESET_CONFIGS.map((config) => {
            const active = groups.some((g) => g.id === config.id);
            const resolving = resolvingPreset === config.id;
            return (
              <button
                key={config.id}
                type="button"
                disabled={resolving}
                onClick={() => togglePreset(config)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors
                  ${active
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border-strong text-muted-foreground hover:border-foreground/20"
                  } ${resolving ? "opacity-60" : ""}`}
              >
                {resolving ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
                {config.short}
              </button>
            );
          })}
        </div>
        {presetError && (
          <p className="mt-1 text-xs text-destructive">{presetError}</p>
        )}
      </div>

      {/* Meta-backed location search */}
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Search Locations
        </span>
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search cities, regions, countries…"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-md border border-border bg-card py-2 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {locationSearch.loading && (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <select
            value={addMode}
            onChange={(e) => setAddMode(e.target.value as "include" | "exclude")}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs"
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
          <input
            type="number"
            value={addRadius}
            onChange={(e) => setAddRadius(Number(e.target.value))}
            className="w-16 rounded-md border border-border bg-card px-2 py-1 text-center text-xs"
            min={0}
            max={80}
            title="Radius (km) for city targeting"
          />
          <span className="self-center text-[10px] text-muted-foreground">km</span>
        </div>

        {/* Search results dropdown */}
        {searchQuery.length >= 2 && (locationSearch.results.length > 0 || locationSearch.loading) && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
            {locationSearch.results.map((r) => (
              <button
                key={`${r.type}_${r.key}`}
                type="button"
                onClick={() => addFromSearch(r)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
              >
                <span className="truncate">{formatResultLabel(r)}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <Badge variant="outline" className="text-[10px]">{typeLabel(r.type)}</Badge>
                  <Plus className="h-3.5 w-3.5 text-primary" />
                </div>
              </button>
            ))}
          </div>
        )}
        {searchQuery.length >= 2 && !locationSearch.loading && locationSearch.results.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">No results for &ldquo;{searchQuery}&rdquo;</p>
        )}
        {locationSearch.error && (
          <p className="mt-1 text-xs text-destructive">{locationSearch.error}</p>
        )}
      </div>

      {/* Selected location groups */}
      {groups.length > 0 && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Active Location Groups ({groups.length})
          </span>
          <div className="mt-2 space-y-1.5">
            {groups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{g.label}</span>
                    <Badge variant={g.source === "preset" ? "primary" : "outline"} className="text-[10px] shrink-0">
                      {g.source}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {g.selections.map((sel) => (
                      <span
                        key={sel.id}
                        className={`text-[10px] rounded px-1.5 py-0.5 ${
                          sel.mode === "include"
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive"
                        }`}
                      >
                        {sel.mode === "exclude" ? "−" : "+"} {sel.label}
                        {sel.radius ? ` (${sel.radius} km)` : ""}
                        {sel.locationType === "country" ? ` [${sel.countryCode}]` : ` [key:${sel.locationKey}]`}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeGroup(g.id)}
                  className="ml-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                  title="Remove location group"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          {groups.length > 1 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {groups.length} groups — each audience will produce {groups.length} ad sets (one per location group).
            </p>
          )}
        </div>
      )}

      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No locations selected — ad sets will default to UK nationwide targeting.
        </p>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function BudgetSchedule({
  budgetSchedule: bs,
  adSetSuggestions,
  audiences,
  onBudgetChange,
  onSuggestionsChange,
}: BudgetScheduleProps) {
  const updateBs = (patch: Partial<BudgetScheduleSettings>) =>
    onBudgetChange({ ...bs, ...patch });

  const updateSuggestion = (id: string, patch: Partial<AdSetSuggestion>) =>
    onSuggestionsChange(adSetSuggestions.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const locationGroups = bs.locationGroups ?? [];

  const handleLocationGroupsChange = (groups: LocationTargetingGroup[]) => {
    onBudgetChange({ ...bs, locationGroups: groups });
  };

  const handleGenerate = () => {
    const next = generateSuggestions(audiences, bs.budgetAmount, locationGroups);
    onSuggestionsChange(next);
  };

  const distributeBudget = () => {
    const enabled = adSetSuggestions.filter((s) => s.enabled);
    if (enabled.length === 0) return;
    const perSet = Math.round((bs.budgetAmount / enabled.length) * 100) / 100;
    onSuggestionsChange(
      adSetSuggestions.map((s) => ({
        ...s,
        budgetPerDay: s.enabled ? perSet : 0,
      }))
    );
  };

  const enabledCount = adSetSuggestions.filter((s) => s.enabled).length;
  const totalDaily = adSetSuggestions
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + s.budgetPerDay, 0);

  const days = useMemo(() => {
    if (!bs.startDate || !bs.endDate) return 0;
    return Math.ceil(
      (new Date(bs.endDate).getTime() - new Date(bs.startDate).getTime()) / (1000 * 60 * 60 * 24)
    );
  }, [bs.startDate, bs.endDate]);

  const SOURCE_LABELS: Record<string, string> = {
    page_group: "page",
    custom_group: "custom",
    saved_audience: "saved",
    interest_group: "interest",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="font-heading text-2xl tracking-wide">Budget & Schedule</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure spending, timing, and ad set structure.
        </p>
      </div>

      {/* Budget */}
      <Card>
        <CardTitle>Budget</CardTitle>
        <div className="mt-4 space-y-4">
          <div className="flex gap-2">
            {(["ad_set", "campaign"] as BudgetLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => updateBs({ budgetLevel: level })}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors
                  ${bs.budgetLevel === level ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
              >
                {level === "ad_set" ? "Ad Set Level" : "Campaign Level (CBO)"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["daily", "lifetime"] as BudgetType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => updateBs({ budgetType: type })}
                className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors
                  ${bs.budgetType === type ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
              >
                {type === "daily" ? "Daily" : "Lifetime"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={`${bs.budgetType === "daily" ? "Daily" : "Lifetime"} Budget (${bs.currency})`}
              type="number"
              value={bs.budgetAmount}
              onChange={(e) => updateBs({ budgetAmount: Number(e.target.value) })}
              min={1}
            />
            <Select
              label="Timezone"
              value={bs.timezone}
              onChange={(e) => updateBs({ timezone: e.target.value })}
              options={TIMEZONES.map((tz) => ({ value: tz, label: tz }))}
            />
          </div>
        </div>
      </Card>

      {/* Schedule */}
      <Card>
        <CardTitle>Schedule</CardTitle>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Input
            label="Start Date & Time"
            type="datetime-local"
            value={bs.startDate}
            onChange={(e) => updateBs({ startDate: e.target.value })}
          />
          <Input
            label="End Date & Time"
            type="datetime-local"
            value={bs.endDate}
            onChange={(e) => updateBs({ endDate: e.target.value })}
          />
        </div>
        {days > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Duration: <span className="font-medium text-foreground">{days} days</span>
            {bs.budgetType === "daily" && (
              <> · Total estimated spend: <span className="font-medium text-foreground">{bs.currency} {(bs.budgetAmount * days).toFixed(2)}</span></>
            )}
          </p>
        )}
      </Card>

      {/* Suggested age hint */}
      {(() => {
        const age = suggestAgeRange(audiences);
        const hasPages = audiences.pageGroups.some((g) => g.pageIds.length > 0);
        if (!hasPages) return null;
        return (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary-light px-4 py-2.5">
            <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm text-foreground">
              Suggested age range: <span className="font-semibold">{age.min}–{age.max}</span>
              <span className="text-muted-foreground"> (based on your page audiences)</span>
            </span>
          </div>
        );
      })()}

      {/* Location Targeting */}
      <Card>
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" />
          <CardTitle>Location Targeting</CardTitle>
        </div>
        <CardDescription className="mt-1">
          Select preset locations or search Meta&apos;s location database. Each group generates separate ad sets per audience.
        </CardDescription>
        <div className="mt-4">
          <LocationPicker
            groups={locationGroups}
            onChange={handleLocationGroupsChange}
          />
        </div>
      </Card>

      {/* Ad Set Suggestions */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Ad Set Suggestions</CardTitle>
            <CardDescription>Generated from your audiences. Fine-tune each ad set.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={distributeBudget} disabled={enabledCount === 0}>
              <DollarSign className="h-3.5 w-3.5" />
              Distribute Budget
            </Button>
            <Button size="sm" onClick={handleGenerate}>
              <Zap className="h-3.5 w-3.5" />
              Generate Suggestions
            </Button>
          </div>
        </div>

        {adSetSuggestions.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Click &quot;Generate Suggestions&quot; to create ad sets from your audiences.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Active: {enabledCount}/{adSetSuggestions.length}</span>
              <span>
                Daily Total: <span className="font-medium text-foreground">{bs.currency} {totalDaily.toFixed(2)}</span>
                {days > 0 && <> · Total Spend ({days}d): <span className="font-medium text-foreground">{bs.currency} {(totalDaily * days).toFixed(2)}</span></>}
              </span>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              {adSetSuggestions.map((s) => (
                <div
                  key={s.id}
                  className={`border-b border-border last:border-b-0 ${s.enabled ? "" : "opacity-50"}`}
                >
                  {/* ── Main row ────────────────────────────────────────── */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Checkbox
                      checked={s.enabled}
                      onChange={() => updateSuggestion(s.id, { enabled: !s.enabled })}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{s.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          {SOURCE_LABELS[s.sourceType] || s.sourceType}
                        </Badge>
                        {s.locationLabel && locationGroups.length > 1 && (
                          <Badge variant="primary" className="text-[10px] shrink-0">
                            {s.locationLabel}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground truncate block">{s.sourceName}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={s.ageMin}
                          onChange={(e) => updateSuggestion(s.id, { ageMin: Number(e.target.value) })}
                          className="w-12 rounded border border-border px-1.5 py-1 text-center text-xs"
                          min={13}
                          max={65}
                          title={s.advantagePlus ? "Age suggestion (Advantage+)" : "Strict age min"}
                        />
                        <span className="text-xs text-muted-foreground">–</span>
                        <input
                          type="number"
                          value={s.ageMax}
                          onChange={(e) => updateSuggestion(s.id, { ageMax: Number(e.target.value) })}
                          className="w-12 rounded border border-border px-1.5 py-1 text-center text-xs"
                          min={13}
                          max={65}
                          title={s.advantagePlus ? "Age suggestion (Advantage+)" : "Strict age max"}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">{bs.currency}</span>
                        <input
                          type="number"
                          value={s.budgetPerDay}
                          onChange={(e) => updateSuggestion(s.id, { budgetPerDay: Number(e.target.value) })}
                          className="w-16 rounded border border-border px-1.5 py-1 text-center text-xs"
                          min={0}
                          step={0.01}
                        />
                        <span className="text-xs text-muted-foreground">/day</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateSuggestion(s.id, { advantagePlus: !s.advantagePlus })}
                        title={
                          s.advantagePlus
                            ? "Advantage+ ON — age sent as suggestion. Click to switch to strict targeting."
                            : "Advantage+ OFF — strict age targeting. Click to enable Advantage+ audience."
                        }
                        className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors
                          ${s.advantagePlus
                            ? "border-primary bg-primary-light text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"}`}
                      >
                        {s.advantagePlus ? "Advantage+ ON" : "Advantage+"}
                      </button>
                    </div>
                  </div>
                  {/* ── Advantage+ age hint ──────────────────────────────── */}
                  {s.advantagePlus && (
                    <div className="flex items-center gap-1.5 border-t border-primary/10 bg-primary-light/50 px-4 py-1.5">
                      <Lightbulb className="h-3 w-3 shrink-0 text-primary" />
                      <span className="text-[11px] text-primary">
                        With Advantage+ audience, age is sent as a suggestion rather than a strict limit — Meta may expand beyond it.
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
