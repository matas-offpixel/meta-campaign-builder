"use client";

/**
 * AdSetPicker — used by Step 1 when the user chooses the "Add to existing
 * ad set" mode. Lists live Meta ad sets under the campaign chosen via the
 * CampaignPicker.
 *
 * UI contract:
 *   - card grid (multi-select)
 *   - debounced server-side name search (Meta `filtering` param)
 *   - status filter: Active / Paused / All
 *   - relevance filter: "Relevant" (active + paused, recent first, limited)
 *     vs. "All" — implicit when the status pill is "All"
 *   - server-side cursor pagination via "Load more"
 *   - explicit idle / loading / success / empty / error render branches
 *
 * Toggling a compatible card calls `onToggle(adSet)`. The parent
 * (campaign-setup.tsx) is responsible for writing/removing the snapshot on
 * the draft and decides the final selected set.
 */

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  RefreshCw,
  Search as SearchIcon,
  Users,
  Target as TargetIcon,
  Calendar,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import type { MetaAdSetSummary } from "@/lib/types";
import { useFetchAdSets } from "@/lib/hooks/useMeta";

type StatusFilter = "active" | "paused" | "all";

interface AdSetPickerProps {
  /** Raw Meta campaign id, e.g. "23849562890000". */
  campaignId: string | undefined;
  /** Currently-selected ad set ids. Multiple allowed. */
  selectedIds: string[];
  /** Toggle an ad set on/off. Parent updates the draft snapshot. */
  onToggle: (adSet: MetaAdSetSummary) => void;
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
  selectedIds,
  onToggle,
}: AdSetPickerProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Map the picker's status filter onto the API's `filter` param. Searching
  // implicitly broadens to "all" so a query for an archived ad set still
  // returns results.
  const apiFilter = useMemo<"relevant" | "active" | "paused" | "all">(() => {
    if (debouncedSearch && statusFilter === "active") return "all";
    return statusFilter;
  }, [statusFilter, debouncedSearch]);

  const adSets = useFetchAdSets(campaignId, {
    enabled: Boolean(campaignId),
    filter: apiFilter,
    search: debouncedSearch || undefined,
  });

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

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
          {(
            [
              { id: "active", label: "Active" },
              { id: "paused", label: "Paused" },
              { id: "all", label: "All" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setStatusFilter(opt.id)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
                ${statusFilter === opt.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"}`}
            >
              {opt.label}
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

      <p className="text-[11px] text-muted-foreground">
        {statusFilter === "active"
          ? "Showing ACTIVE ad sets, most recent first. Switch to Paused or All if you don't see the one you want."
          : statusFilter === "paused"
            ? "Showing PAUSED ad sets, most recent first."
            : "Showing all ad sets in this campaign — including archived/deleted."}
      </p>

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
          ) : statusFilter === "active" ? (
            <>
              <p>No active ad sets in this campaign.</p>
              <p className="mt-1 text-xs">
                Switch to <span className="font-medium">Paused</span> or{" "}
                <span className="font-medium">All</span>.
              </p>
            </>
          ) : statusFilter === "paused" ? (
            <p>No paused ad sets in this campaign.</p>
          ) : (
            <p>No ad sets found in this campaign.</p>
          )}
        </div>
      )}

      {adSets.status === "success" && (
        <>
          {selectedIds.length > 0 && (
            <div className="flex items-center justify-between rounded-md bg-primary-light/30 px-3 py-2 text-xs">
              <span className="text-foreground">
                <span className="font-medium">{selectedIds.length}</span>{" "}
                ad set{selectedIds.length !== 1 ? "s" : ""} selected
              </span>
              <span className="text-muted-foreground">
                Ads will be added to all selected ad sets.
              </span>
            </div>
          )}

          <div className="grid max-h-[460px] gap-2 overflow-y-auto sm:grid-cols-2">
            {adSets.data.map((a) => {
              const isSelected = selectedSet.has(a.id);
              const disabled = !a.compatible;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => !disabled && onToggle(a)}
                  disabled={disabled}
                  title={disabled ? a.incompatibleReason : undefined}
                  className={`group relative flex w-full flex-col rounded-lg border px-3 py-3 text-left transition-colors
                    ${isSelected
                      ? "border-primary bg-primary-light"
                      : "border-border hover:bg-muted/50"}
                    ${disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected
                          ? "border-primary bg-primary text-background"
                          : "border-border-strong bg-background"
                      }`}
                      aria-hidden
                    >
                      {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {a.name || "(unnamed ad set)"}
                        </span>
                        <StatusPill status={a.effectiveStatus ?? a.status} />
                      </div>

                      <div className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
                        {a.optimizationGoal && (
                          <div className="flex items-start gap-1.5">
                            <TargetIcon className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="capitalize">
                              {prettyMetaEnum(a.optimizationGoal)}
                              {a.billingEvent &&
                                ` · ${prettyMetaEnum(a.billingEvent)}`}
                            </span>
                          </div>
                        )}
                        {a.targetingSummary && (
                          <div className="flex items-start gap-1.5">
                            <Users className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="line-clamp-2">
                              {a.targetingSummary}
                            </span>
                          </div>
                        )}
                        {a.updatedTime && (
                          <div className="flex items-start gap-1.5">
                            <Calendar className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>
                              Updated{" "}
                              {new Date(a.updatedTime).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>

                      <code className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {a.id}
                      </code>

                      {disabled && a.incompatibleReason && (
                        <p className="mt-1 text-[11px] text-warning">
                          {a.incompatibleReason}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

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
