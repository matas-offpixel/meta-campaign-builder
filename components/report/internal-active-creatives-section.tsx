"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  groupByAssetSignature,
  type ConceptGroupRow,
  type ConceptInputRow,
} from "@/lib/reporting/group-creatives";
import ShareActiveCreativesClient from "@/components/share/share-active-creatives-client";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * components/report/internal-active-creatives-section.tsx
 *
 * Internal Reporting tab "Active creatives" section. Mounted in place
 * of the old `<CreativePerformanceLazy>` per-placement preview grid
 * (which cropped previews horribly on the four-column tile row — see
 * PR #62 #1). Renders the same concept-card summary the public share
 * page uses, so a client looking at `/share/report/[token]` and a
 * staffer looking at the internal Reporting tab see structurally
 * identical creative breakdowns.
 *
 * Lazy-load behaviour matches `CreativePerformanceLazy`:
 *   - cold state shows an opt-in button (Meta fan-out is slow on
 *     wide events; we don't want to pay it on every tab open)
 *   - clicking calls `/api/events/[id]/active-creatives` with the
 *     active timeframe params so the per-card metrics honour the
 *     timeframe pill instead of Meta's `last_30d` default
 *   - state resets to "idle" when the timeframe changes so a flick
 *     from 7d → 30d doesn't silently keep showing 7d numbers
 *
 * Once loaded, the section reuses the share view's
 * `<ShareActiveCreativesClient>` island as-is — no second copy of the
 * card, modal, or fatigue-pill JSX. The transformation step
 * (`groupByAssetSignature`) collapses re-uploaded creatives into one
 * concept the same way the share page does.
 */

interface Props {
  eventId: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
}

interface SuccessResponse {
  ok: true;
  creatives: ConceptInputRow[];
  ad_account_id: string | null;
  event_code: string | null;
  fetched_at: string;
  reason?: "no_event_code" | "no_ad_account" | "no_linked_campaigns";
  meta: {
    campaigns_total: number;
    campaigns_failed: number;
    ads_fetched: number;
    dropped_no_creative: number;
    truncated: boolean;
  };
}

interface FailureResponse {
  ok: false;
  reason?: string;
  error?: string;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "loaded";
      groups: ConceptGroupRow[];
      adsFetched: number;
      campaignsTotal: number;
    }
  | { kind: "empty"; reason: string }
  | { kind: "error"; message: string };

export function InternalActiveCreativesSection({
  eventId,
  datePreset,
  customRange,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });

  // Reset to idle whenever the report window changes — datePreset OR
  // either bound of customRange. Mirrors `CreativePerformanceLazy`'s
  // "adjust state in render" guard so a timeframe flick doesn't keep
  // serving creative numbers from the previous window. Forcing a new
  // opt-in also avoids surprise Meta fan-outs every time a staffer
  // clicks through the preset row.
  const trackedNext = `${datePreset}:${customRange?.since ?? ""}:${customRange?.until ?? ""}`;
  const [trackedKey, setTrackedKey] = useState<string>(trackedNext);
  if (trackedKey !== trackedNext) {
    setTrackedKey(trackedNext);
    setState({ kind: "idle" });
  }

  const buildUrl = (): string => {
    const params = new URLSearchParams({ datePreset });
    if (datePreset === "custom" && customRange) {
      params.set("since", customRange.since);
      params.set("until", customRange.until);
    }
    return `/api/events/${encodeURIComponent(eventId)}/active-creatives?${params.toString()}`;
  };

  const load = async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(buildUrl(), { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | FailureResponse
          | null;
        setState({
          kind: "error",
          message:
            body?.error ?? body?.reason ?? `Could not load creatives (${res.status})`,
        });
        return;
      }
      const json = (await res.json()) as SuccessResponse | FailureResponse;
      if (!json.ok) {
        setState({
          kind: "error",
          message: json.error ?? json.reason ?? "Could not load creatives",
        });
        return;
      }
      // Three "ok but nothing to show" reasons get folded into a quiet
      // empty state instead of an error pill — these are configuration
      // gaps (no event_code / no ad account / no campaigns matched
      // [EVENTCODE] on the account) that the staffer can't fix from
      // this surface anyway.
      if (
        json.reason === "no_event_code" ||
        json.reason === "no_ad_account" ||
        json.reason === "no_linked_campaigns" ||
        json.creatives.length === 0
      ) {
        setState({
          kind: "empty",
          reason: json.reason ?? "no_data",
        });
        return;
      }
      const groups = groupByAssetSignature(json.creatives);
      setState({
        kind: "loaded",
        groups,
        adsFetched: json.meta.ads_fetched,
        campaignsTotal: json.meta.campaigns_total,
      });
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Could not load creatives.",
      });
    }
  };

  if (state.kind === "idle") {
    return (
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <div className="rounded-md border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Creative previews and per-ad numbers are loaded on demand to keep
            this page fast.
          </p>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            onClick={() => void load()}
          >
            Load creative previews
          </Button>
        </div>
      </section>
    );
  }

  if (state.kind === "loading") {
    return (
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <div className="rounded-md border border-border bg-card p-8">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading creatives…
          </div>
        </div>
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
          {state.message}
        </div>
      </section>
    );
  }

  if (state.kind === "empty") {
    // Skip the section entirely on the share view's "no campaigns
    // matched" path so the internal tab has the same quiet-fallback
    // surface — a heading + muted note rather than a hollow grid.
    return (
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <p className="text-sm text-muted-foreground">
          No active creatives in this window.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <span className="text-xs text-muted-foreground">
          {state.groups.length} concept{state.groups.length === 1 ? "" : "s"} ·{" "}
          {state.adsFetched} ad{state.adsFetched === 1 ? "" : "s"} across{" "}
          {state.campaignsTotal} campaign
          {state.campaignsTotal === 1 ? "" : "s"}
        </span>
      </div>

      <ShareActiveCreativesClient groups={state.groups} />

      <p className="text-xs text-muted-foreground">
        Spend, registrations and reach are summed across the underlying ads in
        each creative concept. Rate metrics (CTR, CPR, frequency) are
        recomputed from the summed totals — not averaged across ads — to
        avoid the usual ratio-of-rates inflation. Reach is summed across ads
        and may over-count audiences that overlap. Click any card to see the
        full creative.
      </p>
    </section>
  );
}
