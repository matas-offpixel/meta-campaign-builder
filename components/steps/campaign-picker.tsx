"use client";

/**
 * CampaignPicker — used by Step 1 when the user chooses the
 * "Add to existing campaign" mode. Lists live Meta campaigns under the
 * currently selected ad account, with:
 *
 *   - default "Relevant" filter (active + paused, recent first, limited)
 *   - optional "Show all campaigns" toggle
 *   - debounced server-side name search (Meta `filtering` param)
 *   - server-side cursor pagination via "Load more"
 *   - explicit idle / loading / success / empty / error render branches
 *
 * Selecting a compatible row calls `onSelect(campaign)` — the parent
 * (campaign-setup.tsx) is responsible for writing the snapshot onto the
 * draft and mirroring the live campaign's objective into
 * `settings.objective` so the rest of the wizard keeps working.
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
import type { MetaCampaignSummary } from "@/lib/types";
import { useFetchCampaigns } from "@/lib/hooks/useMeta";

interface CampaignPickerProps {
  adAccountId: string | undefined;
  /** Currently-selected campaign id, if any (drives the highlighted row). */
  selectedId?: string;
  onSelect: (campaign: MetaCampaignSummary) => void;
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

function objectiveLabel(raw: string): string {
  if (!raw) return "—";
  return raw.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase();
}

export function CampaignPicker({
  adAccountId,
  selectedId,
  onSelect,
}: CampaignPickerProps) {
  const [filter, setFilter] = useState<"relevant" | "all">("relevant");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce the search input so we don't spam the server on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const campaigns = useFetchCampaigns(adAccountId, {
    enabled: Boolean(adAccountId),
    filter,
    search: debouncedSearch || undefined,
  });

  if (!adAccountId) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        Pick an ad account in Step 1 first to load its campaigns.
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
            placeholder="Search by campaign name..."
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
          <span className="font-medium">All</span> to include archived /
          completed campaigns.
        </p>
      )}

      {/* Body — discriminated state machine */}
      {campaigns.status === "loading" && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-8 text-sm text-muted-foreground">
          <Spinner /> Loading campaigns…
        </div>
      )}

      {campaigns.status === "error" && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">Couldn&rsquo;t load campaigns.</p>
              {campaigns.error && (
                <p className="mt-0.5 text-xs opacity-80">{campaigns.error}</p>
              )}
              <p className="mt-1 text-[11px] opacity-70">
                If this is a permission error, the connected token may be
                missing <code>ads_read</code> for this ad account.
              </p>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => campaigns.refetch()}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Try again
            </Button>
          </div>
        </div>
      )}

      {campaigns.status === "empty" && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
          {debouncedSearch ? (
            <>
              <p>No campaigns match &ldquo;{debouncedSearch}&rdquo;.</p>
              <p className="mt-1 text-xs">
                Try a different search, or switch to{" "}
                <span className="font-medium">All</span>.
              </p>
            </>
          ) : filter === "relevant" ? (
            <>
              <p>No active or paused campaigns found in this ad account.</p>
              <p className="mt-1 text-xs">
                Switch to <span className="font-medium">All</span> to include
                archived campaigns.
              </p>
            </>
          ) : (
            <p>No campaigns found in this ad account.</p>
          )}
        </div>
      )}

      {campaigns.status === "success" && (
        <>
          <ul className="max-h-96 space-y-1.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5">
            {campaigns.data.map((c) => {
              const isSelected = c.id === selectedId;
              const disabled = !c.compatible;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => !disabled && onSelect(c)}
                    disabled={disabled}
                    title={disabled ? c.incompatibleReason : undefined}
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
                            {c.name || "(unnamed campaign)"}
                          </span>
                          <StatusPill status={c.effectiveStatus ?? c.status} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                          <span className="capitalize">
                            Objective: {objectiveLabel(c.objective)}
                            {c.internalObjective && (
                              <span className="ml-1 text-foreground/70">
                                → {c.internalObjective}
                              </span>
                            )}
                          </span>
                          {c.buyingType && c.buyingType !== "AUCTION" && (
                            <span>{c.buyingType}</span>
                          )}
                          <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
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

          {campaigns.error && (
            <p className="text-xs text-destructive">{campaigns.error}</p>
          )}

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
