"use client";

/**
 * CrossCampaignAdSetPicker — multi-campaign ad set picker for `attach_adset`
 * mode when more than one parent campaign is selected.
 *
 * Renders one collapsible section per campaign, each fetching its own ad sets
 * via `useFetchAdSets`. Checkbox per ad set, shared `selectedIds` + `onToggle`
 * across all sections. Hard cap enforced at `maxTotal` (default 12).
 */

import { useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  Users,
  Target as TargetIcon,
  Calendar,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MetaAdSetSummary } from "@/lib/types";
import { useFetchAdSets } from "@/lib/hooks/useMeta";

interface CrossCampaignAdSetPickerProps {
  /** Campaigns to show ad sets for — order determines section order. */
  campaigns: { id: string; name: string }[];
  /** Currently-selected ad set ids (across all campaigns). */
  selectedIds: string[];
  /** Toggle an ad set on/off. Parent writes the snapshot update. */
  onToggle: (adSet: MetaAdSetSummary) => void;
  /** Hard cap on total selected ad sets. Unselected campaigns become disabled when hit. */
  maxTotal?: number;
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

interface CampaignSectionProps {
  campaignId: string;
  campaignName: string;
  selectedIds: string[];
  onToggle: (adSet: MetaAdSetSummary) => void;
  atCap: boolean;
}

/** One collapsible section per parent campaign. Has its own useFetchAdSets call. */
function CampaignSection({
  campaignId,
  campaignName,
  selectedIds,
  onToggle,
  atCap,
}: CampaignSectionProps) {
  const [expanded, setExpanded] = useState(true);

  const adSets = useFetchAdSets(campaignId, {
    enabled: Boolean(campaignId),
    filter: "relevant",
  });

  const selectedSet = new Set(selectedIds);
  const sectionSelected = (adSets.data ?? []).filter((a) => selectedSet.has(a.id));

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Section header — toggles collapse */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 bg-muted/40 px-3 py-2.5 text-left hover:bg-muted/60"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {campaignName || campaignId}
        </span>
        {sectionSelected.length > 0 && (
          <Badge variant="default" className="shrink-0">
            {sectionSelected.length} selected
          </Badge>
        )}
        {adSets.status === "loading" && (
          <Spinner className="h-3 w-3 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="p-3">
          {adSets.status === "loading" && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner /> Loading ad sets…
            </div>
          )}

          {adSets.status === "error" && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Couldn&rsquo;t load ad sets.</p>
                  {adSets.error && (
                    <p className="mt-0.5 text-xs opacity-80">{adSets.error}</p>
                  )}
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => adSets.refetch()}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Retry
                </Button>
              </div>
            </div>
          )}

          {adSets.status === "empty" && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              No active or paused ad sets in this campaign.
            </div>
          )}

          {adSets.status === "success" && (
            <div className="space-y-1.5">
              {adSets.data.map((a) => {
                const isSelected = selectedSet.has(a.id);
                const disabled = !a.compatible || (atCap && !isSelected);
                const disabledReason = disabled
                  ? !a.compatible
                    ? a.incompatibleReason
                    : `Maximum ${selectedIds.length} ad sets already selected — deselect one to pick this`
                  : undefined;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => !disabled && onToggle(a)}
                    disabled={disabled}
                    title={disabledReason}
                    className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors
                      ${isSelected
                        ? "border-primary bg-primary-light"
                        : "border-border hover:bg-muted/50"}
                      ${disabled ? "cursor-not-allowed opacity-50 hover:bg-transparent" : ""}`}
                  >
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
                      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        {a.optimizationGoal && (
                          <div className="flex items-center gap-1.5">
                            <TargetIcon className="h-3 w-3 shrink-0" />
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
                            <span className="line-clamp-1">{a.targetingSummary}</span>
                          </div>
                        )}
                        {a.updatedTime && (
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span>
                              Updated{" "}
                              {new Date(a.updatedTime).toLocaleDateString()}
                            </span>
                          </div>
                        )}
                      </div>
                      {disabled && disabledReason && (
                        <p className="mt-1 text-[11px] text-warning">
                          {disabledReason}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}

              {adSets.hasMore && (
                <div className="flex justify-center pt-1">
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
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CrossCampaignAdSetPicker({
  campaigns,
  selectedIds,
  onToggle,
  maxTotal = 12,
}: CrossCampaignAdSetPickerProps) {
  const atCap = selectedIds.length >= maxTotal;

  if (campaigns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
        Pick campaigns above to load their ad sets.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-md bg-primary-light/30 px-3 py-2 text-xs">
          <span className="text-foreground">
            <span className="font-medium">{selectedIds.length}</span> /{" "}
            {maxTotal} ad set{selectedIds.length !== 1 ? "s" : ""} selected
          </span>
          <span className="text-muted-foreground">
            Ads will be added to all selected ad sets.
          </span>
        </div>
      )}

      {atCap && (
        <p className="text-[11px] text-warning">
          Maximum {maxTotal} ad sets reached. Deselect one to pick a different one.
        </p>
      )}

      <div className="space-y-2">
        {campaigns.map((c) => (
          <CampaignSection
            key={c.id}
            campaignId={c.id}
            campaignName={c.name}
            selectedIds={selectedIds}
            onToggle={onToggle}
            atCap={atCap}
          />
        ))}
      </div>
    </div>
  );
}
