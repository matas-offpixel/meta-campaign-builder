"use client";

import { useState, useMemo } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Checkbox } from "@/components/ui/checkbox";
import type { SavedAudienceSelection } from "@/lib/types";
import { useFetchSavedAudiences } from "@/lib/hooks/useMeta";

interface SavedAudiencesPanelProps {
  selection: SavedAudienceSelection;
  onChange: (selection: SavedAudienceSelection) => void;
  /** Meta ad account ID — required to load real saved audiences */
  adAccountId?: string;
}

function formatSize(n?: number): string {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function SavedAudiencesPanel({
  selection,
  onChange,
  adAccountId,
}: SavedAudiencesPanelProps) {
  const [search, setSearch] = useState("");
  const audiences = useFetchSavedAudiences(adAccountId);

  const filtered = useMemo(() => {
    if (!audiences.loaded) return [];
    if (!search) return audiences.data;
    return audiences.data.filter((a) =>
      a.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [audiences.loaded, audiences.data, search]);

  const toggle = (id: string) => {
    const ids = selection.audienceIds.includes(id)
      ? selection.audienceIds.filter((a) => a !== id)
      : [...selection.audienceIds, id];
    onChange({ audienceIds: ids });
  };

  const selectedAudiences = audiences.data.filter((a) =>
    selection.audienceIds.includes(a.id),
  );

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Saved Audiences</h3>
        <p className="text-xs text-muted-foreground">
          Select saved audiences from your ad account. Each generates a separate ad set.
        </p>
      </div>

      {/* ── Load control ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong bg-muted/30 px-4 py-3">
        <div className="text-sm text-muted-foreground">
          {!adAccountId ? (
            "Select an ad account first to load saved audiences."
          ) : audiences.loaded ? (
            <span>
              <span className="font-medium text-foreground">
                {audiences.data.length}
              </span>{" "}
              saved audience{audiences.data.length !== 1 ? "s" : ""} loaded
            </span>
          ) : (
            <span className="text-muted-foreground">0 loaded</span>
          )}
        </div>
        {adAccountId && (
          <Button
            variant="outline"
            size="sm"
            onClick={audiences.fetch}
            disabled={audiences.loading || !adAccountId}
            className="shrink-0 gap-1.5"
          >
            {audiences.loading ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading…
              </>
            ) : audiences.loaded ? (
              <>
                <RefreshCw className="h-3 w-3" />
                Refresh
              </>
            ) : (
              "Load Saved Audiences"
            )}
          </Button>
        )}
      </div>

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {audiences.error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Failed to load saved audiences
            </p>
            <p className="text-xs text-muted-foreground">{audiences.error}</p>
          </div>
        </div>
      )}

      {/* ── List (only shown after a successful load) ─────────────────────── */}
      {audiences.loaded && (
        <>
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Search saved audiences…"
          />

          <Card className="overflow-hidden p-0">
            <div className="max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  {search
                    ? "No saved audiences match your search."
                    : "No saved audiences found in this ad account."}
                </p>
              ) : (
                filtered.map((audience) => (
                  <label
                    key={audience.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selection.audienceIds.includes(audience.id)}
                      onChange={() => toggle(audience.id)}
                    />
                    <span className="flex-1 truncate text-sm">{audience.name}</span>
                    {audience.approximateCount !== undefined && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatSize(audience.approximateCount)}
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
          </Card>
        </>
      )}

      {/* ── Selected chips ─────────────────────────────────────────────────── */}
      {selectedAudiences.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium">
            Selected ({selectedAudiences.length})
          </p>
          <div className="space-y-1.5">
            {selectedAudiences.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="text-sm font-medium">{a.name}</span>
                <div className="flex items-center gap-2">
                  {a.approximateCount !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      {formatSize(a.approximateCount)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(a.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${a.name}`}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stale IDs in draft that are no longer in the loaded list */}
      {audiences.loaded &&
        selection.audienceIds.filter(
          (id) => !audiences.data.some((a) => a.id === id),
        ).length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-muted-foreground">
              Some selected audience IDs were not found in this ad account and
              will be ignored at launch.
            </p>
          </div>
        )}
    </div>
  );
}
