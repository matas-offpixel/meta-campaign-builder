"use client";

/**
 * AdSetPicker — Step 1 of the bulk-attach flow.
 *
 * Renders one card per selected campaign. Each card lists the campaign's ad
 * sets with checkboxes so the user can pick which ones receive the new ads.
 * All ad sets are pre-selected by default.
 *
 * Data flow:
 *   - On mount: fetches ad sets from GET /api/meta/bulk-attach-ads/list-adsets
 *   - Pre-selects all ad sets unless the parent already has a selection
 *     (preserves back-navigation state)
 *   - All selection state lives in the parent (Map<campaignId, Set<adSetId>>)
 *     so it survives step navigation
 */

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { MetaCampaignSummary } from "@/lib/types";
import type { ListAdSetsResult, AdSetInfo } from "@/app/api/meta/bulk-attach-ads/list-adsets/route";

interface AdSetPickerProps {
  adAccountId: string;
  /** Campaigns selected in Step 0. */
  campaigns: Map<string, MetaCampaignSummary>;
  /**
   * Parent-managed selection — Map<campaignId, Set<adSetId>>.
   * The picker pre-populates this on first mount, then calls onSelectionChange
   * whenever the user toggles a checkbox.
   */
  selection: Map<string, Set<string>>;
  onSelectionChange: (updated: Map<string, Set<string>>) => void;
}

// ─── Badge helpers ────────────────────────────────────────────────────────────

function AdSetStatusBadge({ status }: { status: string }) {
  const s = (status ?? "").toUpperCase();
  if (s === "ACTIVE") return <Badge variant="success">Active</Badge>;
  if (s === "PAUSED") return <Badge variant="warning">Paused</Badge>;
  if (s === "ARCHIVED") return <Badge variant="outline">Archived</Badge>;
  if (s === "DELETED") return <Badge variant="destructive">Deleted</Badge>;
  return <Badge variant="outline">{status || "Unknown"}</Badge>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdSetPicker({
  adAccountId,
  campaigns,
  selection,
  onSelectionChange,
}: AdSetPickerProps) {
  const [fetchedAdSets, setFetchedAdSets] = useState<Map<string, AdSetInfo[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);

  useEffect(() => {
    const campaignIds = Array.from(campaigns.keys());
    if (campaignIds.length === 0) return;

    setLoading(true);
    setFetchError(null);
    setPartialWarning(null);

    const params = new URLSearchParams({
      adAccountId,
      campaignIds: campaignIds.join(","),
    });

    fetch(`/api/meta/bulk-attach-ads/list-adsets?${params}`)
      .then(async (res) => {
        const data: ListAdSetsResult & { error?: string; rateLimited?: boolean } =
          await res.json();

        if (!res.ok && res.status !== 207) {
          const msg = data.rateLimited
            ? `Rate limited — ${data.error ?? "retry in a few minutes"}`
            : (data.error ?? "Failed to load ad sets");
          setFetchError(msg);
          return;
        }

        // Build the metadata map from the response
        const metaMap = new Map<string, AdSetInfo[]>();
        for (const c of data.campaigns ?? []) {
          metaMap.set(c.campaignId, c.adSets);
        }
        setFetchedAdSets(metaMap);

        if (data.partial && (data.failedCampaignIds?.length ?? 0) > 0) {
          setPartialWarning(
            `Could not load ad sets for ${data.failedCampaignIds!.length} campaign(s) — ` +
              `rate limited. Retry in a few minutes or proceed with the campaigns that loaded.`,
          );
        }

        // Pre-select all ad sets, but only for campaigns that have NO existing
        // selection yet (so back-navigation preserves the user's edits).
        const next = new Map(selection);
        for (const [campaignId, adSets] of metaMap.entries()) {
          if (!next.has(campaignId) || next.get(campaignId)!.size === 0) {
            next.set(campaignId, new Set(adSets.map((a) => a.id)));
          }
        }
        onSelectionChange(next);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : "Network error loading ad sets");
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount — adAccountId and campaign IDs are stable after step 0

  // ── Toggle helpers ──────────────────────────────────────────────────────
  const toggleAdSet = (campaignId: string, adSetId: string) => {
    const next = new Map(selection);
    const current = new Set(next.get(campaignId) ?? []);
    if (current.has(adSetId)) {
      current.delete(adSetId);
    } else {
      current.add(adSetId);
    }
    next.set(campaignId, current);
    onSelectionChange(next);
  };

  const selectAll = (campaignId: string) => {
    const adSets = fetchedAdSets.get(campaignId) ?? [];
    const next = new Map(selection);
    next.set(campaignId, new Set(adSets.map((a) => a.id)));
    onSelectionChange(next);
  };

  const selectNone = (campaignId: string) => {
    const next = new Map(selection);
    next.set(campaignId, new Set());
    onSelectionChange(next);
  };

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading ad sets…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Couldn&rsquo;t load ad sets</p>
          <p className="mt-0.5 text-xs opacity-80">{fetchError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {partialWarning && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5 text-sm text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {partialWarning}
        </div>
      )}

      {Array.from(campaigns.entries()).map(([campaignId, campaign]) => {
        const adSets = fetchedAdSets.get(campaignId) ?? [];
        const selectedSet = selection.get(campaignId) ?? new Set<string>();
        const allSelected = adSets.length > 0 && adSets.every((a) => selectedSet.has(a.id));
        const noneSelected = adSets.every((a) => !selectedSet.has(a.id));

        return (
          <div
            key={campaignId}
            className="rounded-lg border border-border bg-card overflow-hidden"
          >
            {/* Campaign header */}
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 bg-muted/30">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {campaign.name || campaignId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {adSets.length} ad set{adSets.length !== 1 ? "s" : ""} ·{" "}
                  {selectedSet.size} selected
                </p>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => selectAll(campaignId)}
                  disabled={allSelected || adSets.length === 0}
                  className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Select all
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={() => selectNone(campaignId)}
                  disabled={noneSelected || adSets.length === 0}
                  className="text-muted-foreground hover:text-foreground hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Select none
                </button>
              </div>
            </div>

            {/* Ad set list */}
            {adSets.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No ad sets found for this campaign.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {adSets.map((adSet) => {
                  const checked = selectedSet.has(adSet.id);
                  return (
                    <li key={adSet.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAdSet(campaignId, adSet.id)}
                          className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {adSet.name}
                        </span>
                        <AdSetStatusBadge status={adSet.status} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
