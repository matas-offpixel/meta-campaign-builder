"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
} from "react";
import { Loader2, RefreshCw } from "lucide-react";

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
 * Refresh handle (PR #63 — exposed via `forwardRef` +
 * `useImperativeHandle`):
 *   - Parent calls `ref.current.refresh()` from the live report
 *     footer's Refresh button. When the section is currently in
 *     "loaded" state, this re-fetches with `?force=1` so any
 *     server-side cache is bypassed and the fresh creative names
 *     (e.g. after a Meta-side rename) replace the stale ones.
 *   - When the section is in idle / loading / error state, refresh
 *     is a no-op — there's nothing rendered to refresh, and forcing
 *     a Meta fan-out for a section the user hasn't opted into would
 *     defeat the whole point of the lazy-load button.
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

/**
 * Imperative handle exposed to the parent (`InternalEventReport`)
 * so the live report footer's Refresh button can ALSO bust this
 * section's data — not just the headline insights cache. Without
 * this, a Meta-side creative rename never propagated to the
 * already-loaded card grid (PR #63 bug).
 */
export interface InternalActiveCreativesHandle {
  refresh: () => Promise<void>;
}

export const InternalActiveCreativesSection = forwardRef<
  InternalActiveCreativesHandle,
  Props
>(function InternalActiveCreativesSection(
  { eventId, datePreset, customRange },
  ref,
) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [refreshing, setRefreshing] = useState(false);

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

  const buildUrl = useCallback(
    (force: boolean): string => {
      const params = new URLSearchParams({ datePreset });
      if (datePreset === "custom" && customRange) {
        params.set("since", customRange.since);
        params.set("until", customRange.until);
      }
      if (force) params.set("force", "1");
      return `/api/events/${encodeURIComponent(eventId)}/active-creatives?${params.toString()}`;
    },
    [eventId, datePreset, customRange],
  );

  /**
   * Single load path used by both the initial "Load creative previews"
   * click and the imperative refresh handle. `force=true` adds the
   * `?force=1` query param so the route emits `Cache-Control: no-store`
   * and (in any future caching layer) bypasses the TTL.
   *
   * `markLoadingOnRefresh` controls the spinner UX:
   *   - true (initial load) — flip to "loading" so the section shows
   *     the spinner skeleton.
   *   - false (manual refresh of an already-loaded section) — keep
   *     the existing card grid visible while refreshing in the
   *     background; the page-level Refresh button owns the spinner.
   */
  const load = useCallback(
    async ({
      force,
      markLoadingOnRefresh,
    }: {
      force: boolean;
      markLoadingOnRefresh: boolean;
    }) => {
      if (markLoadingOnRefresh) {
        setState({ kind: "loading" });
      }
      const res = await fetch(buildUrl(force), { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | FailureResponse
          | null;
        const message =
          body?.error ?? body?.reason ?? `HTTP ${res.status}`;
        setState({ kind: "error", message });
        throw new Error(message);
      }
      const json = (await res.json()) as SuccessResponse | FailureResponse;
      if (!json.ok) {
        const message = json.error ?? json.reason ?? "Could not load creatives";
        setState({ kind: "error", message });
        throw new Error(message);
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
    },
    [buildUrl],
  );

  const handleInitialLoad = useCallback(async () => {
    try {
      await load({ force: false, markLoadingOnRefresh: true });
    } catch {
      // load() already set the error state — swallow the throw so the
      // initial click handler doesn't bubble an unhandled rejection.
    }
  }, [load]);

  // The imperative refresh handle re-creates whenever `state.kind`
  // changes — that's intentional. `useImperativeHandle` re-runs and
  // updates `.current` on the parent's ref to the latest closure, so a
  // refresh click always observes the current state. We avoid the
  // "mirror state into a ref during render" pattern (banned by
  // `react-hooks/refs-during-render` in React 19) entirely.
  const refresh = useCallback(async () => {
    // No-op when the section hasn't been opened yet (or a previous
    // load failed). Forcing a Meta fan-out just because the parent
    // clicked Refresh would defeat the lazy-load opt-in.
    if (state.kind !== "loaded") return;
    await load({ force: true, markLoadingOnRefresh: false });
  }, [load, state.kind]);

  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await load({ force: true, markLoadingOnRefresh: state.kind !== "loaded" });
    } catch {
      // load() already moved the section into an error state.
    } finally {
      setRefreshing(false);
    }
  }, [load, refreshing, state.kind]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

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
            onClick={() => void handleInitialLoad()}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            No active creatives in this window.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleManualRefresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh Creatives
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {state.groups.length} concept{state.groups.length === 1 ? "" : "s"} ·{" "}
            {state.adsFetched} ad{state.adsFetched === 1 ? "" : "s"} across{" "}
            {state.campaignsTotal} campaign
            {state.campaignsTotal === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleManualRefresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh Creatives
          </Button>
        </div>
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
});
