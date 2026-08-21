"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import {
  buildTikTokLocationLookup,
  filterTikTokRegions,
  resolveTikTokGenderLabel,
  resolveTikTokLanguageLabel,
  resolveTikTokLocationLabel,
  visibleTikTokCategoryRows,
  type TikTokLocationLookup,
} from "@/lib/tiktok-wizard/audience-display";
import {
  expandTikTokPresetKeywords,
  formatTikTokUnresolvedPresetPaths,
  mergeTikTokPresetTaxonomy,
  resolveTikTokPresetTaxonomy,
  tikTokHashtagPresetQuery,
  tikTokPresetTaxonomyPendingReason,
  TIKTOK_GENRE_PRESET_LIMITATION_NOTE,
  TIKTOK_GENRE_PRESETS,
  type TikTokGenrePreset,
} from "@/lib/tiktok-wizard/genre-presets";
import {
  createEmptyTikTokInterestGroup,
  flattenTikTokInterestGroups,
  formatTikTokInterestGroupCounts,
  hasLegacyTikTokTargeting,
  isTikTokInterestGroupNonEmpty,
  removeTikTokInterestGroup,
  seedTikTokInterestGroupFromLegacy,
} from "@/lib/tiktok-wizard/interest-groups";
import { tikTokHashtagUnavailableNote } from "@/lib/tiktok-wizard/hashtag-recommend";
import {
  tikTokAgeWideningNote,
  tikTokGenderWideningNote,
  TIKTOK_CAMPAIGN_WIDE_AUDIENCE_NOTE,
  TIKTOK_SAVED_AUDIENCE_SINGLE_NOTE,
} from "@/lib/tiktok-wizard/targeting-warnings";
import {
  TIKTOK_SEMANTIC_FALLBACK_NOTE,
} from "@/lib/tiktok-wizard/keyword-recommend";
import type {
  TikTokAudienceCategory,
  TikTokAudienceListItem,
  TikTokAudienceRecommendItem,
  TikTokHashtagOperator,
  TikTokInterestAudienceType,
  TikTokInterestKeywordMode,
  TikTokLanguageOption,
  TikTokRegionOption,
} from "@/lib/tiktok/audience";
import {
  readAudienceCatalogState,
  readAudienceDimensionFailed,
} from "@/lib/tiktok/audience-response";
import { tikTokLocationAlreadySelected } from "@/lib/tiktok/write/mapping";
import type {
  TikTokAudiences,
  TikTokCampaignDraft,
  TikTokInterestGroup,
  TikTokTargetingItem,
} from "@/lib/types/tiktok-draft";

// Custom audiences and lookalikes are deliberately NOT tabs: they are stored
// draft-wide (`audiences.customAudienceIds` / `lookalikeAudienceIds`) and the
// mapper applies them to every ad group, so putting them in the per-group tab
// strip implied a scoping that does not exist. They live in their own
// campaign-wide section below.
type CatalogTab = "interests" | "hashtags" | "behaviours";

interface CategoryFailed {
  interests: boolean;
  behaviours: boolean;
  customAudiences: boolean;
  savedAudiences: boolean;
}

export function AudiencesStep({
  draft,
  onSave,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
}) {
  const audiences = draft.audiences;
  const [activeTab, setActiveTab] = useState<CatalogTab>("interests");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(
    audiences.interestGroups[0]?.id ?? null,
  );
  const [interests, setInterests] = useState<TikTokAudienceCategory[]>([]);
  const [behaviours, setBehaviours] = useState<TikTokAudienceCategory[]>([]);
  const [customAudiences, setCustomAudiences] = useState<TikTokAudienceListItem[]>([]);
  const [savedAudiences, setSavedAudiences] = useState<TikTokAudienceListItem[]>([]);
  const [regions, setRegions] = useState<TikTokRegionOption[]>([]);
  const [languageOptions, setLanguageOptions] = useState<TikTokLanguageOption[]>([]);
  const [keywordResults, setKeywordResults] = useState<TikTokAudienceRecommendItem[]>([]);
  const [hashtagResults, setHashtagResults] = useState<TikTokAudienceRecommendItem[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [loadingHashtags, setLoadingHashtags] = useState(false);
  const [catalogFailed, setCatalogFailed] = useState<CategoryFailed>({
    interests: false,
    behaviours: false,
    customAudiences: false,
    savedAudiences: false,
  });
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [regionsFailed, setRegionsFailed] = useState(false);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [languagesFailed, setLanguagesFailed] = useState(false);
  const [languagesError, setLanguagesError] = useState<string | null>(null);
  const [keywordFailed, setKeywordFailed] = useState<string | null>(null);
  const [hashtagFailed, setHashtagFailed] = useState<string | null>(null);
  const [catalogReload, setCatalogReload] = useState(0);
  const [geoReload, setGeoReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ageMin, setAgeMin] = useState(String(audiences.ageMin));
  const [ageMax, setAgeMax] = useState(String(audiences.ageMax));
  const [seed, setSeed] = useState("");
  const [keywordMode, setKeywordMode] =
    useState<TikTokInterestKeywordMode>("FUZZ_MATCH");
  const [keywordSemanticFallback, setKeywordSemanticFallback] = useState(false);
  const [audienceType, setAudienceType] =
    useState<TikTokInterestAudienceType>("GENERAL_INTEREST");
  const [hashtagSeeds, setHashtagSeeds] = useState("");
  const [hashtagOperator, setHashtagOperator] =
    useState<TikTokHashtagOperator>("OR");
  const [locationQuery, setLocationQuery] = useState("");
  const [languageQuery, setLanguageQuery] = useState("");
  const keywordAbort = useRef<AbortController | null>(null);
  const hashtagAbort = useRef<AbortController | null>(null);
  const pendingPresetTaxonomyId = useRef<string | null>(null);
  const presetAbort = useRef<AbortController | null>(null);
  const pointerDeletedGroupIds = useRef(new Set<string>());
  const groupCardRefs = useRef(new Map<string, HTMLDivElement>());
  const [scrollToGroupId, setScrollToGroupId] = useState<string | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [keywordSource, setKeywordSource] = useState<"idle" | "typed" | "preset">(
    "idle",
  );
  const [keywordProvenance, setKeywordProvenance] = useState<Record<string, string[]>>(
    {},
  );
  const [presetPartialNote, setPresetPartialNote] = useState<string | null>(null);
  const [presetTaxonomyNote, setPresetTaxonomyNote] = useState<string | null>(null);

  const advertiserId = draft.accountSetup.advertiserId;
  const audiencesRef = useRef(audiences);
  audiencesRef.current = audiences;
  const groups = audiences.interestGroups;
  const activeGroup =
    groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null;

  useEffect(() => {
    if (!advertiserId) return;
    let cancelled = false;
    setLoadingCatalog(true);
    fetch(
      `/api/tiktok/audience/categories?advertiser_id=${encodeURIComponent(advertiserId)}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then(
        (json: {
          ok?: boolean;
          interests?: TikTokAudienceCategory[];
          behaviours?: TikTokAudienceCategory[];
          customAudiences?: TikTokAudienceListItem[];
          savedAudiences?: TikTokAudienceListItem[];
          failed?: Partial<CategoryFailed>;
          error?: string;
        }) => {
          if (cancelled) return;
          const state = readAudienceCatalogState(json);
          if (!json.ok) {
            setInterests([]);
            setBehaviours([]);
            setCustomAudiences([]);
            setSavedAudiences([]);
            setCatalogFailed(state.catalogFailed);
            setCatalogWarning(json.error ?? state.warning);
            return;
          }
          setInterests(json.interests ?? []);
          setBehaviours(json.behaviours ?? []);
          setCustomAudiences(json.customAudiences ?? []);
          setSavedAudiences(json.savedAudiences ?? []);
          setCatalogFailed(state.catalogFailed);
          setCatalogWarning(state.warning);
        },
      )
      .catch(() => {
        if (!cancelled) {
          setCatalogFailed({
            interests: true,
            behaviours: true,
            customAudiences: true,
            savedAudiences: true,
          });
          setCatalogWarning("TikTok audience data is unavailable.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCatalog(false);
      });
    return () => {
      cancelled = true;
    };
  }, [advertiserId, catalogReload]);

  useEffect(() => {
    if (!advertiserId) return;
    let cancelled = false;
    fetch(
      `/api/tiktok/audience/regions?advertiser_id=${encodeURIComponent(advertiserId)}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then((json: { ok?: boolean; regions?: TikTokRegionOption[]; failed?: boolean; error?: string }) => {
        if (cancelled) return;
        const state = readAudienceDimensionFailed(json);
        setRegions(json.regions ?? []);
        setRegionsFailed(state.failed);
        setRegionsError(state.error);
      })
      .catch(() => {
        if (!cancelled) {
          setRegionsFailed(true);
          setRegionsError("Locations failed to load.");
        }
      });
    fetch(
      `/api/tiktok/audience/languages?advertiser_id=${encodeURIComponent(advertiserId)}`,
      { cache: "no-store" },
    )
      .then((res) => res.json())
      .then((json: { ok?: boolean; languages?: TikTokLanguageOption[]; failed?: boolean; error?: string }) => {
        if (cancelled) return;
        const state = readAudienceDimensionFailed(json);
        setLanguageOptions(json.languages ?? []);
        setLanguagesFailed(state.failed);
        setLanguagesError(state.error);
      })
      .catch(() => {
        if (!cancelled) {
          setLanguagesFailed(true);
          setLanguagesError("Languages failed to load.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [advertiserId, geoReload]);

  useEffect(() => {
    if (keywordSource === "preset") return;
    if (!advertiserId || !seed.trim()) {
      setKeywordResults([]);
      setKeywordFailed(null);
      setKeywordProvenance({});
      setKeywordSemanticFallback(false);
      return;
    }
    const controller = new AbortController();
    keywordAbort.current?.abort();
    keywordAbort.current = controller;
    const timer = window.setTimeout(() => {
      setLoadingKeywords(true);
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        keyword: seed.trim(),
        mode: keywordMode,
        audience_type: audienceType,
      });
      fetch(`/api/tiktok/audience/keywords?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; keywords?: TikTokAudienceRecommendItem[]; failed?: boolean; error?: string; semanticFallback?: boolean }) => {
          setKeywordResults(json.keywords ?? []);
          setKeywordSemanticFallback(Boolean(json.semanticFallback));
          const state = readAudienceDimensionFailed(json);
          setKeywordFailed(
            state.failed ? state.error ?? "Keyword recommend failed" : null,
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setKeywordFailed("Keyword recommend failed");
        })
        .finally(() => setLoadingKeywords(false));
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [advertiserId, seed, keywordMode, audienceType, keywordSource]);

  useEffect(() => {
    if (activePresetId) return;
    const keywords = parseHashtagSeeds(hashtagSeeds);
    if (!advertiserId || keywords.length === 0) {
      setHashtagResults([]);
      setHashtagFailed(null);
      return;
    }
    const controller = new AbortController();
    hashtagAbort.current?.abort();
    hashtagAbort.current = controller;
    const timer = window.setTimeout(() => {
      setLoadingHashtags(true);
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        operator: hashtagOperator,
      });
      keywords.forEach((keyword) => params.append("keyword", keyword));
      fetch(`/api/tiktok/audience/hashtags?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((json: { ok?: boolean; hashtags?: TikTokAudienceRecommendItem[]; failed?: boolean; error?: string }) => {
          setHashtagResults(json.hashtags ?? []);
          const state = readAudienceDimensionFailed(json);
          setHashtagFailed(
            state.failed ? state.error ?? "Hashtag recommend failed" : null,
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setHashtagFailed("Hashtag recommend failed");
        })
        .finally(() => setLoadingHashtags(false));
    }, 600);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [advertiserId, hashtagSeeds, hashtagOperator, activePresetId]);

  async function persist(next: Partial<TikTokAudiences>) {
    setSaving(true);
    setSaveError(null);
    const previous = audiencesRef.current;
    const latest = { ...previous, ...next };
    audiencesRef.current = latest;
    try {
      await onSave({ audiences: latest });
    } catch (err) {
      audiencesRef.current = previous;
      setSaveError(err instanceof Error ? err.message : "Failed to save audiences");
    } finally {
      setSaving(false);
    }
  }

  async function persistGroups(nextGroups: TikTokInterestGroup[]) {
    const flat = flattenTikTokInterestGroups(nextGroups);
    await persist({
      interestGroups: nextGroups,
      ...flat,
    });
  }

  async function applyPresetTaxonomy(preset: TikTokGenrePreset) {
    const group =
      audiencesRef.current.interestGroups.find((item) => item.id === activeGroupId) ??
      audiencesRef.current.interestGroups[0];
    const catalogLoaded = interests.length > 0 || behaviours.length > 0;
    if (
      tikTokPresetTaxonomyPendingReason({
        hasGroup: Boolean(group),
        catalogLoaded,
      })
    ) {
      return true;
    }
    if (!group) return true;
    const taxonomy = resolveTikTokPresetTaxonomy(
      { interests, behaviours },
      preset,
    );
    setPresetTaxonomyNote(formatTikTokUnresolvedPresetPaths(taxonomy.unresolvedPaths));
    const merged = mergeTikTokPresetTaxonomy(group, taxonomy);
    const unchanged =
      merged.interestIds.length === group.interestIds.length &&
      merged.behaviourIds.length === group.behaviourIds.length &&
      merged.interestIds.every((item, index) => item.id === group.interestIds[index]?.id) &&
      merged.behaviourIds.every((item, index) => item.id === group.behaviourIds[index]?.id);
    if (unchanged) return false;
    await persistGroups(
      audiencesRef.current.interestGroups.map((item) =>
        item.id === group.id ? { ...item, ...merged } : item,
      ),
    );
    return false;
  }

  async function addGroup() {
    const current = audiencesRef.current;
    const group =
      current.interestGroups.length === 0 && hasLegacyTikTokTargeting(current)
        ? seedTikTokInterestGroupFromLegacy(current)
        : createEmptyTikTokInterestGroup();
    if (!group.name) group.name = `Group ${current.interestGroups.length + 1}`;
    await persistGroups([...current.interestGroups, group]);
    setActiveGroupId(group.id);
    setScrollToGroupId(group.id);
  }

  useEffect(() => {
    if (!scrollToGroupId) return;
    const card = groupCardRefs.current.get(scrollToGroupId);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollToGroupId(null);
  }, [scrollToGroupId, groups]);

  async function removeGroup(groupId: string) {
    const next = removeTikTokInterestGroup(audiencesRef.current, groupId);
    await persist(next);
    if (activeGroupId === groupId) setActiveGroupId(next.interestGroups[0]?.id ?? null);
  }

  async function renameGroup(groupId: string, name: string) {
    await persistGroups(
      audiencesRef.current.interestGroups.map((group) =>
        group.id === groupId ? { ...group, name } : group,
      ),
    );
  }

  function clearPresetMode() {
    pendingPresetTaxonomyId.current = null;
    setActivePresetId(null);
    setPresetPartialNote(null);
    setPresetTaxonomyNote(null);
  }

  useEffect(() => {
    const presetId = pendingPresetTaxonomyId.current;
    if (!presetId) return;
    if (interests.length === 0 && behaviours.length === 0) return;
    const preset = TIKTOK_GENRE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    void applyPresetTaxonomy(preset).then((stillPending) => {
      if (!stillPending) pendingPresetTaxonomyId.current = null;
    });
    // Catalog arrival only — applyPreset already tries once with whatever is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interests, behaviours]);

  async function applyPreset(preset: TikTokGenrePreset) {
    if (!advertiserId) return;
    keywordAbort.current?.abort();
    hashtagAbort.current?.abort();
    presetAbort.current?.abort();
    const controller = new AbortController();
    keywordAbort.current = controller;
    hashtagAbort.current = controller;
    presetAbort.current = controller;
    setActivePresetId(preset.id);
    pendingPresetTaxonomyId.current = preset.id;
    void applyPresetTaxonomy(preset).then((stillPending) => {
      if (!stillPending) pendingPresetTaxonomyId.current = null;
    });
    setKeywordSource("preset");
    setSeed("");
    setHashtagSeeds(preset.seeds.join(", "));
    setHashtagOperator("OR");
    setKeywordFailed(null);
    setHashtagFailed(null);
    setPresetPartialNote(null);
    setPresetTaxonomyNote(null);
    setKeywordProvenance({});
    setLoadingKeywords(true);
    setLoadingHashtags(true);
    setKeywordSemanticFallback(false);

    let semanticFallback = false;
    const keywordPromise = expandTikTokPresetKeywords(preset.seeds, async (keyword) => {
      const params = new URLSearchParams({
        advertiser_id: advertiserId,
        keyword,
        mode: keywordMode,
        audience_type: audienceType,
      });
      const res = await fetch(`/api/tiktok/audience/keywords?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await res.json()) as {
        ok?: boolean;
        keywords?: TikTokAudienceRecommendItem[];
        error?: string;
        semanticFallback?: boolean;
      };
      if (json.ok === false) {
        throw new Error(json.error ?? "Keyword recommend failed");
      }
      if (json.semanticFallback) semanticFallback = true;
      return json.keywords ?? [];
    });

    const hashtagQuery = tikTokHashtagPresetQuery(preset.seeds);
    const hashtagParams = new URLSearchParams({
      advertiser_id: advertiserId,
      operator: hashtagQuery.operator,
    });
    hashtagQuery.keywords.forEach((keyword) =>
      hashtagParams.append("keyword", keyword),
    );
    const hashtagPromise = fetch(`/api/tiktok/audience/hashtags?${hashtagParams}`, {
      cache: "no-store",
      signal: controller.signal,
    }).then(
      (res) =>
        res.json() as Promise<{
          ok?: boolean;
          hashtags?: TikTokAudienceRecommendItem[];
          failed?: boolean;
          error?: string;
        }>,
    );

    const [keywordSettled, hashtagSettled] = await Promise.allSettled([
      keywordPromise,
      hashtagPromise,
    ]);
    if (controller.signal.aborted) return;

    if (keywordSettled.status === "fulfilled") {
      const expanded = keywordSettled.value;
      setKeywordResults(
        expanded.rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: "keyword" as const,
          audienceSize: row.audienceSize,
        })),
      );
      setKeywordProvenance(
        Object.fromEntries(expanded.rows.map((row) => [row.id, row.seeds])),
      );
      if (semanticFallback) setKeywordSemanticFallback(true);
      if (expanded.failedSeeds.length > 0) {
        setPresetPartialNote(
          `Some seeds failed (${expanded.failedSeeds.join(", ")}). Showing the rest.`,
        );
      }
    } else if (!isAbortError(keywordSettled.reason)) {
      setKeywordResults([]);
      setKeywordFailed("Keyword recommend failed");
    }

    if (hashtagSettled.status === "fulfilled") {
      const json = hashtagSettled.value;
      setHashtagResults(json.hashtags ?? []);
      const state = readAudienceDimensionFailed(json);
      setHashtagFailed(
        state.failed ? state.error ?? "Hashtag recommend failed" : null,
      );
    } else if (!isAbortError(hashtagSettled.reason)) {
      setHashtagResults([]);
      setHashtagFailed("Hashtag recommend failed");
    }

    setLoadingKeywords(false);
    setLoadingHashtags(false);
  }

  useEffect(() => {
    if (!activePresetId) return;
    const preset = TIKTOK_GENRE_PRESETS.find((item) => item.id === activePresetId);
    if (preset) void applyPreset(preset);
    // Re-fan the same seeds when recommend mode or audience type changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordMode, audienceType]);

  async function toggleGroupItem(
    key: "interestIds" | "hashtagIds" | "behaviourIds",
    item: TikTokTargetingItem,
  ) {
    if (!activeGroup) return;
    const current = activeGroup[key];
    const exists = current.some((row) => row.id === item.id);
    const nextItems = exists
      ? current.filter((row) => row.id !== item.id)
      : [...current, item];
    await persistGroups(
      audiencesRef.current.interestGroups.map((group) =>
        group.id === activeGroup.id ? { ...group, [key]: nextItems } : group,
      ),
    );
  }

  async function toggleListItem(
    id: string,
    label: string,
    key: "customAudienceIds" | "lookalikeAudienceIds",
    labelKey: "customAudienceLabels" | "lookalikeAudienceLabels",
  ) {
    const current = audiences[key];
    const exists = current.includes(id);
    const next = exists ? current.filter((item) => item !== id) : [...current, id];
    const labels = { ...audiences[labelKey] };
    if (exists) delete labels[id];
    else labels[id] = label;
    await persist({ [key]: next, [labelKey]: labels });
  }

  const hashtagUnavailableNote = tikTokHashtagUnavailableNote({
    failed: Boolean(hashtagFailed),
    rowCount: hashtagResults.length,
    keywords: parseHashtagSeeds(hashtagSeeds),
  });

  const ageNote = tikTokAgeWideningNote(audiences.ageMin, audiences.ageMax);
  const genderNote = tikTokGenderWideningNote(audiences.genders);

  const interestTree = useMemo(() => buildTree(interests), [interests]);
  const filteredRegions = useMemo(
    () => filterTikTokRegions(regions, locationQuery),
    [regions, locationQuery],
  );
  const locationLookup = useMemo(
    () => buildTikTokLocationLookup(regions),
    [regions],
  );
  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLowerCase();
    const unused = languageOptions.filter(
      (language) => !audiences.languages.includes(language.id),
    );
    if (!query) return unused.slice(0, 40);
    return unused
      .filter((language) =>
        `${language.name} ${language.id}`.toLowerCase().includes(query),
      )
      .slice(0, 40);
  }, [languageOptions, languageQuery, audiences.languages]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">Audiences</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Name one interest group per intended ad group. Seed TikTok for
          recommended interests and hashtags, then add locations and languages.
        </p>
      </div>

      {!advertiserId && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-warning-foreground">
          Select an advertiser in Step 0 to load TikTok audience options.
        </p>
      )}

      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      <div className="rounded-md border border-border bg-background p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Targeting summary
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {summaryChips(draft, locationLookup, languageOptions).map((chip) => (
            <span key={chip} className="rounded-full bg-muted px-3 py-1 text-xs text-foreground">
              {chip}
            </span>
          ))}
          {summaryChips(draft, locationLookup, languageOptions).length === 0 && (
            <span className="text-sm text-muted-foreground">No targeting selected yet.</span>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Interest groups</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => void addGroup()} disabled={saving}>
            Add group
          </Button>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add a named group. Each non-empty group becomes one ad group.
          </p>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => {
              const isActive = group.id === activeGroup?.id;
              const counts = formatTikTokInterestGroupCounts(group);
              return (
                <div
                  key={group.id}
                  ref={(node) => {
                    if (node) groupCardRefs.current.set(group.id, node);
                    else groupCardRefs.current.delete(group.id);
                  }}
                  onClick={() => setActiveGroupId(group.id)}
                  className={`cursor-pointer rounded-md p-3 text-left ${
                    isActive
                      ? "border border-primary border-l-4 bg-primary/10 shadow-sm ring-2 ring-primary/40"
                      : "border border-border bg-background hover:bg-muted/50"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {isActive ? (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground">
                        Active
                      </span>
                    ) : (
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {isTikTokInterestGroupNonEmpty(group) ? "Ready" : "Empty"}
                      </span>
                    )}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                      {counts}
                    </span>
                    <div className="min-w-[12rem] flex-1">
                      <GroupNameInput
                        groupId={group.id}
                        name={group.name}
                        onCommit={(groupId, name) => void renameGroup(groupId, name)}
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        pointerDeletedGroupIds.current.add(group.id);
                        void removeGroup(group.id);
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (pointerDeletedGroupIds.current.has(group.id)) {
                          pointerDeletedGroupIds.current.delete(group.id);
                          return;
                        }
                        void removeGroup(group.id);
                      }}
                    >
                      Delete · {counts}
                    </Button>
                  </div>
                  {isActive && (
                    <div
                      className="mt-3 flex flex-wrap gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {group.interestIds.map((item) => (
                        <button
                          key={`${group.id}-interest-${item.id}`}
                          type="button"
                          className="rounded-full bg-muted px-3 py-1 text-xs"
                          onClick={() => void toggleGroupItem("interestIds", item)}
                        >
                          Interest · {item.name} ×
                        </button>
                      ))}
                      {group.hashtagIds.map((item) => (
                        <button
                          key={`${group.id}-hashtag-${item.id}`}
                          type="button"
                          className="rounded-full bg-muted px-3 py-1 text-xs"
                          onClick={() => void toggleGroupItem("hashtagIds", item)}
                        >
                          Hashtag · {item.name} ×
                        </button>
                      ))}
                      {group.behaviourIds.map((item) => (
                        <button
                          key={`${group.id}-behaviour-${item.id}`}
                          type="button"
                          className="rounded-full bg-muted px-3 py-1 text-xs"
                          onClick={() => void toggleGroupItem("behaviourIds", item)}
                        >
                          Behaviour · {item.name} ×
                        </button>
                      ))}
                      {!isTikTokInterestGroupNonEmpty(group) && (
                        <p className="text-xs text-muted-foreground">
                          Nothing selected yet. Use the pickers below.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {(["interests", "hashtags", "behaviours"] as CatalogTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-md border px-3 py-2 text-sm ${
              activeTab === tab
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {tabLabel(tab)}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {activeGroup
          ? `Selecting for ${activeGroup.name || "Untitled group"}.`
          : "Add a group to enable the pickers."}
      </p>

      {activeTab === "interests" && (
        <div className="space-y-4">
          {failedBanner(
            catalogFailed.interests,
            catalogWarning ?? "Interest categories failed to load.",
            () => setCatalogReload((count) => count + 1),
          )}
          <GenrePresetRow
            activePresetId={activePresetId}
            disabled={!advertiserId || !activeGroup}
            onSelect={(preset) => void applyPreset(preset)}
          />
          {presetPartialNote && (
            <p className="text-sm text-warning-foreground">{presetPartialNote}</p>
          )}
          {presetTaxonomyNote && (
            <p className="text-sm text-warning-foreground">{presetTaxonomyNote}</p>
          )}
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <SearchInput
              value={seed}
              onChange={(event) => {
                clearPresetMode();
                setKeywordSource(event.target.value.trim() ? "typed" : "idle");
                setKeywordProvenance({});
                setSeed(event.target.value);
              }}
              placeholder="Seed keyword — TikTok recommends related interests"
              onClear={() => {
                clearPresetMode();
                setKeywordSource("idle");
                setKeywordProvenance({});
                setSeed("");
              }}
              disabled={!advertiserId || !activeGroup}
            />
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={keywordMode}
              onChange={(event) =>
                setKeywordMode(event.target.value as TikTokInterestKeywordMode)
              }
            >
              <option value="FUZZ_MATCH">Fuzz match</option>
              <option value="SEMANTIC_RECOMMEND">Semantic recommend</option>
            </select>
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={audienceType}
              onChange={(event) =>
                setAudienceType(event.target.value as TikTokInterestAudienceType)
              }
            >
              <option value="GENERAL_INTEREST">General interest</option>
              <option value="PURCHASE_INTENTION">Purchase intention</option>
            </select>
          </div>
          {keywordFailed && (
            <p className="text-sm text-warning-foreground">{keywordFailed}</p>
          )}
          {keywordSemanticFallback && (
            <p className="text-sm text-warning-foreground">
              {TIKTOK_SEMANTIC_FALLBACK_NOTE}
            </p>
          )}
          {loadingKeywords && <p className="text-sm text-muted-foreground">Loading recommendations…</p>}
          <RecommendList
            rows={keywordResults}
            selectedIds={activeGroup?.interestIds.map((item) => item.id) ?? []}
            provenance={keywordProvenance}
            disabled={saving || !activeGroup}
            empty={
              keywordSemanticFallback
                ? TIKTOK_SEMANTIC_FALLBACK_NOTE
                : activePresetId
                  ? "No keyword recommendations for this preset."
                  : seed.trim()
                    ? "No keyword recommendations."
                    : "Enter a seed keyword."
            }
            onToggle={(row) =>
              void toggleGroupItem("interestIds", {
                id: row.id,
                name: row.name,
                kind: "keyword",
                audienceType,
                audienceSize: row.audienceSize,
              })
            }
          />
          {loadingCatalog ? (
            <SkeletonTree />
          ) : catalogFailed.interests ? null : (
            <CategoryList
              rows={interestTree}
              selectedIds={activeGroup?.interestIds.map((item) => item.id) ?? []}
              disabled={saving || loadingCatalog || !activeGroup}
              empty="No interest categories available."
              onToggle={(row) =>
                void toggleGroupItem("interestIds", {
                  id: row.id,
                  name: row.label,
                  kind: "category",
                })
              }
            />
          )}
        </div>
      )}

      {activeTab === "hashtags" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Up to 10 keywords. AND with unrelated keywords often returns nothing.
          </p>
          <GenrePresetRow
            activePresetId={activePresetId}
            disabled={!advertiserId || !activeGroup}
            onSelect={(preset) => void applyPreset(preset)}
          />
          {presetPartialNote && (
            <p className="text-sm text-warning-foreground">{presetPartialNote}</p>
          )}
          {presetTaxonomyNote && (
            <p className="text-sm text-warning-foreground">{presetTaxonomyNote}</p>
          )}
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <SearchInput
              value={hashtagSeeds}
              onChange={(event) => {
                clearPresetMode();
                setHashtagSeeds(limitHashtagSeeds(event.target.value));
              }}
              placeholder="house, techno, warehouse"
              onClear={() => {
                clearPresetMode();
                setHashtagSeeds("");
              }}
              disabled={!advertiserId || !activeGroup}
            />
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={hashtagOperator}
              onChange={(event) => {
                clearPresetMode();
                setHashtagOperator(event.target.value as TikTokHashtagOperator);
              }}
            >
              <option value="OR">OR</option>
              <option value="AND">AND</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            {parseHashtagSeeds(hashtagSeeds).length}/10 keywords
          </p>
          {hashtagFailed && (
            <p className="text-sm text-warning-foreground">{hashtagFailed}</p>
          )}
          {hashtagUnavailableNote && (
            <p className="text-sm text-warning-foreground">
              {hashtagUnavailableNote}
            </p>
          )}
          {loadingHashtags && <p className="text-sm text-muted-foreground">Loading hashtags…</p>}
          <RecommendList
            rows={hashtagResults}
            selectedIds={activeGroup?.hashtagIds.map((item) => item.id) ?? []}
            disabled={saving || !activeGroup}
            empty={
              hashtagUnavailableNote
                ? hashtagUnavailableNote
                : activePresetId
                  ? "No hashtag recommendations for this preset."
                  : parseHashtagSeeds(hashtagSeeds).length
                    ? "No hashtag recommendations."
                    : "Enter keywords."
            }
            onToggle={(row) =>
              void toggleGroupItem("hashtagIds", {
                id: row.id,
                name: row.name,
                kind: "keyword",
                audienceSize: row.audienceSize,
              })
            }
          />
        </div>
      )}

      {activeTab === "behaviours" && (
        <div className="space-y-3">
          {failedBanner(
            catalogFailed.behaviours,
            catalogWarning ?? "Behaviours failed to load.",
            () => setCatalogReload((count) => count + 1),
          )}
          {!catalogFailed.behaviours && (
            <CategoryList
              rows={behaviours.map((row) => ({ ...row, depth: 0 }))}
              selectedIds={activeGroup?.behaviourIds.map((item) => item.id) ?? []}
              disabled={saving || loadingCatalog || !activeGroup}
              empty="No behaviours available for this advertiser."
              onToggle={(row) =>
                void toggleGroupItem("behaviourIds", {
                  id: row.id,
                  name: row.label,
                  kind: "category",
                })
              }
            />
          )}
        </div>
      )}

      <section className="space-y-4 rounded-md border border-border bg-background p-4">
        <div>
          <h3 className="text-sm font-medium">Campaign-wide audiences</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {TIKTOK_CAMPAIGN_WIDE_AUDIENCE_NOTE}
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium">Custom audiences</p>
            {catalogFailed.customAudiences ? (
              failedBanner(
                true,
                catalogWarning ?? "Custom audiences temporarily unavailable.",
                () => setCatalogReload((count) => count + 1),
              )
            ) : (
              <AudienceList
                rows={customAudiences}
                selectedIds={audiences.customAudienceIds}
                disabled={saving || loadingCatalog}
                empty="No custom audiences available."
                onToggle={(row) =>
                  void toggleListItem(
                    row.id,
                    row.label,
                    "customAudienceIds",
                    "customAudienceLabels",
                  )
                }
              />
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Lookalikes</p>
            <p className="text-xs text-muted-foreground">
              {TIKTOK_SAVED_AUDIENCE_SINGLE_NOTE}
            </p>
            {audiences.lookalikeAudienceIds.length > 1 && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {audiences.lookalikeAudienceIds.length} lookalikes selected —
                launch is blocked until one remains.
              </p>
            )}
            {catalogFailed.savedAudiences ? (
              failedBanner(
                true,
                catalogWarning ?? "Lookalikes temporarily unavailable.",
                () => setCatalogReload((count) => count + 1),
              )
            ) : (
              <AudienceList
                rows={savedAudiences}
                selectedIds={audiences.lookalikeAudienceIds}
                disabled={saving || loadingCatalog}
                empty="No lookalikes available."
                onToggle={(row) =>
                  void toggleListItem(
                    row.id,
                    row.label,
                    "lookalikeAudienceIds",
                    "lookalikeAudienceLabels",
                  )
                }
              />
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium">Locations</p>
          {failedBanner(
            regionsFailed,
            regionsError ?? "Locations failed to load.",
            () => setGeoReload((count) => count + 1),
          )}
          <SearchInput
            value={locationQuery}
            onChange={(event) => setLocationQuery(event.target.value)}
            placeholder="Search for a location"
            onClear={() => setLocationQuery("")}
            disabled={!advertiserId}
          />
          <div className="max-h-40 overflow-auto rounded-md border border-border">
            {!locationQuery.trim() ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                Search for a location
              </p>
            ) : filteredRegions.rows.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                No locations match that search.
              </p>
            ) : (
              filteredRegions.rows.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  disabled={
                    saving ||
                    tikTokLocationAlreadySelected(audiences.locationCodes, region.id)
                  }
                  onClick={() => {
                    if (tikTokLocationAlreadySelected(audiences.locationCodes, region.id)) {
                      return;
                    }
                    void persist({
                      locationCodes: [...audiences.locationCodes, region.id],
                      locationLabels: {
                        ...audiences.locationLabels,
                        [region.id]: region.name,
                      },
                    });
                  }}
                >
                  {region.name}
                  {region.countryCode ? ` · ${region.countryCode}` : ""}
                </button>
              ))
            )}
          </div>
          {locationQuery.trim() && filteredRegions.total > filteredRegions.rows.length && (
            <p className="text-xs text-muted-foreground">
              Showing {filteredRegions.rows.length} of {filteredRegions.total} — refine your search
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {audiences.locationCodes.map((code) => (
              <button
                key={code}
                type="button"
                className="rounded-full bg-muted px-3 py-1 text-xs"
                onClick={() => {
                  const labels = { ...audiences.locationLabels };
                  delete labels[code];
                  void persist({
                    locationCodes: audiences.locationCodes.filter((item) => item !== code),
                    locationLabels: labels,
                  });
                }}
              >
                {resolveTikTokLocationLabel(code, audiences.locationLabels, locationLookup)} ×
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Languages</p>
          {failedBanner(
            languagesFailed,
            languagesError ?? "Languages failed to load.",
            () => setGeoReload((count) => count + 1),
          )}
          <SearchInput
            value={languageQuery}
            onChange={(event) => setLanguageQuery(event.target.value)}
            placeholder="Search languages"
            onClear={() => setLanguageQuery("")}
            disabled={!advertiserId}
          />
          <div className="max-h-40 overflow-auto rounded-md border border-border">
            {filteredLanguages.map((language) => (
              <button
                key={language.id}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                disabled={saving}
                onClick={() =>
                  void persist({
                    languages: [...audiences.languages, language.id],
                    languageLabels: {
                      ...audiences.languageLabels,
                      [language.id]: language.name,
                    },
                  })
                }
              >
                {language.name}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {audiences.languages.map((code) => (
              <button
                key={code}
                type="button"
                className="rounded-full bg-muted px-3 py-1 text-xs"
                onClick={() => {
                  const labels = { ...audiences.languageLabels };
                  delete labels[code];
                  void persist({
                    languages: audiences.languages.filter((item) => item !== code),
                    languageLabels: labels,
                  });
                }}
              >
                {resolveTikTokLanguageLabel(code, audiences.languageLabels, languageOptions)} ×
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Input
            id="tiktok-age-min"
            label="Age min"
            inputMode="numeric"
            value={ageMin}
            onChange={(event) => setAgeMin(event.target.value)}
            onBlur={() => void persist({ ageMin: clampAge(ageMin, 18) })}
          />
        </div>
        <div className="space-y-1.5">
          <Input
            id="tiktok-age-max"
            label="Age max"
            inputMode="numeric"
            value={ageMax}
            onChange={(event) => setAgeMax(event.target.value)}
            onBlur={() => void persist({ ageMax: clampAge(ageMax, 65) })}
          />
          {ageNote && (
            <p className="text-xs text-warning-foreground">{ageNote}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <MultiToggle
            title="Gender"
            values={["MALE", "FEMALE", "UNKNOWN"]}
            labels={{
              MALE: resolveTikTokGenderLabel("MALE"),
              FEMALE: resolveTikTokGenderLabel("FEMALE"),
              UNKNOWN: resolveTikTokGenderLabel("UNKNOWN"),
            }}
            selected={audiences.genders}
            onChange={(genders) =>
              void persist({
                genders: genders as Array<"MALE" | "FEMALE" | "UNKNOWN">,
              })
            }
          />
          {genderNote && (
            <p className="text-xs text-warning-foreground">{genderNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupNameInput({
  groupId,
  name,
  onCommit,
}: {
  groupId: string;
  name: string;
  onCommit: (groupId: string, name: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => {
    setValue(name);
  }, [name]);
  return (
    <Input
      id={`tiktok-group-name-${groupId}`}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value !== name) onCommit(groupId, value);
      }}
      placeholder="Group name"
    />
  );
}

function failedBanner(failed: boolean, message: string, retry: () => void) {
  if (!failed) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      <p>{message}</p>
      <Button type="button" size="sm" variant="outline" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

function SkeletonTree() {
  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="h-5 animate-pulse rounded bg-muted"
          style={{ width: `${90 - index * 8}%` }}
        />
      ))}
    </div>
  );
}

interface CategoryRow extends TikTokAudienceCategory {
  depth: number;
}

function buildTree(rows: TikTokAudienceCategory[]): CategoryRow[] {
  const byParent = new Map<string | null, TikTokAudienceCategory[]>();
  for (const row of rows) {
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }
  const out: CategoryRow[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const row of byParent.get(parentId) ?? []) {
      out.push({ ...row, depth });
      walk(row.id, depth + 1);
    }
  }
  walk(null, 0);
  return out.length > 0 ? out : rows.map((row) => ({ ...row, depth: 0 }));
}

function CategoryList({
  rows,
  selectedIds,
  disabled,
  empty,
  onToggle,
}: {
  rows: CategoryRow[];
  selectedIds: string[];
  disabled: boolean;
  empty: string;
  onToggle: (row: CategoryRow) => void;
}) {
  const [query, setQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const visible = useMemo(
    () =>
      visibleTikTokCategoryRows(rows, {
        query,
        expandedIds,
      }),
    [rows, query, expandedIds],
  );
  const parentsWithChildren = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.parent_id) ids.add(row.parent_id);
    }
    return ids;
  }, [rows]);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      <SearchInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filter this list"
        onClear={() => setQuery("")}
      />
      <div className="max-h-72 overflow-auto rounded-md border border-border bg-background p-2">
        {visible.rows.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            No categories match that search.
          </p>
        ) : (
          visible.rows.map((row) => {
            const expanded = expandedIds.includes(row.id);
            return (
              <div
                key={row.id}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                style={{ paddingLeft: `${8 + row.depth * 18}px` }}
              >
                {parentsWithChildren.has(row.id) && !query.trim() ? (
                  <button
                    type="button"
                    className="w-4 text-xs text-muted-foreground"
                    aria-expanded={expanded}
                    onClick={() =>
                      setExpandedIds((current) =>
                        expanded
                          ? current.filter((id) => id !== row.id)
                          : [...current, row.id],
                      )
                    }
                  >
                    {expanded ? "−" : "+"}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(row.id)}
                    disabled={disabled}
                    onChange={() => onToggle(row)}
                  />
                  <span className="truncate">{row.label}</span>
                </label>
              </div>
            );
          })
        )}
      </div>
      {visible.capped && (
        <p className="text-xs text-muted-foreground">
          Showing {visible.rows.length} of {visible.total} — refine your search
        </p>
      )}
    </div>
  );
}

function GenrePresetRow({
  activePresetId,
  disabled,
  onSelect,
}: {
  activePresetId: string | null;
  disabled: boolean;
  onSelect: (preset: TikTokGenrePreset) => void;
}) {
  const active = TIKTOK_GENRE_PRESETS.find((preset) => preset.id === activePresetId);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Genre presets</span>
        {TIKTOK_GENRE_PRESETS.map((preset) => {
          const selected = preset.id === activePresetId;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(preset)}
              className={`rounded-full border px-3 py-1 text-xs ${
                selected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-foreground"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      {active && (
        <p className="text-xs text-muted-foreground">
          Seeds: {active.seeds.join(", ")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {TIKTOK_GENRE_PRESET_LIMITATION_NOTE}
      </p>
    </div>
  );
}

function RecommendList({
  rows,
  selectedIds,
  provenance,
  disabled,
  empty,
  onToggle,
}: {
  rows: TikTokAudienceRecommendItem[];
  selectedIds: string[];
  provenance?: Record<string, string[]>;
  disabled: boolean;
  empty: string;
  onToggle: (row: TikTokAudienceRecommendItem) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {rows.map((row) => {
        const selected = selectedIds.includes(row.id);
        const seeds = provenance?.[row.id] ?? [];
        return (
          <button
            key={row.id}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(row)}
            className={`rounded-full border px-3 py-1 text-xs ${
              selected ? "border-primary bg-primary/10 text-primary" : "border-border"
            }`}
          >
            {row.name}
            {row.audienceSize != null ? ` · ${row.audienceSize.toLocaleString()}` : ""}
            {seeds.length > 0 ? ` · from ${seeds.join(", ")}` : ""}
            {selected ? " ×" : " +"}
          </button>
        );
      })}
    </div>
  );
}

function AudienceList({
  rows,
  selectedIds,
  disabled,
  empty,
  onToggle,
}: {
  rows: TikTokAudienceListItem[];
  selectedIds: string[];
  disabled: boolean;
  empty: string;
  onToggle: (row: TikTokAudienceListItem) => void;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <label
          key={row.id}
          className="flex items-center justify-between rounded-md border border-border bg-background p-3 text-sm"
        >
          <span>
            <span className="block font-medium">{row.label}</span>
            {row.status && (
              <span className="text-xs text-muted-foreground">{row.status}</span>
            )}
          </span>
          <input
            type="checkbox"
            checked={selectedIds.includes(row.id)}
            disabled={disabled}
            onChange={() => onToggle(row)}
          />
        </label>
      ))}
    </div>
  );
}

function MultiToggle({
  title,
  values,
  labels = {},
  selected,
  onChange,
}: {
  title: string;
  values: string[];
  labels?: Record<string, string>;
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={`rounded-full border px-3 py-1 text-xs ${
                active ? "border-primary bg-primary/10 text-primary" : "border-border"
              }`}
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((item) => item !== value)
                    : [...selected, value],
                )
              }
            >
              {labels[value] ?? value}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function summaryChips(
  draft: TikTokCampaignDraft,
  locationLookup: TikTokLocationLookup,
  languages: TikTokLanguageOption[],
): string[] {
  const groupNames = draft.audiences.interestGroups
    .filter(isTikTokInterestGroupNonEmpty)
    .map((group) => group.name || "Untitled group");
  return [
    ...groupNames,
    ...Object.values(draft.audiences.interestCategoryLabels),
    ...Object.values(draft.audiences.behaviourCategoryLabels),
    ...Object.values(draft.audiences.customAudienceLabels),
    ...Object.values(draft.audiences.lookalikeAudienceLabels),
    ...draft.audiences.locationCodes.map((code) =>
      resolveTikTokLocationLabel(code, draft.audiences.locationLabels, locationLookup),
    ),
    ...draft.audiences.languages.map((code) =>
      resolveTikTokLanguageLabel(code, draft.audiences.languageLabels, languages),
    ),
    ...draft.audiences.genders.map(resolveTikTokGenderLabel),
  ];
}

function tabLabel(tab: CatalogTab): string {
  return tab[0].toUpperCase() + tab.slice(1);
}

function parseHashtagSeeds(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function limitHashtagSeeds(raw: string): string {
  const parts = raw.split(/([,\n])/);
  const kept: string[] = [];
  let keywords = 0;
  for (const part of parts) {
    if (part === "," || part === "\n") {
      if (keywords >= 10) continue;
      kept.push(part);
      continue;
    }
    if (!part.trim()) {
      kept.push(part);
      continue;
    }
    if (keywords >= 10) continue;
    kept.push(part);
    keywords += 1;
  }
  return kept.join("");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function clampAge(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(18, Math.min(65, parsed));
}
