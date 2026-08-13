"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DollarSign,
  Zap,
  Lightbulb,
  MapPin,
  Search,
  X,
  Loader2,
  Plus,
  Layers,
  Settings2,
  RotateCcw,
  Copy,
  Trash2,
  Users,
  CalendarRange,
  Wand2,
  AlertTriangle,
} from "lucide-react";
import type {
  BudgetScheduleSettings,
  BudgetLevel,
  BudgetType,
  AdSetSuggestion,
  AudienceSettings,
  LocationTargetingGroup,
  LocationSelection,
  LookalikeRange,
  CampaignSettings,
  PlacementConfig,
  PlacementPublisherPlatform,
  PlacementDevicePlatform,
  FacebookPlacementPosition,
  InstagramPlacementPosition,
  AudienceNetworkPlacementPosition,
} from "@/lib/types";
import { TIMEZONES } from "@/lib/mock-data";
import { suggestAgeRange } from "@/lib/interest-suggestions";
import { useLocationSearch, type LocationSearchResult } from "@/lib/hooks/useMeta";
import { useWizardEventContext } from "@/lib/wizard/use-event-context";
import { CalendarClock } from "lucide-react";
import {
  DEFAULT_PLACEMENT_CONFIG,
  buildPlacementConfigTargeting,
  validatePlacementConfig,
} from "@/lib/meta/placement-config";
import { groupToGeo } from "@/lib/meta/location-targeting";
import {
  createBlankAdSetSuggestion,
  defaultBlankAdSetBudget,
  findAdSetsExceedingBudgetShare,
  duplicateAdSetSuggestion,
  deleteAdSetSuggestion,
  applyBulkAgeRange,
  applyBulkDailyBudget,
  duplicateSuggestionsUnderLocationGroup,
  clearUnsupportedAdvantagePlus,
  MAX_ADSET_NAME_LENGTH,
  AD_SET_BUDGET_SHARE_WARNING_THRESHOLD,
} from "@/lib/wizard/adset-suggestions";
import {
  isAdvantageAudienceSupportedForObjective,
  objectiveDisplayName,
} from "@/lib/meta/advantage-plus-compat";

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
  settings: CampaignSettings;
  onBudgetChange: (bs: BudgetScheduleSettings) => void;
  onSuggestionsChange: (suggestions: AdSetSuggestion[]) => void;
  onSettingsChange: (settings: CampaignSettings) => void;
}

function generateSuggestions(
  audiences: AudienceSettings,
  budget: number,
  locationGroups: LocationTargetingGroup[],
): AdSetSuggestion[] {
  const baseSuggestions: Omit<AdSetSuggestion, "geoLocations" | "locationLabel">[] = [];
  const age = suggestAgeRange(audiences);
  // Declared here (before any forEach that references it) to avoid TDZ crash in the
  // minified/bundled build where the original let/const was placed further down.
  const RANGE_LABELS: Record<string, string> = { "0-1%": "1%", "1-2%": "2%", "2-3%": "3%" };

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
    // Lookalike ad sets from this custom audience group (one per tier)
    if (g.lookalike && g.lookalikeRanges?.length) {
      for (const range of g.lookalikeRanges) {
        const pctLabel = RANGE_LABELS[range] ?? range;
        baseSuggestions.push({
          id: `as_ca_lal_${g.id}_${range}`,
          name: `${g.name || "Custom Audiences"} — ${pctLabel} Lookalike`,
          sourceType: "custom_group_lookalike",
          sourceId: g.id,
          sourceName: `${g.name || "Untitled"} ${pctLabel} Lookalike`,
          lookalikeRange: range,
          ageMin: age.min,
          ageMax: age.max,
          budgetPerDay: 0,
          advantagePlus: false,
          enabled: true,
        });
      }
    }
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
        // Only stamp a real FK when the group came from the operator's
        // configured `locationGroups` — the synthetic UK-nationwide
        // fallback isn't a real group, so per-row reassignment (the
        // location dropdown) has nothing to look up and correctly falls
        // back to the stamped `geoLocations` snapshot above.
        locationGroupId: locationGroups.length > 0 ? group.id : undefined,
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

// ─── Placement picker (Step 5 "Placements", task #117) ──────────────────────
//
// Reproducer this section fixes: East End Dubs Newcastle signup launch
// (2026-08-07) shipped 42 ads to EVERY Meta placement (Audience Network,
// Marketplace, Search, …) because the wizard never collected a placement
// choice at all — see lib/meta/placement-config.ts for the full writeup.
//
// Used both for the campaign-wide config (settings.placementConfig) and,
// compactly, for a per-ad-set override (AdSetSuggestion.placementConfig).

const FB_PRIMARY_POSITIONS: { value: FacebookPlacementPosition; label: string }[] = [
  { value: "feed", label: "Feed" },
  { value: "facebook_reels", label: "Reels" },
  { value: "story", label: "Story" },
];
const FB_ADVANCED_POSITIONS: { value: FacebookPlacementPosition; label: string }[] = [
  { value: "marketplace", label: "Marketplace" },
  { value: "search", label: "Search results" },
  { value: "instream_video", label: "Instream video" },
  { value: "right_hand_column", label: "Right column" },
  { value: "video_feeds", label: "Video feeds" },
  { value: "reels", label: "Reels (legacy)" },
];
const IG_PRIMARY_POSITIONS: { value: InstagramPlacementPosition; label: string }[] = [
  { value: "stream", label: "Feed" },
  { value: "reels", label: "Reels" },
  { value: "story", label: "Story" },
  { value: "explore", label: "Explore" },
];
const IG_ADVANCED_POSITIONS: { value: InstagramPlacementPosition; label: string }[] = [
  { value: "explore_home", label: "Explore Home" },
  { value: "ig_search", label: "Search" },
];
const AN_POSITIONS: { value: AudienceNetworkPlacementPosition; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "rewarded_video", label: "Rewarded video" },
];

/**
 * Manual-mode starting point when the operator first switches away from
 * Advantage+.
 *
 * Facebook: Feed ONLY. Instagram: ALL placements. Not symmetric on purpose —
 * FB Reels/Story/Marketplace underperform for electronic music campaigns,
 * while IG's Reels/Story/Explore are strong placements that shouldn't be
 * excluded by default (2026-08-07 correction to the initial FB-Feed-only /
 * IG-Feed-only seed shipped in PR #751 — that default was FB Feed + IG Feed
 * ONLY, wrong per operator ask).
 *
 * Audience Network / Messenger stay OFF (operator opts in explicitly via
 * "Show advanced placements"). devicePlatforms is left unset here —
 * `PlacementPicker` and `buildPlacementConfigTargeting` both already treat
 * an absent devicePlatforms as "both", so there's nothing to seed.
 */
const MANUAL_PLACEMENT_DEFAULTS: PlacementConfig = {
  mode: "manual",
  publisherPlatforms: ["facebook", "instagram"],
  facebookPositions: ["feed"],
  instagramPositions: ["stream", "story", "explore", "reels", "ig_search", "explore_home"],
};

function PlacementPicker({
  value,
  onChange,
  onClear,
  compact,
}: {
  value: PlacementConfig | undefined;
  onChange: (config: PlacementConfig) => void;
  /** Only present for the per-ad-set override — clears back to the campaign default. */
  onClear?: () => void;
  compact?: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const effective = value ?? DEFAULT_PLACEMENT_CONFIG;
  const mode = effective.mode;
  const platforms = effective.publisherPlatforms ?? [];
  const fbPositions = effective.facebookPositions ?? [];
  const igPositions = effective.instagramPositions ?? [];
  const anPositions = effective.audienceNetworkPositions ?? [];
  const devices = effective.devicePlatforms ?? ["mobile", "desktop"];

  const togglePlatform = (p: PlacementPublisherPlatform) => {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p];
    onChange({ ...effective, mode: "manual", publisherPlatforms: next });
  };
  /** Generic toggle for a string[]-backed position field (FB / IG / AN each have their own enum). */
  function togglePosition<T extends string>(
    list: T[],
    pos: T,
    apply: (next: T[]) => void,
  ) {
    const next = list.includes(pos) ? list.filter((x) => x !== pos) : [...list, pos];
    apply(next);
  }
  const toggleFbPosition = (pos: FacebookPlacementPosition) =>
    togglePosition(fbPositions, pos, (next) =>
      onChange({ ...effective, mode: "manual", facebookPositions: next }),
    );
  const toggleIgPosition = (pos: InstagramPlacementPosition) =>
    togglePosition(igPositions, pos, (next) =>
      onChange({ ...effective, mode: "manual", instagramPositions: next }),
    );
  const toggleAnPosition = (pos: AudienceNetworkPlacementPosition) =>
    togglePosition(anPositions, pos, (next) =>
      onChange({ ...effective, mode: "manual", audienceNetworkPositions: next }),
    );
  const toggleDevice = (d: PlacementDevicePlatform) => {
    const next = devices.includes(d) ? devices.filter((x) => x !== d) : [...devices, d];
    onChange({ ...effective, mode: "manual", devicePlatforms: next });
  };

  const validation = validatePlacementConfig(effective);
  const targeting = buildPlacementConfigTargeting(effective);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ mode: "advantage_plus" })}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors
            ${mode !== "manual" ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
        >
          Advantage+ Placements {compact ? "" : "(Meta recommended)"}
        </button>
        <button
          type="button"
          onClick={() => onChange(mode === "manual" ? effective : MANUAL_PLACEMENT_DEFAULTS)}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors
            ${mode === "manual" ? "border-foreground bg-foreground text-background" : "border-border-strong hover:bg-card"}`}
        >
          Manual placements
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            title="Remove this ad set's override — use the campaign default instead"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Use campaign default
          </button>
        )}
      </div>

      {mode === "manual" && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          {/* Facebook */}
          <div>
            <Checkbox
              checked={platforms.includes("facebook")}
              onChange={() => togglePlatform("facebook")}
              label="Facebook"
            />
            {platforms.includes("facebook") && (
              <div className="ml-6 mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                {FB_PRIMARY_POSITIONS.map((p) => (
                  <Checkbox
                    key={p.value}
                    checked={fbPositions.includes(p.value)}
                    onChange={() => toggleFbPosition(p.value)}
                    label={p.label}
                    className="text-xs"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Instagram */}
          <div>
            <Checkbox
              checked={platforms.includes("instagram")}
              onChange={() => togglePlatform("instagram")}
              label="Instagram"
            />
            {platforms.includes("instagram") && (
              <div className="ml-6 mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                {IG_PRIMARY_POSITIONS.map((p) => (
                  <Checkbox
                    key={p.value}
                    checked={igPositions.includes(p.value)}
                    onChange={() => toggleIgPosition(p.value)}
                    label={p.label}
                    className="text-xs"
                  />
                ))}
              </div>
            )}
          </div>

          {/* Advanced positions (FB + IG), + Audience Network + Messenger + Devices */}
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="h-3 w-3" />
            {showAdvanced ? "Hide advanced placements" : "Show advanced placements"}
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-border pt-3">
              {platforms.includes("facebook") && (
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground">More Facebook placements</span>
                  <div className="ml-1 mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                    {FB_ADVANCED_POSITIONS.map((p) => (
                      <Checkbox
                        key={p.value}
                        checked={fbPositions.includes(p.value)}
                        onChange={() => toggleFbPosition(p.value)}
                        label={p.label}
                        className="text-xs"
                      />
                    ))}
                  </div>
                </div>
              )}
              {platforms.includes("instagram") && (
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground">More Instagram placements</span>
                  <div className="ml-1 mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                    {IG_ADVANCED_POSITIONS.map((p) => (
                      <Checkbox
                        key={p.value}
                        checked={igPositions.includes(p.value)}
                        onChange={() => toggleIgPosition(p.value)}
                        label={p.label}
                        className="text-xs"
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Audience Network — OFF by default, own toggle */}
              <div>
                <Checkbox
                  checked={platforms.includes("audience_network")}
                  onChange={() => togglePlatform("audience_network")}
                  label="Audience Network"
                />
                {platforms.includes("audience_network") && (
                  <div className="ml-6 mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
                    {AN_POSITIONS.map((p) => (
                      <Checkbox
                        key={p.value}
                        checked={anPositions.includes(p.value)}
                        onChange={() => toggleAnPosition(p.value)}
                        label={p.label}
                        className="text-xs"
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Messenger — OFF by default */}
              <Checkbox
                checked={platforms.includes("messenger")}
                onChange={() => togglePlatform("messenger")}
                label="Messenger"
              />
            </div>
          )}

          {/* Devices — both ON by default */}
          <div className="flex items-center gap-4 border-t border-border pt-3">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Devices
            </span>
            <Checkbox
              checked={devices.includes("mobile")}
              onChange={() => toggleDevice("mobile")}
              label="Mobile"
            />
            <Checkbox
              checked={devices.includes("desktop")}
              onChange={() => toggleDevice("desktop")}
              label="Desktop"
            />
          </div>

          {validation.errors.length > 0 && (
            <p className="text-xs text-destructive">{validation.errors[0]}</p>
          )}
          {validation.valid && validation.warnings.length > 0 && (
            <p className="text-[11px] text-muted-foreground">{validation.warnings[0]}</p>
          )}
          {validation.valid && targeting && (
            <p className="text-[11px] text-muted-foreground">
              Sends to Meta as: <code className="text-foreground">publisher_platforms={JSON.stringify(targeting.publisher_platforms)}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Schedule card (reads event context to surface "Use event date") ────────

function ScheduleCard({
  bs,
  updateBs,
  days,
}: {
  bs: BudgetScheduleSettings;
  updateBs: (patch: Partial<BudgetScheduleSettings>) => void;
  days: number;
}) {
  const { event } = useWizardEventContext();
  const eventDate = event?.event_date ?? null;
  const eventEnd = eventDate ? `${eventDate}T23:59` : null;
  const showUseEventDate = Boolean(eventEnd && bs.endDate !== eventEnd);

  return (
    <Card>
      <CardTitle>Schedule</CardTitle>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Input
          label="Start Date & Time"
          type="datetime-local"
          value={bs.startDate}
          onChange={(e) => updateBs({ startDate: e.target.value })}
        />
        <div>
          <Input
            label="End Date & Time"
            type="datetime-local"
            value={bs.endDate}
            onChange={(e) => updateBs({ endDate: e.target.value })}
          />
          {showUseEventDate && eventEnd && eventDate && (
            <button
              type="button"
              onClick={() => updateBs({ endDate: eventEnd })}
              className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-card hover:text-foreground"
              title="Set end date to the event date"
            >
              <CalendarClock className="h-3 w-3" />
              Use event date ({eventDate})
            </button>
          )}
        </div>
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
  );
}

// ─── Bulk-edit modals ("Set all ages" / "Set all daily budgets") ────────────
//
// Both close by fully unmounting (Dialog returns null while !open), so each
// re-open is a fresh mount that re-reads `initial*` — no useEffect needed to
// resync stale local state from a previous edit.

function BulkAgeModal({
  open,
  onClose,
  onApply,
  initialMin,
  initialMax,
  rowCount,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (ageMin: number, ageMax: number) => void;
  initialMin: number;
  initialMax: number;
  rowCount: number;
}) {
  const [min, setMin] = useState(initialMin);
  const [max, setMax] = useState(initialMax);
  const invalid = min < 13 || max > 65 || min >= max;

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Set all ages">
      <DialogContent>
        <DialogHeader onClose={onClose}>
          <DialogTitle>Set all ages</DialogTitle>
          <DialogDescription>
            Overwrites the age range on all {rowCount} ad set{rowCount !== 1 ? "s" : ""} below.
            Reversible for 5 seconds via an undo toast.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <Input
            label="Min age"
            type="number"
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            min={13}
            max={65}
          />
          <Input
            label="Max age"
            type="number"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            min={13}
            max={65}
          />
        </div>
        {invalid && (
          <p className="mt-2 text-xs text-destructive">
            Min must be less than max, both between 13 and 65.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={invalid} onClick={() => onApply(min, max)}>
            Apply to {rowCount} ad set{rowCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkBudgetModal({
  open,
  onClose,
  onApply,
  initialBudget,
  currency,
  rowCount,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (budgetPerDay: number) => void;
  initialBudget: number;
  currency: string;
  rowCount: number;
}) {
  const [budget, setBudget] = useState(initialBudget);
  const invalid = !(budget > 0);

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Set all daily budgets">
      <DialogContent>
        <DialogHeader onClose={onClose}>
          <DialogTitle>Set all daily budgets</DialogTitle>
          <DialogDescription>
            Overwrites the daily budget on all {rowCount} ad set{rowCount !== 1 ? "s" : ""} below.
            Reversible for 5 seconds via an undo toast.
          </DialogDescription>
        </DialogHeader>
        <Input
          label={`Daily budget (${currency})`}
          type="number"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
          min={0}
          step={0.01}
        />
        {invalid && (
          <p className="mt-2 text-xs text-destructive">Budget must be greater than 0.</p>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={invalid} onClick={() => onApply(budget)}>
            Apply to {rowCount} ad set{rowCount !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function BudgetSchedule({
  budgetSchedule: bs,
  adSetSuggestions,
  audiences,
  settings,
  onBudgetChange,
  onSuggestionsChange,
  onSettingsChange,
}: BudgetScheduleProps) {
  const [expandedPlacementAdSetId, setExpandedPlacementAdSetId] = useState<string | null>(null);
  const [ageModalOpen, setAgeModalOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [undoState, setUndoState] = useState<{ label: string; previous: AdSetSuggestion[] } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateBs = (patch: Partial<BudgetScheduleSettings>) =>
    onBudgetChange({ ...bs, ...patch });

  const updateSuggestion = (id: string, patch: Partial<AdSetSuggestion>) =>
    onSuggestionsChange(adSetSuggestions.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const locationGroups = useMemo(() => bs.locationGroups ?? [], [bs.locationGroups]);

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

  // ── Blank ad set / duplicate / delete (refinement pack #1–2, polish) ──────
  const addBlankAdSet = () => {
    // task #122 (FIX 3) — never let a blank ad set default to a 0 daily
    // budget; Meta rejects ad set creation outright (subcode 1885272) if it
    // does. See defaultBlankAdSetBudget's doc comment.
    const defaultBudget = defaultBlankAdSetBudget(adSetSuggestions, bs.budgetAmount);
    const blank = createBlankAdSetSuggestion(locationGroups, FALLBACK_UK_NATIONWIDE, defaultBudget);
    onSuggestionsChange([...adSetSuggestions, blank]);
  };

  // task #126 — objective-gated: registration/awareness campaigns can't run
  // Advantage+ Audience at all (Meta rejects it, subcode 1870196), so the
  // per-row toggle is disabled below and a duplicate never flips into a mode
  // Meta would just reject.
  const advantagePlusSupported = isAdvantageAudienceSupportedForObjective(
    settings.objective,
    settings.optimisationGoal,
  );

  // task #127 — PR #760 disabled the toggle for unsupported objectives but
  // gave operators no way to fix an ad set that ALREADY has advantagePlus:
  // true (duplicated before #760 landed, or the objective was switched away
  // from a supported one in Step 2 after Step 5 was configured) — the
  // launch-time preflight would reject it and there was no control left to
  // clear it from. Auto-normalise instead: on mount, and whenever the
  // objective/goal or the ad set list changes, force `advantagePlus: false`
  // on every ad set (including "blank" ones, whose toggle is locked and can
  // never be turned off manually) once the objective stops supporting it.
  // No operator click required — they already expressed intent by picking
  // the objective.
  //
  // This effect only touches the external system (`onSuggestionsChange`,
  // i.e. the parent's draft state) — no local setState here, per
  // react-hooks/set-state-in-effect.
  useEffect(() => {
    if (advantagePlusSupported) return;
    const { suggestions: cleared, clearedCount } = clearUnsupportedAdvantagePlus(adSetSuggestions);
    if (clearedCount === 0) return;
    onSuggestionsChange(cleared);
  }, [advantagePlusSupported, adSetSuggestions, onSuggestionsChange]);

  // The "cleared N ad sets" notice is derived separately, entirely during
  // render (React's documented "adjust state while rendering" escape hatch —
  // no refs, no effect): compare the incoming `adSetSuggestions` prop against
  // the previous render's snapshot and count rows whose `advantagePlus` flag
  // just flipped true → false. That transition only happens via the effect
  // above (the per-row toggle is disabled whenever unsupported), so this
  // reliably fires exactly once per auto-clear, on the render that receives
  // the already-cleared suggestions back down as a prop.
  const [prevSuggestionsForNotice, setPrevSuggestionsForNotice] = useState(adSetSuggestions);
  const [autoClearedNotice, setAutoClearedNotice] = useState<string | null>(null);
  if (adSetSuggestions !== prevSuggestionsForNotice) {
    const justCleared = prevSuggestionsForNotice.filter((prev) => {
      if (!prev.advantagePlus) return false;
      const current = adSetSuggestions.find((s) => s.id === prev.id);
      return current !== undefined && !current.advantagePlus;
    }).length;
    setPrevSuggestionsForNotice(adSetSuggestions);
    if (justCleared > 0 && !advantagePlusSupported) {
      setAutoClearedNotice(
        `Cleared Advantage+ Audience from ${justCleared} ad set${justCleared !== 1 ? "s" : ""} — Meta doesn't ` +
          `support it for ${objectiveDisplayName(settings.objective)} campaigns.`,
      );
    }
  }

  const duplicateRow = (id: string) =>
    onSuggestionsChange(duplicateAdSetSuggestion(adSetSuggestions, id, advantagePlusSupported));

  const deleteRow = (id: string) =>
    onSuggestionsChange(deleteAdSetSuggestion(adSetSuggestions, id));

  // ── Bulk age / budget edits with a 5s undo window (refinement pack #3–4) ──
  const applyWithUndo = (label: string, next: AdSetSuggestion[]) => {
    setUndoState({ label, previous: adSetSuggestions });
    onSuggestionsChange(next);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoState(null), 5000);
  };

  const undoLastBulkEdit = () => {
    if (!undoState) return;
    onSuggestionsChange(undoState.previous);
    setUndoState(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  };

  const applyBulkAges = (ageMin: number, ageMax: number) => {
    applyWithUndo(
      `Ages set to ${ageMin}–${ageMax} for ${adSetSuggestions.length} ad set${adSetSuggestions.length !== 1 ? "s" : ""}. `,
      applyBulkAgeRange(adSetSuggestions, ageMin, ageMax),
    );
    setAgeModalOpen(false);
  };

  const applyBulkBudgets = (budgetPerDay: number) => {
    applyWithUndo(
      `Daily budget set to ${bs.currency} ${budgetPerDay.toFixed(2)} for ${adSetSuggestions.length} ad set${adSetSuggestions.length !== 1 ? "s" : ""}. `,
      applyBulkDailyBudget(adSetSuggestions, budgetPerDay),
    );
    setBudgetModalOpen(false);
  };

  // ── "Generate audience set × location" bonus (refinement pack #5) ────────
  const unrepresentedLocationGroups = useMemo(() => {
    if (locationGroups.length < 2 || adSetSuggestions.length === 0) return [];
    const representedIds = new Set(
      adSetSuggestions.map((s) => s.locationGroupId).filter((id): id is string => Boolean(id)),
    );
    return locationGroups.filter((g) => !representedIds.has(g.id));
  }, [locationGroups, adSetSuggestions]);

  const generateUnderLocationGroup = (group: LocationTargetingGroup) => {
    const newRows = duplicateSuggestionsUnderLocationGroup(adSetSuggestions, group);
    if (newRows.length === 0) return;
    onSuggestionsChange([...adSetSuggestions, ...newRows]);
  };

  const enabledCount = adSetSuggestions.filter((s) => s.enabled).length;
  const totalDaily = adSetSuggestions
    .filter((s) => s.enabled)
    .reduce((sum, s) => sum + s.budgetPerDay, 0);
  // Soft warning (Puzzle Southampton 2026-08-13): blank/Wide defaults used
  // to land at £100 on small campaigns. Flag any enabled ad set whose daily
  // budget is >30% of the campaign total so the operator catches it before
  // launch — does not block.
  const oversizedBudgetAdSets = findAdSetsExceedingBudgetShare(
    adSetSuggestions,
    bs.budgetAmount,
  );

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
    blank: "blank",
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
      <ScheduleCard bs={bs} updateBs={updateBs} days={days} />


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

        {/* "Generate audience set × location" bonus — a location group was
            added after ad sets already existed. Manual confirm only; never
            runs automatically. */}
        {unrepresentedLocationGroups.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {unrepresentedLocationGroups.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary-light px-3 py-2"
              >
                <span className="flex items-center gap-1.5 text-xs text-foreground">
                  <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                  Duplicate every enabled ad set under <span className="font-semibold">{g.label}</span> too?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => generateUnderLocationGroup(g)}
                >
                  Generate audience set × location
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Placements */}
      <Card>
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <CardTitle>Placements</CardTitle>
        </div>
        <CardDescription className="mt-1">
          Where these ads can appear. Applies to every ad set below unless a specific ad set has its
          own override (see the &ldquo;Placements&rdquo; link on that ad set&apos;s row).
        </CardDescription>
        <div className="mt-4">
          <PlacementPicker
            value={settings.placementConfig}
            onChange={(config) => onSettingsChange({ ...settings, placementConfig: config })}
          />
        </div>
      </Card>

      {/* Ad Sets — renamed from "Ad Set Suggestions": these are commitments, not
          suggestions, once the operator has fine-tuned them below. */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Ad Sets</CardTitle>
            <CardDescription>Generated from your audiences. Fine-tune each ad set.</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" onClick={addBlankAdSet}>
              <Plus className="h-3.5 w-3.5" />
              Blank ad set
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAgeModalOpen(true)}
              disabled={adSetSuggestions.length === 0}
            >
              <Users className="h-3.5 w-3.5" />
              Set all ages
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBudgetModalOpen(true)}
              disabled={adSetSuggestions.length === 0}
            >
              <CalendarRange className="h-3.5 w-3.5" />
              Set all budgets
            </Button>
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

        {/* Undo toast for the destructive bulk-edit actions above (5s window) */}
        {undoState && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/60 px-3 py-2 text-xs">
            <span className="text-foreground">{undoState.label}</span>
            <button
              type="button"
              onClick={undoLastBulkEdit}
              className="font-medium text-primary hover:underline"
            >
              Undo
            </button>
          </div>
        )}

        {!advantagePlusSupported && adSetSuggestions.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-3 py-2">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Meta doesn&apos;t support Advantage+ Audience for {objectiveDisplayName(settings.objective)} campaigns
              — the toggle below is disabled for every ad set in this campaign.
            </span>
          </div>
        )}

        {/* task #127 — one-time confirmation that the auto-normaliser above just
            acted, so an operator returning to a campaign whose objective was
            switched away from a supported one isn't left wondering why their
            previously-Advantage+ ad sets are suddenly strict. */}
        {autoClearedNotice && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="text-xs text-warning">{autoClearedNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAutoClearedNotice(null)}
              className="shrink-0 text-warning hover:opacity-70"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {adSetSuggestions.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Click &quot;Generate Suggestions&quot; to create ad sets from your audiences, or add a
              &quot;Blank ad set&quot; for pure Advantage+ prospecting.
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

            {oversizedBudgetAdSets.length > 0 && (
              <div className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <div className="text-xs text-warning">
                  <p>
                    {oversizedBudgetAdSets.length === 1 ? (
                      <>
                        <span className="font-medium">{oversizedBudgetAdSets[0].name}</span>
                        {" "}has a daily budget of {bs.currency}{" "}
                        {oversizedBudgetAdSets[0].budgetPerDay.toFixed(2)} (
                        {Math.round(oversizedBudgetAdSets[0].shareOfCampaign * 100)}% of the{" "}
                        {bs.currency} {bs.budgetAmount.toFixed(2)} campaign total) — over the{" "}
                        {Math.round(AD_SET_BUDGET_SHARE_WARNING_THRESHOLD * 100)}% review threshold.
                      </>
                    ) : (
                      <>
                        {oversizedBudgetAdSets.length} ad sets have a daily budget over{" "}
                        {Math.round(AD_SET_BUDGET_SHARE_WARNING_THRESHOLD * 100)}% of the{" "}
                        {bs.currency} {bs.budgetAmount.toFixed(2)} campaign total:{" "}
                        {oversizedBudgetAdSets
                          .map(
                            (s) =>
                              `${s.name} (${bs.currency} ${s.budgetPerDay.toFixed(2)}, ${Math.round(s.shareOfCampaign * 100)}%)`,
                          )
                          .join("; ")}
                        .
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-warning/80">
                    Review before launch — a single oversized blank/Wide set can outspend the rest of the campaign.
                  </p>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-border overflow-hidden">
              {adSetSuggestions.map((s) => {
                const isBlank = s.sourceType === "blank";
                return (
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
                          <input
                            type="text"
                            value={s.name}
                            onChange={(e) =>
                              updateSuggestion(s.id, { name: e.target.value.slice(0, MAX_ADSET_NAME_LENGTH) })
                            }
                            maxLength={MAX_ADSET_NAME_LENGTH}
                            title="Click to rename this ad set"
                            placeholder="Ad set name"
                            className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-foreground hover:border-border focus:border-primary focus:bg-card focus:outline-none"
                          />
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
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Per-row location group assignment (refinement pack #5) —
                            only shown once there's a real choice to make. */}
                        {locationGroups.length > 1 && (
                          <select
                            value={s.locationGroupId ?? ""}
                            onChange={(e) => {
                              const group = locationGroups.find((g) => g.id === e.target.value);
                              if (!group) return;
                              updateSuggestion(s.id, {
                                locationGroupId: group.id,
                                locationLabel: group.label,
                                geoLocations: groupToGeo(group),
                              });
                            }}
                            title="Location group for this ad set"
                            className="max-w-[8.5rem] rounded border border-border bg-card px-1.5 py-1 text-[11px]"
                          >
                            {!s.locationGroupId && (
                              <option value="">{s.locationLabel ?? "Default location"}</option>
                            )}
                            {locationGroups.map((g) => (
                              <option key={g.id} value={g.id}>{g.label}</option>
                            ))}
                          </select>
                        )}
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
                          onClick={() => {
                            if (isBlank || !advantagePlusSupported) return;
                            updateSuggestion(s.id, { advantagePlus: !s.advantagePlus });
                          }}
                          disabled={isBlank || !advantagePlusSupported}
                          title={
                            !advantagePlusSupported
                              ? `Meta doesn't support Advantage+ Audience for ${objectiveDisplayName(settings.objective)} campaigns — automatically cleared for this ad set.`
                              : isBlank
                              ? "Blank ad sets always run Advantage+ Audience — there's no audience to target strictly"
                              : s.advantagePlus
                              ? "Advantage+ ON — age sent as suggestion. Click to switch to strict targeting."
                              : "Advantage+ OFF — strict age targeting. Click to enable Advantage+ audience."
                          }
                          className={`rounded-md border px-2 py-1 text-[10px] font-medium transition-colors
                            ${s.advantagePlus
                              ? "border-primary bg-primary-light text-primary"
                              : "border-border text-muted-foreground hover:bg-muted"}
                            ${isBlank || !advantagePlusSupported ? "cursor-not-allowed opacity-80" : ""}`}
                        >
                          {s.advantagePlus ? "Advantage+ ON" : "Advantage+"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPlacementAdSetId(expandedPlacementAdSetId === s.id ? null : s.id)
                          }
                          title={
                            s.placementConfig
                              ? "This ad set has its own placement override"
                              : "Uses the campaign-wide Placements config above"
                          }
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors
                            ${s.placementConfig
                              ? "border-primary bg-primary-light text-primary"
                              : "border-border text-muted-foreground hover:bg-muted"}`}
                        >
                          <Layers className="h-3 w-3" />
                          Placements
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateRow(s.id)}
                          title="Duplicate this ad set (inserted directly below)"
                          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(s.id)}
                          title="Delete this ad set"
                          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {/* ── Blank ad set hint ─────────────────────────────────── */}
                    {isBlank && advantagePlusSupported && (
                      <div className="flex items-center gap-1.5 border-t border-primary/10 bg-primary-light/50 px-4 py-1.5">
                        <Lightbulb className="h-3 w-3 shrink-0 text-primary" />
                        <span className="text-[11px] text-primary">
                          No audience source — pure Meta-driven prospecting from location + demographics. Advantage+ Audience is locked ON.
                        </span>
                      </div>
                    )}
                    {/* task #127 — Advantage+ can't be locked ON here anymore once the
                        objective doesn't support it; the auto-normaliser above clears
                        it, so this ad set runs as plain broad targeting instead. */}
                    {isBlank && !advantagePlusSupported && (
                      <div className="flex items-center gap-1.5 border-t border-warning/20 bg-warning/10 px-4 py-1.5">
                        <AlertTriangle className="h-3 w-3 shrink-0 text-warning" />
                        <span className="text-[11px] text-warning">
                          No audience source, and Advantage+ Audience isn&apos;t available for{" "}
                          {objectiveDisplayName(settings.objective)} campaigns — this ad set runs as plain broad
                          targeting (age + location only) instead.
                        </span>
                      </div>
                    )}
                    {/* ── Advantage+ age hint ──────────────────────────────── */}
                    {s.advantagePlus && !isBlank && (
                      <div className="flex items-center gap-1.5 border-t border-primary/10 bg-primary-light/50 px-4 py-1.5">
                        <Lightbulb className="h-3 w-3 shrink-0 text-primary" />
                        <span className="text-[11px] text-primary">
                          With Advantage+ audience, age is sent as a suggestion rather than a strict limit — Meta may expand beyond it.
                        </span>
                      </div>
                    )}
                    {/* ── Per-ad-set placement override (task #117) ─────────── */}
                    {expandedPlacementAdSetId === s.id && (
                      <div className="border-t border-border bg-muted/30 px-4 py-3">
                        <p className="mb-2 text-[11px] text-muted-foreground">
                          Override placements for this ad set only — otherwise it uses the campaign-wide
                          Placements config above.
                        </p>
                        <PlacementPicker
                          compact
                          value={s.placementConfig ?? settings.placementConfig}
                          onChange={(config) => updateSuggestion(s.id, { placementConfig: config })}
                          onClear={
                            s.placementConfig
                              ? () => updateSuggestion(s.id, { placementConfig: undefined })
                              : undefined
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <BulkAgeModal
        open={ageModalOpen}
        onClose={() => setAgeModalOpen(false)}
        onApply={applyBulkAges}
        initialMin={adSetSuggestions[0]?.ageMin ?? 18}
        initialMax={adSetSuggestions[0]?.ageMax ?? 65}
        rowCount={adSetSuggestions.length}
      />
      <BulkBudgetModal
        open={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        onApply={applyBulkBudgets}
        initialBudget={adSetSuggestions[0]?.budgetPerDay ?? 0}
        currency={bs.currency}
        rowCount={adSetSuggestions.length}
      />
    </div>
  );
}
