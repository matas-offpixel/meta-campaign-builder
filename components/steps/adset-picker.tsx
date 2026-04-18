"use client";

/**
 * AdSetPicker — used by Step 1 when the user chooses the "Add to existing
 * ad set" mode. Lists live Meta ad sets under the campaign chosen via the
 * CampaignPicker, with:
 *
 *   - default "Relevant" filter (active + paused, recent first, limited)
 *   - optional "Show all ad sets" toggle
 *   - debounced server-side name search (Meta `filtering` param)
 *   - server-side cursor pagination via "Load more"
 *   - explicit idle / loading / success / empty / error render branches
 *
 * Selecting a compatible row calls `onSelect(adSet)` — the parent
 * (campaign-setup.tsx) is responsible for writing the snapshot onto the
 * draft.
 */

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  RefreshCw,
  Search as SearchIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import type { MetaAdSetSummary } from "@/lib/types";
import { useFetchAdSets } from "@/lib/hooks/useMeta";

interface AdSetPickerProps {
  /** Raw Meta campaign id, e.g. "23849562890000". */
  campaignId: string | undefined;
  /** Currently-selected ad set id, if any. */
  selectedId?: string;
  onSelect: (adSet: MetaAdSetSummary) => void;
}

function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-60 ${className}`}
      aria-label="Loading"
    />
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "ACTIVE") return <Badge variant="success">Active</Badge>;
  if (s === "PAUSED") return <Badge variant="default">Paused</Badge>;
  if (s === "ARCHIVED") return <Badge variant="outline">Archived</Badge>;
  if (s === "DELETED") return <Badge variant="destructive">Deleted</Badge>;
  return <Badge variant="outline">{status || "—"}</Badge>;
}

function prettyMetaEnum(raw?: string): string {
  if (!raw) return "—";
  return raw.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase();
}

export function AdSetPicker({
  campaignId,
  selectedId,
  onSelect,
}: AdSetPickerProps) {
  const [filter, setFilter] = useState<"relevant" | "all">("relevant");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const adSets = useFetchAdSets(campaignId, {
    enabled: Boolean(campaignId),
    filter,
    search: debouncedSearch || undefined,
  });

  if (!campaignId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        Pick a campaign above to load its ad sets.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onClear={() => setSearchInput("")}
            placeholder="Search by ad set name..."
          />
        </div>
        <div className="flex rounded-md border border-border-strong p-0.5">
          {(["relevant", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
                ${filter === f
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"}`}
            >
              {f === "relevant" ? "Relevant" : "All"}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => adSets.refetch()}
          title="Reload"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {filter === "relevant" && (
        <p className="text-[11px] text-muted-foreground">
          Showing active &amp; paused ad sets, most recent first. Switch to{" "}
          <span className="font-medium">All</span> to include archived /
          completed ad sets.
        </p>
      )}

      {adSets.status === "loading" && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
          <Spinner /> Loading ad sets…
        </div>
      )}

      {adSets.status === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&rsquo;t load ad sets.</p>
              {adSets.error && (
                <p className="mt-0.5 text-xs opacity-80">{adSets.error}</p>
              )}
              <p className="mt-1 text-[11px] opacity-70">
                If this is a permission error, the connected token may be
                missing <code>ads_read</code> for this campaign.
              </p>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => adSets.refetch()}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        </div>
      )}

      {adSets.status === "empty" && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {debouncedSearch ? (
            <>
              <p>No ad sets match &ldquo;{debouncedSearch}&rdquo;.</p>
              <p className="mt-1 text-xs">
                Try a different search, or switch to{" "}
                <span className="font-medium">All</span>.
              </p>
            </>
          ) : filter === "relevant" ? (
            <>
              <p>No active or paused ad sets found in this campaign.</p>
              <p className="mt-1 text-xs">
                Switch to <span className="font-medium">All</span> to include
                archived ad sets.
              </p>
            </>
          ) : (
            <p>No ad sets found in this campaign.</p>
          )}
        </div>
      )}

      {adSets.status === "success" && (
        <>
          <ul className="max-h-96 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
            {adSets.data.map((a) => {
              const isSelected = a.id === selectedId;
              const disabled = !a.compatible;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => !disabled && onSelect(a)}
                    disabled={disabled}
                    title={disabled ? a.incompatibleReason : undefined}
                    className={`group w-full rounded-md border px-3 py-2.5 text-left transition-colors
                      ${isSelected
                        ? "border-primary bg-primary-light"
                        : "border-border hover:bg-muted/50"}
                      ${disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {a.name || "(unnamed ad set)"}
                          </span>
                          <StatusPill status={a.effectiveStatus ?? a.status} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          {a.optimizationGoal && (
                            <span className="capitalize">
                              Optimisation: {prettyMetaEnum(a.optimizationGoal)}
                            </span>
                          )}
                          {a.billingEvent && (
                            <span className="capitalize">
                              Billing: {prettyMetaEnum(a.billingEvent)}
                            </span>
                          )}
                          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {a.id}
                          </code>
                          {a.updatedTime && (
                            <span>
                              Updated {new Date(a.updatedTime).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {disabled && a.incompatibleReason && (
                          <p className="mt-1 text-[11px] text-warning">
                            {a.incompatibleReason}
                          </p>
                        )}
                      </div>
                      {isSelected && (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-background">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {adSets.error && (
            <p className="text-xs text-destructive">{adSets.error}</p>
          )}

          {adSets.hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => adSets.loadMore()}
                disabled={adSets.loadingMore}
              >
                {adSets.loadingMore ? (
                  <>
                    <Spinner className="mr-1 h-3 w-3" /> Loading more…
                  </>
                ) : (
                  <>
                    <SearchIcon className="mr-1 h-3 w-3" /> Load more
                  </>
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
