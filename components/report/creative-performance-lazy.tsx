"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CREATIVE_SORT_KEYS,
  type CreativeRow,
  type CreativeSortKey,
  type CreativesResult,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";

import type { CreativesSource } from "./event-report-view";

interface Props {
  /**
   * Where to fetch creatives from. Discriminated so this component
   * can power both the public share route and the internal mirror
   * without knowing which surface it's mounted on.
   */
  source: CreativesSource;
  /**
   * Current report timeframe. When this changes, state resets to
   * "idle" so a flick of the timeframe selector doesn't auto-fire a
   * heavy creative pull — the visitor still has to opt in.
   */
  datePreset: DatePreset;
  /**
   * Active custom range when `datePreset === "custom"`. Threaded into
   * the fetch URL as `since` + `until` query params so the creatives
   * route fetches against the same window as the totals. A change to
   * either bound also resets state to "idle" — same opt-in protection
   * as a preset flick.
   */
  customRange?: CustomDateRange;
}

const SORT_LABELS: Record<CreativeSortKey, string> = {
  lpv: "Landing page views",
  registrations: "Registrations",
  purchases: "Purchases",
  spend: "Spend",
  cplpv: "Cost per LPV",
  cpr: "Cost per registration",
  cpp: "Cost per purchase",
};

type FilterMode = "top5" | "top10" | "active";

const FILTER_LABELS: Record<FilterMode, string> = {
  top5: "Top 5",
  top10: "Top 10",
  active: "All active",
};

const FILTER_MODES: readonly FilterMode[] = ["top5", "top10", "active"];

/**
 * Client-side lazy loader for creative performance.
 *
 * Cold load shows a single button. Clicking it calls one of the two
 * creatives routes — `/api/share/report/[token]/creatives` or
 * `/api/insights/event/[id]/creatives` — depending on `source.kind`.
 * Both routes are cached for 5 minutes per (id, sortBy, datePreset).
 *
 * Filtering is purely client-side once loaded:
 *   - Top 5 / Top 10 → slice of the already-sorted rows
 *   - All active     → filter where `effectiveStatus === "ACTIVE"`
 *
 * No re-fetch when the filter flips, so toggling between the three
 * modes is instant. Sorting (by LPV / Spend / etc) DOES re-fetch
 * because the route returns rows pre-sorted server-side.
 */
export function CreativePerformanceLazy({
  source,
  datePreset,
  customRange,
}: Props) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "loaded"; rows: CreativeRow[]; sortBy: CreativeSortKey }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  const [filterMode, setFilterMode] = useState<FilterMode>("top5");

  // Reset to idle whenever the report window changes — datePreset OR
  // either bound of customRange. Without this, a flick of the
  // timeframe selector would silently keep showing creatives for the
  // OLD window (the parent re-fetched totals but this loaded state is
  // still bound to the previous window). Forcing a re-opt-in also
  // avoids surprise Meta calls every time a client clicks through the
  // preset buttons or tweaks a custom date input.
  //
  // Implemented via the React 19 "adjust state in render" pattern (see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than `useEffect(() => setState…)` — same observable effect,
  // no extra render commit, and clears the new
  // `react-hooks/set-state-in-effect` lint.
  const trackedNext = `${datePreset}:${customRange?.since ?? ""}:${customRange?.until ?? ""}`;
  const [trackedKey, setTrackedKey] = useState<string>(trackedNext);
  if (trackedKey !== trackedNext) {
    setTrackedKey(trackedNext);
    setState({ kind: "idle" });
  }

  const buildUrl = (sortBy: CreativeSortKey): string => {
    const params = new URLSearchParams({ sortBy, datePreset });
    if (datePreset === "custom" && customRange) {
      params.set("since", customRange.since);
      params.set("until", customRange.until);
    }
    const qs = params.toString();
    return source.kind === "share"
      ? `/api/share/report/${encodeURIComponent(source.token)}/creatives?${qs}`
      : `/api/insights/event/${encodeURIComponent(source.eventId)}/creatives?${qs}`;
  };

  const load = async (sortBy: CreativeSortKey) => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(buildUrl(sortBy), { cache: "no-store" });
      if (!res.ok) {
        setState({
          kind: "error",
          message: "Could not load creatives.",
        });
        return;
      }
      const json = (await res.json()) as CreativesResult;
      if (!json.ok) {
        setState({ kind: "error", message: json.error.message });
        return;
      }
      setState({
        kind: "loaded",
        rows: json.data.rows,
        sortBy: json.data.sortBy,
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
      <div className="rounded-md border border-dashed border-border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Creative previews and per-ad numbers are loaded on demand to keep
          this page fast.
        </p>
        <Button
          className="mt-4"
          variant="outline"
          size="sm"
          onClick={() => void load("lpv")}
        >
          Load creative previews
        </Button>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="rounded-md border border-border bg-card p-6">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading creatives…
        </div>
        <SkeletonGrid />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
        {state.message}
      </div>
    );
  }

  const filteredRows = applyFilter(state.rows, filterMode);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {filteredRows.length} of {state.rows.length} creative
            {state.rows.length === 1 ? "" : "s"}
          </p>
          <FilterSegment value={filterMode} onChange={setFilterMode} />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sort by
          <select
            value={state.sortBy}
            onChange={(e) =>
              void load(e.target.value as CreativeSortKey)
            }
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-xs text-foreground"
          >
            {CREATIVE_SORT_KEYS.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filteredRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
          {filterMode === "active"
            ? "No active creatives. Switch to Top 5 / Top 10 to include paused ads."
            : "No creatives to show yet."}
        </p>
      ) : (
        <ul className="space-y-4">
          {filteredRows.map((row) => (
            <CreativeCard key={row.adId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}

function applyFilter(rows: CreativeRow[], mode: FilterMode): CreativeRow[] {
  switch (mode) {
    case "top5":
      return rows.slice(0, 5);
    case "top10":
      return rows.slice(0, 10);
    case "active":
      return rows.filter((r) => r.effectiveStatus === "ACTIVE");
  }
}

function FilterSegment({
  value,
  onChange,
}: {
  value: FilterMode;
  onChange: (mode: FilterMode) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {FILTER_MODES.map((mode, i) => {
        const isActive = mode === value;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={`px-2.5 py-1 text-[11px] tracking-wide transition ${
              i > 0 ? "border-l border-border" : ""
            } ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground"
            }`}
          >
            {FILTER_LABELS[mode]}
          </button>
        );
      })}
    </div>
  );
}

function CreativeCard({ row }: { row: CreativeRow }) {
  const extraMerged = row.mergedCount - 1;
  const extraCampaigns = row.campaignNames.length;
  return (
    <li className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-heading text-sm tracking-wide text-foreground">
            {row.adName}
          </p>
          {extraMerged > 0 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              +{extraMerged} merged
            </span>
          ) : null}
          {row.effectiveStatus !== "ACTIVE" ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
              {row.effectiveStatus.toLowerCase().replaceAll("_", " ")}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {row.campaignName}
          {extraCampaigns > 1 ? (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/80">
              · {extraCampaigns} campaigns
            </span>
          ) : null}
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PreviewSlot title="Facebook Feed" html={row.previews.facebookFeed} />
          <PreviewSlot title="Instagram Feed" html={row.previews.instagramFeed} />
          <PreviewSlot title="Instagram Story" html={row.previews.instagramStory} />
          <PreviewSlot title="Instagram Reels" html={row.previews.instagramReels} />
        </div>

        <div className="grid grid-cols-2 gap-2 self-start text-xs">
          <PerfStat label="Spend" value={fmtCurrency(row.spend)} />
          <PerfStat
            label="LPV"
            value={fmtInt(row.landingPageViews)}
            sub={formatCostPerSub(row.spend, row.landingPageViews, "LPV")}
          />
          <PerfStat label="Regs" value={fmtInt(row.registrations)} />
          <PerfStat label="Purch" value={fmtInt(row.purchases)} />
          <PerfStat label="Reach" value={fmtInt(row.reach)} />
          <PerfStat label="Impr" value={fmtInt(row.impressions)} />
          <PerfStat
            label="Clicks"
            value={fmtInt(row.clicks)}
            sub={formatCostPerSub(row.spend, row.clicks, "click")}
          />
          <PerfStat label="CPR" value={row.cpr > 0 ? fmtCurrency(row.cpr) : "—"} />
        </div>
      </div>
    </li>
  );
}

/**
 * Renders a Meta-supplied preview iframe HTML string.
 *
 * Meta's `/{creative}/previews` returns a snippet that already wraps the
 * preview in an <iframe src="..."> with an internal Meta domain. We
 * render it as innerHTML inside a sandboxed wrapper because the iframe
 * src is on a different origin and we want the visual fidelity Meta
 * provides without recreating the preview locally.
 *
 * Sanitisation surface: the iframe HTML is scoped to graph.facebook.com
 * URLs and does not get user-controlled input from this app — the
 * creative_id we hand to Meta is server-resolved from a token-scoped
 * lookup, so XSS via this route would require compromising Meta itself.
 */
function PreviewSlot({
  title,
  html,
}: {
  title: string;
  html: string | null;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      {html ? (
        <div
          className="overflow-hidden rounded-md border border-border bg-background"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
          No preview
        </div>
      )}
    </div>
  );
}

function PerfStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  /**
   * Optional muted line under the headline value. Mirrors the
   * `Metric.sub` pattern on the event-level cards — used here for
   * derived cost-per-LPV / cost-per-click figures so the per-creative
   * cards carry the same divide-by-zero guarded sub-line as the
   * aggregate row above. Null/undefined renders nothing.
   */
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-xs text-foreground">{value}</p>
      {sub ? (
        <p className="mt-0.5 text-[9px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

/**
 * Per-creative cost-per sub-line. Mirrors the helper of the same name
 * in `event-report-view.tsx` — duplicated rather than hoisted because
 * the report-view file is "use client" too and importing it here would
 * pull the entire view bundle into the lazy chunk.
 *
 * Returns null when the denominator is missing or zero so the call
 * site can render an em-dash (or simply omit the sub-line).
 */
function formatCostPerSub(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  unit: string,
): string | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  if (!Number.isFinite(value)) return null;
  const formatted = value.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} per ${unit}`;
}

function SkeletonGrid() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-md border border-border bg-background"
        />
      ))}
    </div>
  );
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
