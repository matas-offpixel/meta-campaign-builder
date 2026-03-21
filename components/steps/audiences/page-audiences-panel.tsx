"use client";

import { useState, useMemo, useCallback } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ChevronDown, ChevronUp, XCircle } from "lucide-react";
import type { PageAudienceGroup, EngagementType, LookalikeRange } from "@/lib/types";
import { MOCK_PAGES, MOCK_CUSTOM_AUDIENCES, GENRES } from "@/lib/mock-data";

interface PageAudiencesPanelProps {
  groups: PageAudienceGroup[];
  onChange: (groups: PageAudienceGroup[]) => void;
}

const ENGAGEMENT_OPTIONS: { value: EngagementType; label: string }[] = [
  { value: "fb_likes", label: "FB Likes" },
  { value: "fb_engagement_365d", label: "FB Engagement 365d" },
  { value: "ig_followers", label: "IG Followers" },
  { value: "ig_engagement_365d", label: "IG Engagement 365d" },
];

const LOOKALIKE_RANGES: LookalikeRange[] = ["0-1%", "1-2%", "2-3%"];

function createEmptyGroup(): PageAudienceGroup {
  return {
    id: crypto.randomUUID(),
    name: "",
    pageIds: [],
    engagementTypes: ["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"],
    lookalike: false,
    lookalikeRange: "0-1%",
    customAudienceIds: [],
  };
}

export function PageAudiencesPanel({ groups, onChange }: PageAudiencesPanelProps) {
  const [search, setSearch] = useState("");
  const [activeGenre, setActiveGenre] = useState<string | null>(null);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const [caSearch, setCaSearch] = useState("");
  const [confirmClearGroupId, setConfirmClearGroupId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const CONFIRM_THRESHOLD = 5;

  const totalSelectedPages = useMemo(
    () => groups.reduce((sum, g) => sum + g.pageIds.length, 0),
    [groups]
  );

  const clearGroupPages = (groupId: string) => {
    updateGroup(groupId, { pageIds: [] });
    setConfirmClearGroupId(null);
  };

  const handleClearGroupPages = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.pageIds.length >= CONFIRM_THRESHOLD) {
      setConfirmClearGroupId(groupId);
    } else {
      clearGroupPages(groupId);
    }
  };

  const clearAllPages = () => {
    onChange(groups.map((g) => ({ ...g, pageIds: [] })));
    setConfirmClearAll(false);
  };

  const handleClearAll = () => {
    if (totalSelectedPages >= CONFIRM_THRESHOLD) {
      setConfirmClearAll(true);
    } else {
      clearAllPages();
    }
  };

  const filteredPages = useMemo(() => {
    return MOCK_PAGES.filter((p) => {
      const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
      const matchesGenre = !activeGenre || p.genre === activeGenre || p.subgenre === activeGenre;
      return matchesSearch && matchesGenre;
    });
  }, [search, activeGenre]);

  const filteredCA = useMemo(() => {
    if (!caSearch) return MOCK_CUSTOM_AUDIENCES.slice(0, 8);
    return MOCK_CUSTOM_AUDIENCES.filter((a) =>
      a.name.toLowerCase().includes(caSearch.toLowerCase())
    );
  }, [caSearch]);

  const addGroup = () => {
    const g = createEmptyGroup();
    onChange([...groups, g]);
    setExpandedGroupId(g.id);
  };

  const removeGroup = (id: string) => onChange(groups.filter((g) => g.id !== id));

  const updateGroup = useCallback(
    (id: string, patch: Partial<PageAudienceGroup>) =>
      onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g))),
    [groups, onChange]
  );

  const togglePage = (groupId: string, pageId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const pageIds = group.pageIds.includes(pageId)
      ? group.pageIds.filter((id) => id !== pageId)
      : [...group.pageIds, pageId];
    updateGroup(groupId, { pageIds });
  };

  const handleGenreClick = (genre: string, groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    if (activeGenre === genre) {
      // Deactivate filter
      setActiveGenre(null);
      return;
    }

    // Activate genre AND bulk-select all pages in that genre
    setActiveGenre(genre);
    const genrePageIds = MOCK_PAGES
      .filter((p) => p.genre === genre || p.subgenre === genre)
      .map((p) => p.id);
    const merged = Array.from(new Set([...group.pageIds, ...genrePageIds]));
    updateGroup(groupId, { pageIds: merged });
  };

  const toggleEngagement = (groupId: string, et: EngagementType) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const types = group.engagementTypes.includes(et)
      ? group.engagementTypes.filter((t) => t !== et)
      : [...group.engagementTypes, et];
    updateGroup(groupId, { engagementTypes: types });
  };

  const toggleCustomAudience = (groupId: string, caId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const ids = group.customAudienceIds.includes(caId)
      ? group.customAudienceIds.filter((id) => id !== caId)
      : [...group.customAudienceIds, caId];
    updateGroup(groupId, { customAudienceIds: ids });
  };

  const genreCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    MOCK_PAGES.forEach((p) => {
      if (p.genre) counts[p.genre] = (counts[p.genre] || 0) + 1;
    });
    return counts;
  }, []);

  // Count how many pages from a genre are already selected in a group
  const genreSelectedCounts = (group: PageAudienceGroup) => {
    const counts: Record<string, number> = {};
    group.pageIds.forEach((pid) => {
      const page = MOCK_PAGES.find((p) => p.id === pid);
      if (page?.genre) counts[page.genre] = (counts[page.genre] || 0) + 1;
      if (page?.subgenre) counts[page.subgenre] = (counts[page.subgenre] || 0) + 1;
    });
    return counts;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Page Groups</h3>
          <p className="text-xs text-muted-foreground">{MOCK_PAGES.length} pages available</p>
        </div>
        <div className="flex items-center gap-2">
          {totalSelectedPages > 0 && !confirmClearAll && (
            <Button variant="ghost" size="sm" onClick={handleClearAll}>
              <XCircle className="h-3.5 w-3.5" />
              Clear All ({totalSelectedPages})
            </Button>
          )}
          {confirmClearAll && (
            <div className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1">
              <span className="text-xs text-destructive">Clear {totalSelectedPages} pages?</span>
              <button
                type="button"
                onClick={clearAllPages}
                className="text-xs font-medium text-destructive hover:underline"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearAll(false)}
                className="text-xs text-muted-foreground hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
          <Button size="sm" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      </div>

      {groups.length === 0 && (
        <Card className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Create a page group to start adding targeting audiences.</p>
          <Button size="sm" className="mt-3" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </Card>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroupId === group.id;
        const selectedByGenre = genreSelectedCounts(group);
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
                <span className="text-sm font-semibold">{group.name || "Untitled Group"}</span>
                <Badge variant="primary">{group.pageIds.length} pages</Badge>
                {group.customAudienceIds.length > 0 && (
                  <Badge variant="warning">{group.customAudienceIds.length} custom</Badge>
                )}
                {group.lookalike && <Badge variant="success">{group.lookalikeRange} LAL</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeGroup(group.id); }}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-border p-4 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <Input
                      label="Group Name"
                      value={group.name}
                      onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                      placeholder="e.g. Lineup Fans"
                    />
                  </div>
                  {group.pageIds.length > 0 && confirmClearGroupId !== group.id && (
                    <button
                      type="button"
                      onClick={() => handleClearGroupPages(group.id)}
                      className="mt-5 shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      <XCircle className="h-3 w-3" />
                      Clear ({group.pageIds.length})
                    </button>
                  )}
                  {confirmClearGroupId === group.id && (
                    <div className="mt-5 shrink-0 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1">
                      <span className="text-[10px] text-destructive">Clear {group.pageIds.length}?</span>
                      <button
                        type="button"
                        onClick={() => clearGroupPages(group.id)}
                        className="text-[10px] font-medium text-destructive hover:underline"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearGroupId(null)}
                        className="text-[10px] text-muted-foreground hover:underline"
                      >
                        No
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">Engagement Types</label>
                  <div className="flex flex-wrap gap-2">
                    {ENGAGEMENT_OPTIONS.map((eo) => (
                      <button
                        key={eo.value}
                        type="button"
                        onClick={() => toggleEngagement(group.id, eo.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
                          ${group.engagementTypes.includes(eo.value) ? "border-success bg-success/15 text-success" : "border-border-strong text-muted-foreground hover:border-foreground/20"}`}
                      >
                        {eo.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => updateGroup(group.id, { lookalike: !group.lookalike })}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors
                      ${group.lookalike ? "border-foreground bg-foreground text-background" : "border-border-strong text-muted-foreground hover:border-foreground/20"}`}
                  >
                    Lookalike
                  </button>
                  {group.lookalike && (
                    <div className="flex gap-1">
                      {LOOKALIKE_RANGES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => updateGroup(group.id, { lookalikeRange: r })}
                          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors
                            ${group.lookalikeRange === r ? "border-primary bg-primary-light text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Genre chips — click to bulk-select */}
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <label className="text-sm font-medium">Select Pages</label>
                    <span className="text-[11px] text-muted-foreground">Click a genre to auto-select all pages</span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {GENRES.filter((g) => genreCounts[g]).map((genre) => {
                      const total = genreCounts[genre];
                      const selected = selectedByGenre[genre] || 0;
                      const allSelected = selected >= total;
                      return (
                        <button
                          key={genre}
                          type="button"
                          onClick={() => handleGenreClick(genre, group.id)}
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors
                            ${activeGenre === genre ? "bg-foreground text-background" : ""}
                            ${allSelected && activeGenre !== genre ? "bg-success/15 text-success ring-1 ring-success/30" : ""}
                            ${!allSelected && activeGenre !== genre ? "bg-muted text-muted-foreground hover:text-foreground" : ""}`}
                        >
                          {genre} {selected > 0 ? `(${selected}/${total})` : `(${total})`}
                        </button>
                      );
                    })}
                  </div>
                  <SearchInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onClear={() => setSearch("")}
                    placeholder="Search pages..."
                  />
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
                    {filteredPages.map((page) => (
                      <label key={page.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50">
                        <Checkbox checked={group.pageIds.includes(page.id)} onChange={() => togglePage(group.id, page.id)} />
                        <span className="flex-1 text-sm">{page.name}</span>
                        {page.genre && <Badge variant="outline" className="text-[10px]">{page.genre}</Badge>}
                      </label>
                    ))}
                    {filteredPages.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground">No pages found.</p>}
                  </div>
                </div>

                {group.pageIds.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Selected Pages ({group.pageIds.length})</label>
                    <div className="flex flex-wrap gap-1.5">
                      {group.pageIds.map((pid) => {
                        const page = MOCK_PAGES.find((p) => p.id === pid);
                        return <Badge key={pid} variant="primary" onRemove={() => togglePage(group.id, pid)}>{page?.name ?? pid}</Badge>;
                      })}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-dashed border-border-strong bg-muted/30 p-4 space-y-3">
                  <label className="block text-sm font-medium">
                    Load Custom Audiences <span className="font-normal text-muted-foreground">(optional — expand with hot/warm data)</span>
                  </label>
                  <SearchInput
                    value={caSearch}
                    onChange={(e) => setCaSearch(e.target.value)}
                    onClear={() => setCaSearch("")}
                    placeholder="Search custom audiences..."
                  />
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-border bg-card">
                    {filteredCA.map((ca) => (
                      <label key={ca.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/50">
                        <Checkbox checked={group.customAudienceIds.includes(ca.id)} onChange={() => toggleCustomAudience(group.id, ca.id)} />
                        <span className="flex-1 text-sm">{ca.name}</span>
                        <Badge variant="outline" className="text-[10px]">{ca.type}</Badge>
                      </label>
                    ))}
                  </div>
                  {group.customAudienceIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {group.customAudienceIds.map((caId) => {
                        const ca = MOCK_CUSTOM_AUDIENCES.find((a) => a.id === caId);
                        return <Badge key={caId} variant="warning" onRemove={() => toggleCustomAudience(group.id, caId)}>{ca?.name ?? caId}</Badge>;
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
