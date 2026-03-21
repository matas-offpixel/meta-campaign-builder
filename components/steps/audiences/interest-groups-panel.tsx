"use client";

import { useState, useMemo } from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ChevronDown, ChevronUp, Sparkles, Wand2 } from "lucide-react";
import type { InterestGroup, InterestSuggestion, AudienceSettings } from "@/lib/types";
import { MOCK_INTERESTS } from "@/lib/mock-data";
import { generateInterestGroupsFromAudiences } from "@/lib/interest-suggestions";

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

export function InterestGroupsPanel({ groups, audiences, onChange }: InterestGroupsPanelProps) {
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(
    groups[0]?.id ?? null
  );
  const [searchByGroup, setSearchByGroup] = useState<Record<string, string>>({});

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

  const getFilteredInterests = (groupId: string) => {
    const search = searchByGroup[groupId] || "";
    if (!search) return MOCK_INTERESTS.slice(0, 10);
    return MOCK_INTERESTS.filter((i) =>
      i.name.toLowerCase().includes(search.toLowerCase())
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Interest Groups ({groups.length})</h3>
          <p className="text-xs text-muted-foreground">
            Group interests together for targeted ad sets.
          </p>
        </div>
        <div className="flex gap-2">
          {hasPageAudiences && (
            <Button variant="outline" size="sm" onClick={handleAutoGenerate}>
              <Wand2 className="h-3.5 w-3.5" />
              Auto-generate
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
              <div className="mt-3 flex justify-center gap-2">
                <Button size="sm" variant="outline" onClick={handleAutoGenerate}>
                  <Wand2 className="h-3.5 w-3.5" />
                  Auto-generate from audiences
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
        const filteredInterests = getFilteredInterests(group.id);

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
                  <label className="mb-1.5 block text-sm font-medium">Search Interests</label>
                  <SearchInput
                    value={search}
                    onChange={(e) =>
                      setSearchByGroup((prev) => ({ ...prev, [group.id]: e.target.value }))
                    }
                    onClear={() =>
                      setSearchByGroup((prev) => ({ ...prev, [group.id]: "" }))
                    }
                    placeholder="Search or paste comma-separated interests..."
                  />
                  {search && (
                    <div className="mt-1.5 max-h-36 overflow-y-auto rounded-lg border border-border">
                      {filteredInterests.map((interest) => {
                        const selected = group.interests.some((i) => i.id === interest.id);
                        return (
                          <button
                            key={interest.id}
                            type="button"
                            disabled={selected}
                            onClick={() => addInterest(group.id, interest)}
                            className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/50 disabled:opacity-40"
                          >
                            <span>{interest.name}</span>
                            {interest.audienceSize && (
                              <span className="text-xs text-muted-foreground">
                                {(interest.audienceSize / 1_000_000).toFixed(1)}M
                              </span>
                            )}
                          </button>
                        );
                      })}
                      {filteredInterests.length === 0 && (
                        <p className="px-3 py-3 text-center text-xs text-muted-foreground">
                          No interests found.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* AI Discovery placeholder */}
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary-light p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <Sparkles className="h-4 w-4" />
                    AI Interest Discovery
                  </div>
                  <textarea
                    value={group.aiPrompt || ""}
                    onChange={(e) => updateGroup(group.id, { aiPrompt: e.target.value })}
                    placeholder="Describe the type of interests you want. AI will generate ~200 keywords and match them against Meta's interest database."
                    className="mt-2 w-full resize-none rounded-lg border border-primary/20 bg-white p-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    rows={2}
                  />
                  <Button size="sm" className="mt-2 w-full">
                    <Sparkles className="h-3.5 w-3.5" />
                    Discover Interests
                  </Button>
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
