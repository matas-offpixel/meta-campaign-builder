"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedAudienceSelection } from "@/lib/types";
import { MOCK_SAVED_AUDIENCES } from "@/lib/mock-data";

interface SavedAudiencesPanelProps {
  selection: SavedAudienceSelection;
  onChange: (selection: SavedAudienceSelection) => void;
}

function formatSize(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function SavedAudiencesPanel({ selection, onChange }: SavedAudiencesPanelProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return MOCK_SAVED_AUDIENCES;
    return MOCK_SAVED_AUDIENCES.filter((a) =>
      a.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [search]);

  const toggle = (id: string) => {
    const ids = selection.audienceIds.includes(id)
      ? selection.audienceIds.filter((a) => a !== id)
      : [...selection.audienceIds, id];
    onChange({ audienceIds: ids });
  };

  const selectedAudiences = MOCK_SAVED_AUDIENCES.filter((a) =>
    selection.audienceIds.includes(a.id)
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Saved Audiences</h3>
        <p className="text-xs text-muted-foreground">
          Select saved audiences from your ad account. Each generates a separate ad set.
        </p>
      </div>

      <SearchInput
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClear={() => setSearch("")}
        placeholder="Search saved audiences..."
      />

      <Card className="p-0 overflow-hidden">
        <div className="max-h-72 overflow-y-auto">
          {filtered.map((audience) => (
            <label
              key={audience.id}
              className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-muted/50"
            >
              <Checkbox
                checked={selection.audienceIds.includes(audience.id)}
                onChange={() => toggle(audience.id)}
              />
              <span className="flex-1 text-sm">{audience.name}</span>
              {audience.approximateSize && (
                <span className="text-xs font-medium text-muted-foreground">
                  {formatSize(audience.approximateSize)}
                </span>
              )}
            </label>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              No saved audiences found.
            </p>
          )}
        </div>
      </Card>

      {selectedAudiences.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Selected ({selectedAudiences.length})
          </label>
          <div className="space-y-1.5">
            {selectedAudiences.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-border bg-primary-light px-3 py-2"
              >
                <span className="text-sm font-medium">{a.name}</span>
                <div className="flex items-center gap-2">
                  {a.approximateSize && (
                    <span className="text-xs text-muted-foreground">
                      {formatSize(a.approximateSize)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(a.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
