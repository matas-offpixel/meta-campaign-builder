"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ChevronDown, ChevronUp, XCircle, Loader2, Download } from "lucide-react";
import type { CustomAudienceGroup, CustomAudience } from "@/lib/types";
import { useFetchCustomAudiences } from "@/lib/hooks/useMeta";

interface CustomAudiencesPanelProps {
  groups: CustomAudienceGroup[];
  onChange: (groups: CustomAudienceGroup[]) => void;
  adAccountId?: string;
}

const TYPE_LABELS: Record<CustomAudience["type"], string> = {
  purchaser: "Purchaser",
  registration: "Registration",
  engagement: "Engagement",
  lookalike: "LAL",
  pixel: "Pixel",
  other: "Other",
};

const TYPE_BADGE_VARIANT: Record<CustomAudience["type"], "success" | "primary" | "warning" | "default" | "destructive" | "outline"> = {
  purchaser: "success",
  registration: "primary",
  engagement: "warning",
  lookalike: "default",
  pixel: "destructive",
  other: "outline",
};

const CONFIRM_THRESHOLD = 5;

function createEmptyGroup(): CustomAudienceGroup {
  return {
    id: crypto.randomUUID(),
    name: "",
    audienceIds: [],
  };
}

export function CustomAudiencesPanel({ groups, onChange, adAccountId }: CustomAudiencesPanelProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(groups[0]?.id ?? null);
  const [searchByGroup, setSearchByGroup] = useState<Record<string, string>>({});
  const [typeFilterByGroup, setTypeFilterByGroup] = useState<Record<string, CustomAudience["type"] | null>>({});
  const [confirmClearGroupId, setConfirmClearGroupId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const caState = useFetchCustomAudiences(adAccountId);

  const totalSelected = useMemo(
    () => groups.reduce((sum, g) => sum + g.audienceIds.length, 0),
    [groups]
  );

  const addGroup = () => {
    const g = createEmptyGroup();
    onChange([...groups, g]);
    setExpandedGroupId(g.id);
  };

  const removeGroup = (id: string) => onChange(groups.filter((g) => g.id !== id));

  const updateGroup = (id: string, patch: Partial<CustomAudienceGroup>) =>
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const toggleAudience = (groupId: string, audienceId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const ids = group.audienceIds.includes(audienceId)
      ? group.audienceIds.filter((id) => id !== audienceId)
      : [...group.audienceIds, audienceId];
    updateGroup(groupId, { audienceIds: ids });
  };

  const clearGroup = (groupId: string) => {
    updateGroup(groupId, { audienceIds: [] });
    setConfirmClearGroupId(null);
  };

  const handleClearGroup = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.audienceIds.length >= CONFIRM_THRESHOLD) {
      setConfirmClearGroupId(groupId);
    } else {
      clearGroup(groupId);
    }
  };

  const clearAllSelections = () => {
    onChange(groups.map((g) => ({ ...g, audienceIds: [] })));
    setConfirmClearAll(false);
  };

  const handleClearAll = () => {
    if (totalSelected >= CONFIRM_THRESHOLD) {
      setConfirmClearAll(true);
    } else {
      clearAllSelections();
    }
  };

  const getFiltered = (groupId: string) => {
    const search = searchByGroup[groupId] || "";
    const typeFilter = typeFilterByGroup[groupId] || null;
    return caState.data.filter((a) => {
      const matchesSearch = !search || a.name.toLowerCase().includes(search.toLowerCase());
      const matchesType = !typeFilter || a.type === typeFilter;
      return matchesSearch && matchesType;
    });
  };

  const types = useMemo(() => Array.from(new Set(caState.data.map((a) => a.type))), [caState.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Custom Audience Groups</h3>
          <p className="text-xs text-muted-foreground">
            Load real custom audiences from your ad account, then organise them into groups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {totalSelected > 0 && !confirmClearAll && (
            <Button variant="ghost" size="sm" onClick={handleClearAll}>
              <XCircle className="h-3.5 w-3.5" />
              Clear All ({totalSelected})
            </Button>
          )}
          {confirmClearAll && (
            <div className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1">
              <span className="text-xs text-destructive">Clear {totalSelected} audiences?</span>
              <button type="button" onClick={clearAllSelections} className="text-xs font-medium text-destructive hover:underline">Confirm</button>
              <button type="button" onClick={() => setConfirmClearAll(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
            </div>
          )}
          <Button size="sm" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </div>
      </div>

      {/* Load Custom Audiences action */}
      <Card className="flex items-center justify-between px-4 py-3">
        <div>
          <span className="text-sm font-medium">
            {caState.loaded
              ? `${caState.data.length} custom audience${caState.data.length !== 1 ? "s" : ""} loaded`
              : "0 loaded"}
          </span>
          {!adAccountId && (
            <p className="text-xs text-muted-foreground">Select an ad account first.</p>
          )}
          {caState.error && (
            <p className="text-xs text-destructive">{caState.error}</p>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={caState.fetch}
          disabled={caState.loading || !adAccountId}
        >
          {caState.loading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</>
          ) : (
            <><Download className="h-3.5 w-3.5" /> Load Custom Audiences</>
          )}
        </Button>
      </Card>

      {groups.length === 0 && (
        <Card className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Create a group to start selecting custom audiences.</p>
          <Button size="sm" className="mt-3" onClick={addGroup}>
            <Plus className="h-3.5 w-3.5" />
            New Group
          </Button>
        </Card>
      )}

      {groups.map((group) => {
        const isExpanded = expandedGroupId === group.id;
        const search = searchByGroup[group.id] || "";
        const typeFilter = typeFilterByGroup[group.id] || null;
        const filtered = getFiltered(group.id);
        const showGroupConfirm = confirmClearGroupId === group.id;

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
                <Badge variant="primary">{group.audienceIds.length} audiences</Badge>
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
                      placeholder="e.g. Hot Data, Purchasers, Lookalike Seeds"
                    />
                  </div>
                  {group.audienceIds.length > 0 && !showGroupConfirm && (
                    <button
                      type="button"
                      onClick={() => handleClearGroup(group.id)}
                      className="mt-5 shrink-0 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-colors"
                    >
                      <XCircle className="h-3 w-3" />
                      Clear ({group.audienceIds.length})
                    </button>
                  )}
                  {showGroupConfirm && (
                    <div className="mt-5 shrink-0 flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1">
                      <span className="text-[10px] text-destructive">Clear {group.audienceIds.length}?</span>
                      <button type="button" onClick={() => clearGroup(group.id)} className="text-[10px] font-medium text-destructive hover:underline">Yes</button>
                      <button type="button" onClick={() => setConfirmClearGroupId(null)} className="text-[10px] text-muted-foreground hover:underline">No</button>
                    </div>
                  )}
                </div>

                {!caState.loaded ? (
                  <p className="text-xs text-muted-foreground">Load custom audiences above to select them here.</p>
                ) : caState.data.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No custom audiences found in this ad account.</p>
                ) : (
                  <>
                    <SearchInput
                      value={search}
                      onChange={(e) => setSearchByGroup((prev) => ({ ...prev, [group.id]: e.target.value }))}
                      onClear={() => setSearchByGroup((prev) => ({ ...prev, [group.id]: "" }))}
                      placeholder="Search audiences..."
                    />

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTypeFilterByGroup((prev) => ({ ...prev, [group.id]: null }))}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors
                          ${!typeFilter ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                      >
                        All
                      </button>
                      {types.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setTypeFilterByGroup((prev) => ({
                            ...prev,
                            [group.id]: prev[group.id] === type ? null : type,
                          }))}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors
                            ${typeFilter === type ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                        >
                          {TYPE_LABELS[type]}
                        </button>
                      ))}
                    </div>

                    {filtered.length > 0 && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            const ids = new Set(group.audienceIds);
                            for (const a of filtered) ids.add(a.id);
                            updateGroup(group.id, { audienceIds: Array.from(ids) });
                          }}
                          className="text-[11px] font-medium text-primary hover:underline"
                        >
                          Select all ({filtered.length})
                        </button>
                        <span className="text-muted-foreground text-[10px]">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            const removeSet = new Set(filtered.map((a) => a.id));
                            updateGroup(group.id, {
                              audienceIds: group.audienceIds.filter((id) => !removeSet.has(id)),
                            });
                          }}
                          className="text-[11px] font-medium text-muted-foreground hover:text-destructive hover:underline"
                        >
                          Clear visible
                        </button>
                      </div>
                    )}

                    <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                      {filtered.map((audience) => (
                        <label
                          key={audience.id}
                          className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={group.audienceIds.includes(audience.id)}
                            onChange={() => toggleAudience(group.id, audience.id)}
                          />
                          <span className="flex-1 text-sm">{audience.name}</span>
                          <Badge variant={TYPE_BADGE_VARIANT[audience.type]}>
                            {TYPE_LABELS[audience.type]}
                          </Badge>
                        </label>
                      ))}
                      {filtered.length === 0 && (
                        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No audiences found.</p>
                      )}
                    </div>
                  </>
                )}

                {group.audienceIds.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Selected ({group.audienceIds.length})</label>
                    <div className="flex flex-wrap gap-1.5">
                      {group.audienceIds.map((id) => {
                        const a = caState.data.find((ca) => ca.id === id);
                        return (
                          <Badge key={id} variant="primary" onRemove={() => toggleAudience(group.id, id)}>
                            {a?.name ?? id}
                          </Badge>
                        );
                      })}
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
