"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ChevronDown, ChevronUp, Sparkles, Wand2, Loader2, CheckSquare, Square } from "lucide-react";
import type { InterestGroup, InterestSuggestion, AudienceSettings } from "@/lib/types";
import { generateInterestGroupsFromAudiences } from "@/lib/interest-suggestions";

interface DiscoveredItem {
  interest: InterestSuggestion;
  selected: boolean;
}

interface InterestGroupsPanelProps {
  groups: InterestGroup[];
  audiences: AudienceSettings;
  onChange: (groups: InterestGroup[]) => void;
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

export function InterestGroupsPanel({ groups, audiences, onChange }: InterestGroupsPanelProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    groups[0]?.id ?? null
  );
  const [searchByGroup, setSearchByGroup] = useState<Record<string, string>>({});
  const [activeSearchGroupId, setActiveSearchGroupId] = useState<string | null>(null);
  const [discoveringGroupId, setDiscoveringGroupId] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<Record<string, string | null>>({});
  const [discoveredSuggestions, setDiscoveredSuggestions] = useState<Record<string, DiscoveredItem[]>>({});
  const [discoveredUnmatched, setDiscoveredUnmatched] = useState<Record<string, string[]>>({});

  const activeSearch = searchByGroup[activeSearchGroupId ?? ""] ?? "";
  const searchState = useInterestSearch(activeSearch);

  const hasPageAudiences = audiences.pageGroups.some((g) => g.pageIds.length > 0);

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
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Interest Groups ({groups.length})</h3>
          <p className="text-xs text-muted-foreground">
            Search Meta&apos;s interest database and group interests for targeted ad sets.
          </p>
        </div>
        <div className="flex gap-2">
          {hasPageAudiences && (
            <Button variant="outline" size="sm" onClick={handleAutoGenerate} title="Heuristic suggestions based on page genre — not real Meta audience insights">
              <Wand2 className="h-3.5 w-3.5" />
              Auto-generate
              <span className="ml-1 rounded bg-warning/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-warning">
                heuristic
              </span>
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
                  onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                  placeholder="e.g. Music Interests"
                />

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

                {/* AI-assisted interest discovery via Meta search */}
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary-light p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <Sparkles className="h-4 w-4" />
                    Discover Interests
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Enter keywords separated by commas. Results appear as suggestions — select the ones you want to add.
                  </p>
                  <textarea
                    value={group.aiPrompt || ""}
                    onChange={(e) => updateGroup(group.id, { aiPrompt: e.target.value })}
                    placeholder="e.g. electronic music, music festivals, nightclub, Resident Advisor, Boiler Room"
                    className="mt-2 w-full resize-none rounded-lg border border-primary/20 bg-white p-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    rows={2}
                  />
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    disabled={discoveringGroupId === group.id || !(group.aiPrompt ?? "").trim()}
                    onClick={() => handleDiscover(group.id)}
                  >
                    {discoveringGroupId === group.id ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Meta…</>
                    ) : (
                      <><Sparkles className="h-3.5 w-3.5" /> Discover Interests</>
                    )}
                  </Button>
                  {discoveryError[group.id] && (
                    <p className="mt-1.5 text-xs text-destructive">{discoveryError[group.id]}</p>
                  )}

                  {/* Suggestion results — user must explicitly select */}
                  {(discoveredSuggestions[group.id]?.length ?? 0) > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">
                          Suggested Meta Interests ({discoveredSuggestions[group.id]!.length})
                        </span>
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => selectAllSuggestions(group.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10">
                            <CheckSquare className="h-3 w-3" /> Select all
                          </button>
                          <button type="button" onClick={() => clearAllSuggestions(group.id)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted">
                            <Square className="h-3 w-3" /> Clear
                          </button>
                        </div>
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-white">
                        {discoveredSuggestions[group.id]!.map((item) => (
                          <label
                            key={item.interest.id}
                            className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50"
                          >
                            <Checkbox
                              checked={item.selected}
                              onChange={() => toggleSuggestion(group.id, item.interest.id)}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm">{item.interest.name}</span>
                              {item.interest.path && item.interest.path.length > 0 && (
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {item.interest.path.join(" › ")}
                                </span>
                              )}
                            </div>
                            {item.interest.audienceSize != null && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {item.interest.audienceSize >= 1_000_000
                                  ? `${(item.interest.audienceSize / 1_000_000).toFixed(1)}M`
                                  : item.interest.audienceSize >= 1_000
                                    ? `${Math.round(item.interest.audienceSize / 1_000)}K`
                                    : item.interest.audienceSize}
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!discoveredSuggestions[group.id]!.some((i) => i.selected)}
                        onClick={() => addSelectedSuggestions(group.id)}
                      >
                        Add {discoveredSuggestions[group.id]!.filter((i) => i.selected).length} selected interests
                      </Button>
                    </div>
                  )}

                  {(discoveredUnmatched[group.id]?.length ?? 0) > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      No Meta match for: {discoveredUnmatched[group.id]!.join(", ")}
                    </p>
                  )}
                </div>

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
