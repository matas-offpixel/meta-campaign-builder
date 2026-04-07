"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Trash2, ChevronDown, ChevronUp, Sparkles, Wand2, Loader2, CheckSquare, Square, RefreshCw,
} from "lucide-react";
import type { InterestGroup, InterestSuggestion, AudienceSettings, MetaApiPage } from "@/lib/types";
import type {
  DiscoverCluster,
  DiscoverResponse,
  AudienceFingerprint,
  AgeRecommendation,
  CustomAudienceSignal,
  GenreDistribution,
} from "@/app/api/meta/interest-discover/route";
import {
  generateInterestGroupsFromAudiences,
  CLUSTER_LABELS,
  inferClusterFromName,
} from "@/lib/interest-suggestions";
import { getCachedUserPages } from "@/lib/hooks/useMeta";
import { readGenreCache } from "@/lib/genre-classification";

interface DiscoveredItem {
  interest: InterestSuggestion;
  selected: boolean;
}

interface InterestGroupsPanelProps {
  groups: InterestGroup[];
  audiences: AudienceSettings;
  onChange: (groups: InterestGroup[]) => void;
  /** Optional campaign name for richer interest suggestions */
  campaignName?: string;
}

function createEmptyInterestGroup(): InterestGroup {
  return {
    id: crypto.randomUUID(),
    name: "",
    interests: [],
    aiPrompt: "",
  };
}

function useInterestSearch(query: string) {
  const [results, setResults] = useState<InterestSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    const debounce = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      fetch(`/api/meta/interest-search?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          const json = (await res.json()) as {
            data?: Array<{ id: string; name: string; audienceSize?: number; path?: string[] }>;
            error?: string;
          };
          if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
          setResults(
            (json.data ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              audienceSize: item.audienceSize,
              path: item.path,
            })),
          );
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => setLoading(false));
    }, 300);

    return () => {
      clearTimeout(debounce);
      abortRef.current?.abort();
    };
  }, [query]);

  return { results, loading, error };
}

export function InterestGroupsPanel({ groups, audiences, onChange, campaignName }: InterestGroupsPanelProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    groups[0]?.id ?? null
  );
  const [searchByGroup, setSearchByGroup] = useState<Record<string, string>>({});
  const [activeSearchGroupId, setActiveSearchGroupId] = useState<string | null>(null);
  const [discoveringGroupId, setDiscoveringGroupId] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<Record<string, string | null>>({});
  const [discoveredSuggestions, setDiscoveredSuggestions] = useState<Record<string, DiscoveredItem[]>>({});
  const [discoveredUnmatched, setDiscoveredUnmatched] = useState<Record<string, string[]>>({});

  // Clustered discover-from-pages state (per group)
  const [discoverClusters, setDiscoverClusters] = useState<Record<string, DiscoverCluster[]>>({});
  const [discoverSearchTerms, setDiscoverSearchTerms] = useState<Record<string, string[]>>({});
  const [discoverSceneTags, setDiscoverSceneTags] = useState<Record<string, string[]>>({});
  const [discoveringFromPages, setDiscoveringFromPages] = useState<string | null>(null);
  const [discoverFromPagesError, setDiscoverFromPagesError] = useState<Record<string, string | null>>({});
  // Per-cluster: which interests are checked — keyed by groupId+clusterLabel+interestId
  const [clusterSelections, setClusterSelections] = useState<Record<string, Record<string, boolean>>>({});
  // Scene hints per group — free-text field that maps to scene tags for better discovery
  const [sceneHintsByGroup, setSceneHintsByGroup] = useState<Record<string, string>>({});
  // Audience fingerprint returned from the backend per group
  const [fingerprintByGroup, setFingerprintByGroup] = useState<Record<string, AudienceFingerprint>>({});

  const activeSearch = searchByGroup[activeSearchGroupId ?? ""] ?? "";
  const searchState = useInterestSearch(activeSearch);

  const hasPageAudiences = audiences.pageGroups.some((g) => g.pageIds.length > 0);

  // Resolve page context from cache + audiences
  const pageContext = useMemo((): MetaApiPage[] => {
    const cached = getCachedUserPages();
    const selectedIds = new Set(audiences.pageGroups.flatMap((g) => g.pageIds));
    if (selectedIds.size === 0) return cached.slice(0, 10);
    return cached.filter((p) => selectedIds.has(p.id));
  }, [audiences.pageGroups]);

  // Custom audience signals — group names as scene classifiers
  const customAudienceSignals = useMemo((): CustomAudienceSignal[] => {
    return (audiences.customAudienceGroups ?? [])
      .filter((g) => (g.audienceIds?.length ?? 0) > 0)
      .map((g) => ({ name: g.name }));
  }, [audiences.customAudienceGroups]);

  // Engagement types present (from pageGroups that have created engagement audiences)
  const engagementTypesPresent = useMemo((): string[] => {
    const types = new Set<string>();
    for (const g of audiences.pageGroups) {
      if (g.engagementAudiencesByType) {
        for (const t of Object.keys(g.engagementAudiencesByType)) {
          types.add(t);
        }
      }
    }
    return [...types];
  }, [audiences.pageGroups]);

  // Genre distribution: bucket → page count from selected pages' classifications
  const genreDistribution = useMemo((): GenreDistribution => {
    const cache = readGenreCache();
    const selectedIds = audiences.pageGroups.flatMap((g) => g.pageIds);
    const dist: GenreDistribution = {};
    for (const pageId of selectedIds) {
      const c = cache[pageId];
      if (!c) continue;
      for (const [bucket, w] of [
        [c.primaryBucket, 1.0],
        [c.secondaryBucket, 0.5],
        [c.tertiaryBucket, 0.25],
      ] as [string | undefined, number][]) {
        if (bucket) {
          dist[bucket] = (dist[bucket] ?? 0) + w;
        }
      }
    }
    // Round and filter out sub-threshold entries
    return Object.fromEntries(
      Object.entries(dist)
        .map(([k, v]) => [k, Math.max(1, Math.round(v))] as [string, number])
        .filter(([, v]) => v >= 1),
    );
  }, [audiences.pageGroups]);

  const addGroup = () => {
    const g = createEmptyInterestGroup();
    onChange([...groups, g]);
    setExpandedGroupId(g.id);
  };

  const removeGroup = (id: string) => {
    onChange(groups.filter((g) => g.id !== id));
  };

  const updateGroup = (id: string, patch: Partial<InterestGroup>) => {
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  };

  const addInterest = (groupId: string, interest: InterestSuggestion) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.interests.some((i) => i.id === interest.id)) return;
    updateGroup(groupId, { interests: [...group.interests, interest] });
  };

  const removeInterest = (groupId: string, interestId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    updateGroup(groupId, {
      interests: group.interests.filter((i) => i.id !== interestId),
    });
  };

  const handleAutoGenerate = () => {
    const generated = generateInterestGroupsFromAudiences(audiences);
    onChange(generated);
    if (generated.length > 0) setExpandedGroupId(generated[0].id);
  };

  const handleSearchChange = (groupId: string, value: string) => {
    setSearchByGroup((prev) => ({ ...prev, [groupId]: value }));
    setActiveSearchGroupId(groupId);
  };

  const handleSearchClear = (groupId: string) => {
    setSearchByGroup((prev) => ({ ...prev, [groupId]: "" }));
  };

  const getResults = (groupId: string) => {
    if (groupId !== activeSearchGroupId) return [];
    return searchState.results;
  };

  const handleDiscover = useCallback(async (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const prompt = (group.aiPrompt ?? "").trim();
    if (!prompt) {
      setDiscoveryError((prev) => ({ ...prev, [groupId]: "Enter a description first." }));
      return;
    }

    const cleaned = prompt
      .replace(/^(find|suggest|search|get|show|list|give me|i want|interests?\s+(?:for|about|related to|in))\s+/gi, "")
      .trim();

    const keywords = cleaned
      .split(/[,;\n]+|\s+and\s+/i)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2)
      .slice(0, 10);

    if (keywords.length === 0) {
      setDiscoveryError((prev) => ({ ...prev, [groupId]: "Could not extract search terms. Try comma-separated keywords like: electronic music, nightclub, festivals" }));
      return;
    }

    setDiscoveringGroupId(groupId);
    setDiscoveryError((prev) => ({ ...prev, [groupId]: null }));
    setDiscoveredSuggestions((prev) => ({ ...prev, [groupId]: [] }));
    setDiscoveredUnmatched((prev) => ({ ...prev, [groupId]: [] }));

    const existingIds = new Set(group.interests.map((i) => i.id));
    const found: InterestSuggestion[] = [];
    const unmatchedKws: string[] = [];

    try {
      for (const kw of keywords) {
        const res = await fetch(
          `/api/meta/interest-search?q=${encodeURIComponent(kw)}`,
        );
        const json = (await res.json()) as {
          data?: Array<{ id: string; name: string; audienceSize?: number; path?: string[] }>;
          error?: string;
        };
        let matched = false;
        if (json.data) {
          for (const item of json.data) {
            if (!existingIds.has(item.id) && !found.some((f) => f.id === item.id)) {
              found.push({ id: item.id, name: item.name, audienceSize: item.audienceSize, path: item.path });
              matched = true;
            }
          }
        }
        if (!matched) unmatchedKws.push(kw);
      }

      if (found.length > 0) {
        setDiscoveredSuggestions((prev) => ({
          ...prev,
          [groupId]: found.slice(0, 25).map((interest) => ({ interest, selected: false })),
        }));
      }
      setDiscoveredUnmatched((prev) => ({ ...prev, [groupId]: unmatchedKws }));

      if (found.length === 0) {
        setDiscoveryError((prev) => ({
          ...prev,
          [groupId]: `No Meta interests matched. Searched: ${keywords.join(", ")}. Try more specific terms.`,
        }));
      } else {
        setDiscoveryError((prev) => ({
          ...prev,
          [groupId]: unmatchedKws.length > 0
            ? `Found ${found.length} suggestions. No matches for: ${unmatchedKws.join(", ")}`
            : null,
        }));
      }
    } catch (err) {
      setDiscoveryError((prev) => ({
        ...prev,
        [groupId]: err instanceof Error ? err.message : "Discovery failed",
      }));
    } finally {
      setDiscoveringGroupId(null);
    }
  }, [groups]);

  const handleDiscoverFromPages = useCallback(async (groupId: string) => {
    if (discoveringFromPages === groupId) return;

    // Resolve cluster type: stored on group, or inferred from name
    const group = groups.find((g) => g.id === groupId);
    const effectiveClusterType =
      group?.clusterType ?? (group?.name ? (inferClusterFromName(group.name) ?? undefined) : undefined);

    setDiscoveringFromPages(groupId);
    setDiscoverFromPagesError((prev) => ({ ...prev, [groupId]: null }));
    setDiscoverClusters((prev) => ({ ...prev, [groupId]: [] }));
    setDiscoverSearchTerms((prev) => ({ ...prev, [groupId]: [] }));
    setDiscoverSceneTags((prev) => ({ ...prev, [groupId]: [] }));

    try {
      // Parse scene hints: comma-separated free text → array of tokens
      const rawHints = sceneHintsByGroup[groupId] ?? "";
      const sceneHints = rawHints
        .split(/[,;]+/)
        .map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"))
        .filter(Boolean);

      const res = await fetch("/api/meta/interest-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageContext: pageContext.map((p) => ({
            name: p.name,
            category: p.category,
            instagramUsername: p.instagramUsername,
          })),
          customAudienceSignals,
          engagementTypesPresent,
          genreDistribution,
          campaignName,
          ...(effectiveClusterType ? { clusterLabel: effectiveClusterType } : {}),
          ...(sceneHints.length > 0 ? { sceneHints } : {}),
        }),
      });

      const json = (await res.json()) as DiscoverResponse & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);

      setDiscoverClusters((prev) => ({ ...prev, [groupId]: json.clusters }));
      setDiscoverSearchTerms((prev) => ({ ...prev, [groupId]: json.searchTermsUsed }));
      setDiscoverSceneTags((prev) => ({ ...prev, [groupId]: json.detectedSceneTags ?? [] }));
      if (json.audienceFingerprint) {
        setFingerprintByGroup((prev) => ({ ...prev, [groupId]: json.audienceFingerprint }));
      }

      // Init selections to false for all
      const init: Record<string, boolean> = {};
      for (const cluster of json.clusters) {
        for (const i of cluster.interests) init[i.id] = false;
      }
      setClusterSelections((prev) => ({ ...prev, [groupId]: init }));

      if (json.clusters.length === 0) {
        setDiscoverFromPagesError((prev) => ({
          ...prev,
          [groupId]: "No matching interests found. Try loading more pages or adding a campaign name.",
        }));
      }
    } catch (err) {
      setDiscoverFromPagesError((prev) => ({
        ...prev,
        [groupId]: err instanceof Error ? err.message : "Discovery failed",
      }));
    } finally {
      setDiscoveringFromPages(null);
    }
  }, [discoveringFromPages, pageContext, customAudienceSignals, engagementTypesPresent, genreDistribution, campaignName]);

  const toggleClusterInterest = (groupId: string, interestId: string) => {
    setClusterSelections((prev) => ({
      ...prev,
      [groupId]: { ...(prev[groupId] ?? {}), [interestId]: !(prev[groupId]?.[interestId] ?? false) },
    }));
  };

  const selectAllInCluster = (groupId: string, cluster: DiscoverCluster) => {
    setClusterSelections((prev) => {
      const next = { ...(prev[groupId] ?? {}) };
      for (const i of cluster.interests) next[i.id] = true;
      return { ...prev, [groupId]: next };
    });
  };

  const addSelectedClusterInterests = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const selections = clusterSelections[groupId] ?? {};
    const clusters = discoverClusters[groupId] ?? [];
    const existingIds = new Set(group.interests.map((i) => i.id));
    const toAdd: InterestSuggestion[] = [];
    for (const cluster of clusters) {
      for (const item of cluster.interests) {
        if (selections[item.id] && !existingIds.has(item.id)) {
          toAdd.push({ id: item.id, name: item.name, audienceSize: item.audienceSize, path: item.path });
        }
      }
    }
    if (toAdd.length > 0) {
      updateGroup(groupId, { interests: [...group.interests, ...toAdd] });
    }
    // Clear clusters after adding (keep selections so user can re-open)
    setDiscoverClusters((prev) => ({ ...prev, [groupId]: [] }));
  };

  const selectedClusterCount = (groupId: string): number => {
    const selections = clusterSelections[groupId] ?? {};
    return Object.values(selections).filter(Boolean).length;
  };

  const toggleSuggestion = (groupId: string, interestId: string) => {
    setDiscoveredSuggestions((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((item) =>
        item.interest.id === interestId ? { ...item, selected: !item.selected } : item,
      ),
    }));
  };

  const selectAllSuggestions = (groupId: string) => {
    setDiscoveredSuggestions((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((item) => ({ ...item, selected: true })),
    }));
  };

  const clearAllSuggestions = (groupId: string) => {
    setDiscoveredSuggestions((prev) => ({
      ...prev,
      [groupId]: (prev[groupId] ?? []).map((item) => ({ ...item, selected: false })),
    }));
  };

  const addSelectedSuggestions = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const items = discoveredSuggestions[groupId] ?? [];
    const toAdd = items.filter((i) => i.selected).map((i) => i.interest);
    if (toAdd.length === 0) return;
    const existingIds = new Set(group.interests.map((i) => i.id));
    const deduped = toAdd.filter((i) => !existingIds.has(i.id));
    if (deduped.length > 0) {
      updateGroup(groupId, { interests: [...group.interests, ...deduped] });
    }
    setDiscoveredSuggestions((prev) => ({ ...prev, [groupId]: [] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Interest Groups ({groups.length})</h3>
          <p className="text-xs text-muted-foreground">
            Search Meta&apos;s interest database and group interests for targeted ad sets.
          </p>
          {(pageContext.length > 0 || customAudienceSignals.length > 0 || Object.keys(genreDistribution).length > 0) && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-primary">Discover from Pages</span> pooling{" "}
              {pageContext.length > 0 && <><span className="font-medium text-foreground">{pageContext.length}</span> pages</>}
              {customAudienceSignals.length > 0 && <> · <span className="font-medium text-foreground">{customAudienceSignals.length}</span> CA groups</>}
              {engagementTypesPresent.length > 0 && <> · <span className="font-medium text-success">{engagementTypesPresent.length}</span> engagement type{engagementTypesPresent.length !== 1 ? "s" : ""}</>}
              {Object.keys(genreDistribution).length > 0 && <> · <span className="font-medium text-foreground">{Object.keys(genreDistribution).length}</span> genre buckets</>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {hasPageAudiences && (
            <Button variant="outline" size="sm" onClick={handleAutoGenerate} title="Creates empty named groups — use Discover from Pages for real Meta interests">
              <Wand2 className="h-3.5 w-3.5" />
              Empty groups
            </Button>
          )}
          <Button size="sm" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      </div>

      {/* Auto-generate prompt when no groups exist */}
      {groups.length === 0 && (
        <Card className="py-8 text-center">
          {hasPageAudiences ? (
            <>
              <p className="text-sm text-muted-foreground">
                Auto-generate interest groups based on your page audiences.
              </p>
              <p className="mt-1 text-xs text-warning">
                Auto-generated suggestions use heuristic genre mapping — search Meta&apos;s interest database for real targeting IDs.
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" variant="outline" onClick={handleAutoGenerate}>
                  <Wand2 className="h-3.5 w-3.5" />
                  Auto-generate (heuristic)
                </Button>
                <Button size="sm" onClick={addGroup}>
                  <Plus className="h-3.5 w-3.5" />
                  Create manually
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Add an interest group to target users by interests.
              </p>
              <Button size="sm" className="mt-3" onClick={addGroup}>
                <Plus className="h-3.5 w-3.5" />
                New Group
              </Button>
            </>
          )}
        </Card>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroupId === group.id;
        const search = searchByGroup[group.id] || "";
        const results = getResults(group.id);
        const isSearching = activeSearchGroupId === group.id && searchState.loading;
        const searchError = activeSearchGroupId === group.id ? searchState.error : null;

        return (
          <Card key={group.id} className="p-0 overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedGroupId(isExpanded ? null : group.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedGroupId(isExpanded ? null : group.id); } }}
              className="flex w-full cursor-pointer items-center justify-between p-4 text-left hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">
                  {group.name || "Untitled Group"}
                </span>
                <Badge variant="primary">{group.interests.length} interests</Badge>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4">
                <Input
                  label="Group Name"
                  value={group.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    // Auto-set clusterType from name only if not already explicitly chosen
                    const inferred = inferClusterFromName(name);
                    updateGroup(group.id, {
                      name,
                      ...(inferred && !group.clusterType ? { clusterType: inferred } : {}),
                    });
                  }}
                  placeholder="e.g. Music Interests"
                />

                {/* Cluster type selector — controls which cluster AI discovery targets */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    AI Discovery Cluster
                    <span className="ml-1 font-normal">(controls which category Discover from Pages uses)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {CLUSTER_LABELS.map((label) => {
                      const active = (group.clusterType ?? inferClusterFromName(group.name)) === label;
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() =>
                            updateGroup(group.id, {
                              clusterType: group.clusterType === label ? undefined : label,
                            })
                          }
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                            active
                              ? "bg-primary text-white border-primary"
                              : "bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {(group.clusterType || inferClusterFromName(group.name)) && (
                      <button
                        type="button"
                        onClick={() => updateGroup(group.id, { clusterType: undefined })}
                        className="rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive"
                        title="Clear cluster type (discover all categories)"
                      >
                        ✕ All
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <label className="text-sm font-medium">Search Meta Interests</label>
                    {isSearching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  </div>
                  <SearchInput
                    value={search}
                    onChange={(e) => handleSearchChange(group.id, e.target.value)}
                    onClear={() => handleSearchClear(group.id)}
                    placeholder="Search Meta interest database (min 2 chars)…"
                  />
                  {searchError && (
                    <p className="mt-1 text-xs text-destructive">{searchError}</p>
                  )}
                  {search.length >= 2 && (
                    <div className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-border">
                      {results.length > 0 ? (
                        results.map((interest) => {
                          const selected = group.interests.some((i) => i.id === interest.id);
                          return (
                            <button
                              key={interest.id}
                              type="button"
                              disabled={selected}
                              onClick={() => addInterest(group.id, interest)}
                              className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 disabled:opacity-40"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="block truncate">{interest.name}</span>
                                {interest.path && interest.path.length > 0 && (
                                  <span className="block truncate text-[10px] text-muted-foreground">
                                    {interest.path.join(" › ")}
                                  </span>
                                )}
                              </div>
                              {interest.audienceSize != null && (
                                <span className="shrink-0 ml-2 text-xs text-muted-foreground">
                                  {interest.audienceSize >= 1_000_000
                                    ? `${(interest.audienceSize / 1_000_000).toFixed(1)}M`
                                    : interest.audienceSize >= 1_000
                                      ? `${Math.round(interest.audienceSize / 1_000)}K`
                                      : interest.audienceSize}
                                </span>
                              )}
                            </button>
                          );
                        })
                      ) : isSearching ? (
                        <div className="flex items-center justify-center gap-2 px-3 py-4">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">Searching Meta…</span>
                        </div>
                      ) : (
                        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                          No interests found for &ldquo;{search}&rdquo;
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Discover from Pages — AI-style fan interest discovery ─── */}
                {(() => {
                  const effectiveCluster = group.clusterType ?? inferClusterFromName(group.name);
                  return (
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary-light p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium text-primary">
                        <Sparkles className="h-4 w-4" />
                        Discover from Pages
                        {effectiveCluster && (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            {effectiveCluster}
                          </span>
                        )}
                      </div>
                      {effectiveCluster ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Generates <span className="font-medium">{effectiveCluster}</span> interests based on fans of your selected pages.
                          Irrelevant categories filtered out.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          Select a cluster above to get targeted suggestions, or discover across all categories.
                        </p>
                      )}
                      <p className="mt-0.5 text-[10px] text-muted-foreground/70 italic">
                        Suggestions are tailored to each cluster using selected page audience signals.
                      </p>
                      {pageContext.length > 0 ? (
                        <p className="mt-1 text-[11px] text-muted-foreground/80">
                          Seeded by: <span className="font-medium text-foreground">
                            {pageContext.slice(0, 3).map((p) => p.name).join(", ")}
                            {pageContext.length > 3 && ` +${pageContext.length - 3} more`}
                          </span>
                          {customAudienceSignals.length > 0 && (
                            <span className="ml-1 text-success">· {customAudienceSignals.length} CA</span>
                          )}
                          {engagementTypesPresent.length > 0 && (
                            <span className="ml-1 text-success">· {engagementTypesPresent.length} engagement type{engagementTypesPresent.length !== 1 ? "s" : ""}</span>
                          )}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-warning">
                          Load your Facebook pages in the Pages tab to improve suggestions.
                        </p>
                      )}
                    </div>
                    {(discoverClusters[group.id]?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => handleDiscoverFromPages(group.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary"
                        title="Regenerate suggestions"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* ── Audience Fingerprint card ──────────────────── */}
                  {fingerprintByGroup[group.id] && (() => {
                    const fp = fingerprintByGroup[group.id]!;
                    const specColor =
                      fp.specificity === "very_high" ? "text-success border-success/30 bg-success/5" :
                      fp.specificity === "high" ? "text-primary border-primary/30 bg-primary/5" :
                      fp.specificity === "moderate" ? "text-warning border-warning/30 bg-warning/5" :
                      "text-muted-foreground border-border bg-muted/30";
                    const specLabel =
                      fp.specificity === "very_high" ? "Very Specific" :
                      fp.specificity === "high" ? "High Confidence" :
                      fp.specificity === "moderate" ? "Moderate" : "Broad";
                    return (
                      <div className={`rounded-lg border px-3 py-2.5 space-y-2 text-xs ${specColor}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">Audience Fingerprint</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${specColor} border`}>{specLabel}</span>
                        </div>

                        {/* Source chips */}
                        <div className="flex flex-wrap gap-1">
                          {fp.sources.pages > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.pages} page{fp.sources.pages !== 1 ? "s" : ""}
                            </span>
                          )}
                          {fp.sources.customAudiences > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.customAudiences} CA group{fp.sources.customAudiences !== 1 ? "s" : ""}
                            </span>
                          )}
                          {fp.sources.engagementTypes > 0 && (
                            <span className="rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-medium text-success">
                              {fp.sources.engagementTypes} engagement type{fp.sources.engagementTypes !== 1 ? "s" : ""} ↑
                            </span>
                          )}
                          {fp.sources.genreGroups > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.genreGroups} genre bucket{fp.sources.genreGroups !== 1 ? "s" : ""}
                            </span>
                          )}
                          {fp.sources.hints > 0 && (
                            <span className="rounded bg-black/8 px-1.5 py-0.5 text-[10px]">
                              {fp.sources.hints} hint{fp.sources.hints !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>

                        {/* Dominant scenes */}
                        {fp.dominantScenes.length > 0 && (
                          <div>
                            <span className="text-[10px] opacity-70">Dominant signals:</span>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {fp.dominantScenes.slice(0, 6).map((s) => {
                                const maxW = fp.dominantScenes[0]?.weight ?? 1;
                                const rel = Math.round((s.weight / maxW) * 100);
                                return (
                                  <span
                                    key={s.tag}
                                    title={`weight: ${s.weight}`}
                                    className="flex items-center gap-1 rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-medium"
                                    style={{ opacity: 0.5 + rel / 200 }}
                                  >
                                    {s.tag.replace(/_/g, " ")}
                                    <span className="opacity-60 text-[9px]">{rel}%</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Confidence bar */}
                        <div>
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="text-[10px] opacity-70">Confidence</span>
                            <span className="text-[10px] font-bold">{fp.confidence}%</span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                            <div
                              className="h-full rounded-full bg-current transition-all"
                              style={{ width: `${fp.confidence}%` }}
                            />
                          </div>
                          <p className="mt-1 text-[10px] opacity-60">
                            {fp.specificity === "very_high"
                              ? "High confidence — interests will be highly specific, generic suggestions removed."
                              : fp.specificity === "high"
                                ? "Good signal depth — interests will be scene-specific with moderate filtering."
                                : fp.specificity === "moderate"
                                  ? "Moderate signal — some curated seeds included alongside entity matches."
                                  : "Low signal — broad curated suggestions shown. Add more pages or custom audiences to improve."}
                          </p>
                        </div>

                        {/* Age recommendation */}
                        {fp.ageRecommendation && fp.ageRecommendation.confidence !== "low" && (
                          <div className="rounded-md border border-current/20 bg-current/5 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] font-semibold">Suggested Age Range</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold border ${
                                fp.ageRecommendation.confidence === "high"
                                  ? "text-success border-success/30"
                                  : "text-warning border-warning/30"
                              }`}>
                                {fp.ageRecommendation.confidence}
                              </span>
                            </div>
                            <div className="mt-1 flex items-baseline gap-1.5">
                              <span className="text-lg font-bold leading-none">
                                {fp.ageRecommendation.minAge}–{fp.ageRecommendation.maxAge}
                              </span>
                              <span className="text-[10px] opacity-60">
                                peak ~{fp.ageRecommendation.peakAge}
                              </span>
                            </div>
                            <p className="mt-1 text-[9px] opacity-50 leading-tight">
                              {fp.ageRecommendation.rationale}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Scene hints — optional nudge for niche subgenre discovery */}
                  <div>
                    <Input
                      label="Scene hints (optional)"
                      value={sceneHintsByGroup[group.id] ?? ""}
                      onChange={(e) => setSceneHintsByGroup((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      placeholder="e.g. hard_techno, queer_underground, avant_garde_fashion"
                    />
                    <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                      Comma-separated scene tags to bias discovery. Helps when page names don&apos;t clearly signal the niche (e.g. <span className="font-mono">hard_techno</span>, <span className="font-mono">editorial_fashion</span>, <span className="font-mono">psy_trance</span>).
                    </p>
                  </div>

                  <Button
                    size="sm"
                    className="w-full"
                    disabled={discoveringFromPages === group.id}
                    onClick={() => handleDiscoverFromPages(group.id)}
                  >
                    {discoveringFromPages === group.id ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Discovering {effectiveCluster ?? "all categories"}…</>
                    ) : (discoverClusters[group.id]?.length ?? 0) > 0 ? (
                      <><RefreshCw className="h-3.5 w-3.5" /> Regenerate {effectiveCluster ? `(${effectiveCluster})` : ""}</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5" /> Discover {effectiveCluster ? `${effectiveCluster} Interests` : "Interests from Pages"}</>
                    )}
                  </Button>

                  {discoverFromPagesError[group.id] && (
                    <p className="text-xs text-destructive">{discoverFromPagesError[group.id]}</p>
                  )}

                  {/* Discovery results — single-cluster or multi-cluster */}
                  {(discoverClusters[group.id]?.length ?? 0) > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          {effectiveCluster
                            ? `${effectiveCluster} suggestions — select and add`
                            : "Suggested interests — select and add"}
                        </span>
                        {selectedClusterCount(group.id) > 0 && (
                          <Button
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => addSelectedClusterInterests(group.id)}
                          >
                            Add {selectedClusterCount(group.id)} selected
                          </Button>
                        )}
                      </div>

                      {discoverClusters[group.id]!.map((cluster) => {
                        // Single-cluster mode: suppress cluster header label (already shown above)
                        const isSingleCluster = (discoverClusters[group.id]?.length ?? 0) === 1;
                        return (
                          <div key={cluster.label} className="rounded-lg border border-border bg-white overflow-hidden">
                            {!isSingleCluster && (
                              <div className="flex items-start justify-between gap-2 px-3 py-1.5 bg-muted/30 border-b border-border">
                                <div className="min-w-0">
                                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {cluster.label}
                                  </span>
                                  {cluster.description && (
                                    <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">
                                      {cluster.description}
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => selectAllInCluster(group.id, cluster)}
                                  className="shrink-0 text-[10px] font-medium text-primary hover:underline"
                                >
                                  Select all
                                </button>
                              </div>
                            )}
                            {isSingleCluster && cluster.description && (
                              <div className="px-3 py-1.5 bg-muted/20 border-b border-border flex items-start justify-between">
                                <p className="text-[10px] text-muted-foreground/80 italic">
                                  {cluster.description}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => selectAllInCluster(group.id, cluster)}
                                  className="shrink-0 ml-2 text-[10px] font-medium text-primary hover:underline"
                                >
                                  Select all
                                </button>
                              </div>
                            )}
                            {cluster.interests.map((item) => {
                              const isSelected = clusterSelections[group.id]?.[item.id] ?? false;
                              const alreadyAdded = group.interests.some((i) => i.id === item.id);
                              const sizeBand = (item as { audienceSizeBand?: string }).audienceSizeBand;
                              const matchReason = (item as { matchReason?: string }).matchReason;
                              const sizeColor =
                                sizeBand?.startsWith("micro") ? "text-success" :
                                sizeBand?.startsWith("niche") ? "text-primary" :
                                sizeBand?.startsWith("targeted") ? "text-foreground" :
                                sizeBand?.startsWith("broad") || sizeBand?.startsWith("mega") ? "text-destructive/60" :
                                "text-muted-foreground";
                              return (
                                <label
                                  key={item.id}
                                  className={`flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50 ${alreadyAdded ? "opacity-50" : ""}`}
                                >
                                  <Checkbox
                                    checked={isSelected || alreadyAdded}
                                    onChange={() => !alreadyAdded && toggleClusterInterest(group.id, item.id)}
                                    disabled={alreadyAdded}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="block truncate text-sm">{item.name}</span>
                                    <div className="flex items-center gap-1.5">
                                      {item.path && item.path.length > 0 && (
                                        <span className="truncate text-[10px] text-muted-foreground">
                                          {item.path.join(" › ")}
                                        </span>
                                      )}
                                      {matchReason && (
                                        <span className="shrink-0 text-[9px] text-muted-foreground/50" title={`Match: ${matchReason}`}>
                                          {matchReason.split(",")[0]}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                                    <span className={`text-[10px] ${sizeColor}`}>
                                      {(item.audienceSize ?? 0) >= 1_000_000
                                        ? `${((item.audienceSize ?? 0) / 1_000_000).toFixed(1)}M`
                                        : (item.audienceSize ?? 0) >= 1_000
                                          ? `${Math.round((item.audienceSize ?? 0) / 1_000)}K`
                                          : (item.audienceSize ?? 0) > 0 ? String(item.audienceSize) : ""}
                                    </span>
                                    {sizeBand && !sizeBand.startsWith("unknown") && (
                                      <span className={`text-[9px] ${sizeColor} opacity-60`}>{sizeBand}</span>
                                    )}
                                  </div>
                                  {alreadyAdded && (
                                    <Badge variant="outline" className="shrink-0 text-[9px]">Added</Badge>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        );
                      })}

                      {(discoverSceneTags[group.id]?.length ?? 0) > 0 && !fingerprintByGroup[group.id] && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          <span className="text-[10px] text-muted-foreground/60 self-center">Detected scenes:</span>
                          {discoverSceneTags[group.id]!.map((tag) => (
                            <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                              {tag.replace(/_/g, " ")}
                            </span>
                          ))}
                        </div>
                      )}
                      {(discoverSearchTerms[group.id]?.length ?? 0) > 0 && (
                        <p className="text-[10px] text-muted-foreground/60">
                          Searched {discoverSearchTerms[group.id]!.length} entity terms
                        </p>
                      )}
                    </div>
                  )}

                  {/* Manual keyword fallback */}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none">
                      Manual keyword search
                    </summary>
                    <div className="mt-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        Enter comma-separated keywords to search Meta&apos;s interest database directly.
                      </p>
                      <textarea
                        value={group.aiPrompt || ""}
                        onChange={(e) => updateGroup(group.id, { aiPrompt: e.target.value })}
                        placeholder="e.g. electronic music, nightclub, Resident Advisor, Boiler Room"
                        className="w-full resize-none rounded-lg border border-primary/20 bg-white p-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                        rows={2}
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        variant="outline"
                        disabled={discoveringGroupId === group.id || !(group.aiPrompt ?? "").trim()}
                        onClick={() => handleDiscover(group.id)}
                      >
                        {discoveringGroupId === group.id ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Meta…</>
                        ) : (
                          <><Sparkles className="h-3.5 w-3.5" /> Search by keywords</>
                        )}
                      </Button>
                      {discoveryError[group.id] && (
                        <p className="text-xs text-destructive">{discoveryError[group.id]}</p>
                      )}
                      {(discoveredSuggestions[group.id]?.length ?? 0) > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground">
                              Results ({discoveredSuggestions[group.id]!.length})
                            </span>
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => selectAllSuggestions(group.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10">
                                <CheckSquare className="h-3 w-3" /> All
                              </button>
                              <button type="button" onClick={() => clearAllSuggestions(group.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted">
                                <Square className="h-3 w-3" /> None
                              </button>
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-white">
                            {discoveredSuggestions[group.id]!.map((item) => (
                              <label key={item.interest.id} className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50">
                                <Checkbox checked={item.selected} onChange={() => toggleSuggestion(group.id, item.interest.id)} />
                                <span className="flex-1 truncate text-sm">{item.interest.name}</span>
                                {item.interest.audienceSize != null && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {item.interest.audienceSize >= 1_000_000 ? `${(item.interest.audienceSize / 1_000_000).toFixed(1)}M` : item.interest.audienceSize >= 1_000 ? `${Math.round(item.interest.audienceSize / 1_000)}K` : item.interest.audienceSize}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                          <Button size="sm" className="w-full" disabled={!discoveredSuggestions[group.id]!.some((i) => i.selected)} onClick={() => addSelectedSuggestions(group.id)}>
                            Add {discoveredSuggestions[group.id]!.filter((i) => i.selected).length} selected
                          </Button>
                        </div>
                      )}
                      {(discoveredUnmatched[group.id]?.length ?? 0) > 0 && (
                        <p className="text-[10px] text-muted-foreground">No match for: {discoveredUnmatched[group.id]!.join(", ")}</p>
                      )}
                    </div>
                  </details>
                </div>
                  );
                })()}

                {group.interests.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">
                      Selected Interests ({group.interests.length})
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {group.interests.map((interest) => (
                        <Badge
                          key={interest.id}
                          variant="primary"
                          onRemove={() => removeInterest(group.id, interest.id)}
                        >
                          {interest.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
