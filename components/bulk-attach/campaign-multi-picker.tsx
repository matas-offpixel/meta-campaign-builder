"use client";

/**
 * CampaignMultiPicker — multi-select version of CampaignPicker for the
 * bulk-attach-creatives flow.
 *
 * Key differences from the single-select CampaignPicker in
 * components/steps/campaign-picker.tsx:
 *   - Checkbox left of each row instead of a single-select highlight
 *   - Selection state is a Set<campaignId> managed by the PARENT so it
 *     survives "Load more" pagination across re-renders
 *   - Incompatible campaigns render greyed-out checkboxes (cannot be toggled)
 *   - Sticky footer bar (rendered by the parent page, not this component)
 *
 * The existing CampaignPicker is NOT modified — this is an additive surface.
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw, Search as SearchIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { isCampaignRuntimeActive } from "@/lib/bulk-attach/campaign-active";
import type { MetaCampaignSummary } from "@/lib/types";
import { useFetchCampaigns } from "@/lib/hooks/useMeta";

interface CampaignMultiPickerProps {
  adAccountId: string | undefined;
  /** Parent-managed selection — survives Load More pagination. */
  selectedIds: Set<string>;
  onToggle: (campaign: MetaCampaignSummary) => void;
  /**
   * When supplied, campaigns whose names contain any of these strings
   * (case-insensitive) are auto-selected once on first load. Respects
   * the BULK_ATTACH_CAP passed to onPreselectLoad.
   */
  preselectCodes?: string[];
  /** Called once with the full list of campaigns that matched preselectCodes. */
  onPreselectLoad?: (campaigns: MetaCampaignSummary[]) => void;
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
  return <Badge variant="outline">{status || "—"}</Badge>;
}

function objectiveLabel(raw: string): string {
  if (!raw) return "—";
  return raw.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase();
}

export function CampaignMultiPicker({
  adAccountId,
  selectedIds,
  onToggle,
  preselectCodes,
  onPreselectLoad,
}: CampaignMultiPickerProps) {
  const [filter, setFilter] = useState<"relevant" | "all">("relevant");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const preselectAppliedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const campaigns = useFetchCampaigns(adAccountId, {
    enabled: Boolean(adAccountId),
    filter,
    search: debouncedSearch || undefined,
  });

  // Auto-select campaigns whose names contain any preselect code — fires once on first load.
  // Use a ref (not state) to track the guard so we don't cause a second render from the effect.
  useEffect(() => {
    if (
      preselectAppliedRef.current ||
      !preselectCodes ||
      preselectCodes.length === 0 ||
      campaigns.status !== "success" ||
      !onPreselectLoad
    ) return;

    preselectAppliedRef.current = true;
    const needles = preselectCodes.map((c) => c.toLowerCase());
    const matched = (campaigns.data ?? []).filter(
      (c) => c.compatible && needles.some((n) => c.name.toLowerCase().includes(n)),
    );
    const activeMatched = matched.filter(isCampaignRuntimeActive);
    onPreselectLoad(activeMatched);
  }, [campaigns.status, campaigns.data, preselectCodes, onPreselectLoad]);

  if (!adAccountId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        Select an ad account to load campaigns.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onClear={() => setSearchInput("")}
            placeholder="Search campaigns…"
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
          onClick={() => campaigns.refetch()}
          title="Reload"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {filter === "relevant" && (
        <p className="text-[11px] text-muted-foreground">
          Showing active &amp; paused campaigns, most recent first. Switch to{" "}
          <span className="font-medium">All</span> to include archived campaigns.
        </p>
      )}

      {/* Body */}
      {campaigns.status === "loading" && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
          <Spinner /> Loading campaigns…
        </div>
      )}

      {campaigns.status === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Couldn&rsquo;t load campaigns.</p>
              {campaigns.error && (
                <p className="mt-0.5 text-xs opacity-80">{campaigns.error}</p>
              )}
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => campaigns.refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        </div>
      )}

      {campaigns.status === "empty" && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {debouncedSearch ? (
            <p>No campaigns match &ldquo;{debouncedSearch}&rdquo;.</p>
          ) : (
            <p>No campaigns found in this ad account.</p>
          )}
        </div>
      )}

      {campaigns.status === "success" && (
        <>
          {preselectCodes && preselectCodes.length > 0 && (
            <div className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-200">
              Auto-selecting campaigns matching: <strong>{preselectCodes.join(", ")}</strong>
            </div>
          )}
          <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
            {campaigns.data.map((c) => {
              const checked = selectedIds.has(c.id);
              const disabled = !c.compatible;
              return (
                <li key={c.id}>
                  <label
                    title={disabled ? c.incompatibleReason : undefined}
                    className={`flex w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors
                      ${checked && !disabled
                        ? "border-primary bg-primary-light"
                        : "border-border hover:bg-muted/50"}
                      ${disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => !disabled && onToggle(c)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {c.name || "(unnamed campaign)"}
                        </span>
                        <StatusPill status={c.effectiveStatus ?? c.status} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="capitalize">
                          {objectiveLabel(c.objective)}
                        </span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          {c.id}
                        </code>
                        {c.updatedTime && (
                          <span>
                            Updated {new Date(c.updatedTime).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      {disabled && c.incompatibleReason && (
                        <p className="mt-1 text-[11px] text-warning">
                          {c.incompatibleReason}
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>

          {campaigns.hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => campaigns.loadMore()}
                disabled={campaigns.loadingMore}
              >
                {campaigns.loadingMore ? (
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
