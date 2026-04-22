"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Tag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import {
  useCreativeHeatmap,
  type UseCreativeHeatmapResult,
} from "@/lib/hooks/useCreativeHeatmap";
import {
  groupForObjective,
  OBJECTIVE_GROUP_ORDER,
  OBJECTIVE_PRESETS,
  type CreativeNumericMetric,
  type ObjectiveGroup,
  type ObjectivePreset,
} from "@/lib/intelligence/objective-metrics";
import type {
  CreativeDatePreset,
  CreativeInsightRow,
  CreativeTagType,
} from "@/lib/types/intelligence";

const TAG_TYPES: { value: CreativeTagType; label: string }[] = [
  { value: "format", label: "Format" },
  { value: "hook", label: "Hook" },
  { value: "genre", label: "Genre" },
  { value: "style", label: "Style" },
  { value: "asset_type", label: "Asset Type" },
];

const STATUS_FILTERS = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
];

/**
 * Date preset chip definitions. Values are passed straight through to
 * the route's `?datePreset=…` param (which mirrors Meta's `date_preset`
 * enum 1:1) so there's no mapping table to keep in sync.
 */
const DATE_PRESETS: { value: CreativeDatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_3d", label: "Last 3d" },
  { value: "last_7d", label: "Last 7d" },
  { value: "last_14d", label: "Last 14d" },
  { value: "last_30d", label: "Last 30d" },
  { value: "maximum", label: "All time" },
];

const TAG_COLOR: Record<CreativeTagType, string> = {
  format: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  hook: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
  genre: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  style: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  asset_type: "bg-pink-500/15 text-pink-700 dark:text-pink-400 border-pink-500/30",
};

function fmtMoney(n: number): string {
  return `£${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
function fmtNum(n: number): string {
  return n.toLocaleString();
}
function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/**
 * "X mins ago" / "X hours ago" / "X days ago" / "just now" formatter
 * for the snapshot freshness badge. Stays here rather than reaching
 * into `lib/dashboard/format.ts` because that file is server-side
 * focused (`fmtDate`/`fmtShort` use locale formatting) — this is a
 * one-off relative formatter, not a date renderer.
 */
function formatRelativeFromNow(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

// ─── Sort model ──────────────────────────────────────────────────────────────

/**
 * Columns the user can click-to-sort. Anchored at the table header.
 * Extended in H3 with the columns the objective presets surface
 * (registrations, cpr, linkClicks, reach) so the per-group default
 * sort + the user's manual sort agree on a key.
 */
type SortKey = CreativeNumericMetric;

type SortState = { key: SortKey; dir: "asc" | "desc" } | null;

const DEFAULT_SORT: SortState = { key: "cpl", dir: "asc" };

/** Three-way header click cycle: asc → desc → unsorted (back to default). */
function nextSort(current: SortState, key: SortKey): SortState {
  if (!current || current.key !== key) return { key, dir: "asc" };
  if (current.dir === "asc") return { key, dir: "desc" };
  return null;
}

function ariaSortFor(state: SortState, key: SortKey): "ascending" | "descending" | "none" {
  if (!state || state.key !== key) return "none";
  return state.dir === "asc" ? "ascending" : "descending";
}

function compareNumeric(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: "asc" | "desc",
): number {
  // Nulls always last regardless of direction — they aren't "low" or
  // "high", they're "no data".
  const aNull = a == null || !Number.isFinite(a);
  const bNull = b == null || !Number.isFinite(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const delta = (a as number) - (b as number);
  return dir === "asc" ? delta : -delta;
}

function applySort(rows: CreativeInsightRow[], sort: SortState): CreativeInsightRow[] {
  if (!sort) {
    // Unsorted = the route's natural order. Nothing to do.
    return rows;
  }
  const { key, dir } = sort;
  return [...rows].sort((a, b) => compareNumeric(a[key], b[key], dir));
}

/** "All" sentinel for the objective chip row. Keeps the URL of the
 * objective state simple (`null` → all groups) and means we never
 * have to teach the chip-rendering loop about a special label. */
type ObjectiveFilter = ObjectiveGroup | "all";

export function CreativeHeatmapPage() {
  const heatmap = useCreativeHeatmap();
  // Status filter stays component-local — it never round-trips to the
  // route, just shapes the rendered set. Default "ACTIVE" keeps cold
  // loads small enough to dodge Meta rate limits on accounts with
  // long histories; users can flip to "ALL" when they want the wider
  // view.
  const [status, setStatus] = useState<string>("ACTIVE");
  // Sort state is component-local for the same reason. Default sort
  // is ascending CPL (best leads first) when no objective is active;
  // an active preset overrides this via the chip handler.
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  // H3: active objective chip. `'all'` keeps the pre-H3 layout.
  const [objective, setObjective] = useState<ObjectiveFilter>("all");

  return (
    <CreativeHeatmapInner
      heatmap={heatmap}
      status={status}
      setStatus={setStatus}
      sort={sort}
      setSort={setSort}
      objective={objective}
      setObjective={setObjective}
    />
  );
}

function CreativeHeatmapInner({
  heatmap,
  status,
  setStatus,
  sort,
  setSort,
  objective,
  setObjective,
}: {
  heatmap: UseCreativeHeatmapResult;
  status: string;
  setStatus: (v: string) => void;
  sort: SortState;
  setSort: (next: SortState) => void;
  objective: ObjectiveFilter;
  setObjective: (next: ObjectiveFilter) => void;
}) {
  const {
    adAccounts,
    adAccountsLoading,
    adAccountId,
    setAdAccountId,
    datePreset,
    setDatePreset,
    rows,
    setRows,
    snapshotAt,
    needsRefresh,
    snapshotSavedAt,
    loading,
    isRefreshing,
    error,
    lastFailed,
    refresh,
    retry,
  } = heatmap;

  // Show the "Showing cached snapshot" chip whenever the rows on
  // screen are coming from the localStorage snapshot rather than a
  // freshly resolved server response. That's true while the
  // background fetch is still in flight (loading) and also after the
  // server returned a cold-cache `needsRefresh: true` response — the
  // hook's `shouldOverwriteRows` guard keeps the snapshot rows
  // visible in both cases. snapshotSavedAt is null once a fresh
  // populated server response has overwritten rows, so the chip
  // disappears on its own.
  const showingClientSnapshot =
    snapshotSavedAt != null &&
    rows != null &&
    rows.length > 0 &&
    (loading || needsRefresh);

  /**
   * Per-group counts across the *unfiltered* row set. Counts have to
   * be stable as the user toggles status / objective so the chip row
   * remains a reliable pointer to "where my budget is".
   */
  const objectiveCounts = useMemo(() => {
    const counts: Record<ObjectiveGroup, number> = {
      leads: 0,
      sales: 0,
      traffic: 0,
      awareness: 0,
      engagement: 0,
      other: 0,
    };
    if (!rows) return counts;
    for (const r of rows) counts[groupForObjective(r.campaignObjective)] += 1;
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    let next = rows;
    if (status !== "ALL") {
      next = next.filter((r) => (r.status ?? "").toUpperCase() === status);
    }
    if (objective !== "all") {
      next = next.filter(
        (r) => groupForObjective(r.campaignObjective) === objective,
      );
    }
    return applySort(next, sort);
  }, [rows, status, sort, objective]);

  /**
   * Generic summary used when objective='all' — same shape as
   * pre-H3. The objective-specific summary is computed separately so
   * we can swap the headline metric without losing the count chip.
   */
  const summary = useMemo(() => {
    if (!filteredRows) return null;
    const totalSpend = filteredRows.reduce((s, r) => s + r.spend, 0);
    const totalImpr = filteredRows.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = filteredRows.reduce((s, r) => s + r.clicks, 0);
    const totalRegistrations = filteredRows.reduce(
      (s, r) => s + r.registrations,
      0,
    );
    const totalPurchases = filteredRows.reduce((s, r) => s + r.purchases, 0);
    const totalLinkClicks = filteredRows.reduce((s, r) => s + r.linkClicks, 0);
    const totalReach = filteredRows.reduce((s, r) => s + r.reach, 0);
    const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
    const blendedCpr =
      totalRegistrations > 0 ? totalSpend / totalRegistrations : null;
    const blendedCpc =
      totalLinkClicks > 0 ? totalSpend / totalLinkClicks : null;
    const blendedCpm = totalImpr > 0 ? (totalSpend / totalImpr) * 1000 : null;
    const fatigued = filteredRows.filter((r) => r.fatigueScore !== "ok").length;
    return {
      count: filteredRows.length,
      totalSpend,
      avgCtr,
      fatigued,
      totalRegistrations,
      totalPurchases,
      totalLinkClicks,
      totalReach,
      blendedCpr,
      blendedCpc,
      blendedCpm,
    };
  }, [filteredRows]);

  /**
   * Active preset for the table column swap + summary headline.
   * `null` when objective='all' (table renders the full column set).
   */
  const activePreset = objective === "all" ? null : OBJECTIVE_PRESETS[objective];

  // When the user picks a non-`all` chip, flip the default sort to
  // the preset's primary metric. Any subsequent header click still
  // wins via setSort, so the user can override per-session.
  const handleObjectiveChange = (next: ObjectiveFilter) => {
    setObjective(next);
    if (next === "all") {
      setSort(DEFAULT_SORT);
    } else {
      const preset = OBJECTIVE_PRESETS[next];
      setSort({ key: preset.primaryMetric, dir: preset.defaultSortDir });
    }
  };

  const handleTagAdded = (
    adId: string,
    tag: CreativeInsightRow["tags"][number],
  ) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.adId === adId ? { ...r, tags: [...r.tags, tag] } : r,
          )
        : prev,
    );
  };

  const handleTagRemoved = (adId: string, tagId: string) => {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.adId === adId
              ? { ...r, tags: r.tags.filter((t) => t.id !== tagId) }
              : r,
          )
        : prev,
    );
  };

  return (
    <div className="space-y-5">
      {/* ── Filter bar ────────────────────────────────────────────── */}
      <div className="rounded-md border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_auto]">
          <Combobox
            label="Ad account"
            value={adAccountId}
            onChange={setAdAccountId}
            placeholder={adAccountsLoading ? "Loading…" : "Choose ad account"}
            disabled={adAccountsLoading}
            loading={adAccountsLoading}
            emptyText="No ad accounts match"
            options={adAccounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.currency})`,
              sublabel: a.id,
            }))}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={STATUS_FILTERS}
          />
          <div className="flex flex-col items-end justify-end gap-1">
            <Button
              onClick={() => void refresh()}
              disabled={loading || !adAccountId}
              size="sm"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {rows && rows.length > 0 ? "Refresh from Meta" : "Load creatives"}
            </Button>
            {snapshotAt && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                Refreshed {formatRelativeFromNow(snapshotAt)}
              </span>
            )}
            {showingClientSnapshot && snapshotSavedAt && (
              <span
                className="text-[10px] text-muted-foreground/80 tabular-nums"
                title="Rows are restored from your last visit to this view; the latest data is loading in the background."
              >
                Showing cached snapshot · {formatRelativeFromNow(snapshotSavedAt)}
              </span>
            )}
          </div>
        </div>

        <DatePresetChips
          value={datePreset}
          onChange={setDatePreset}
          disabled={loading}
        />
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          <span className="leading-relaxed">{error.message}</span>
          {error.retryable && lastFailed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void retry()}
              disabled={adAccountsLoading || loading}
              className="shrink-0"
            >
              {(adAccountsLoading || loading) ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Try again
            </Button>
          )}
        </div>
      )}

      {/* ── Empty / loading / data ────────────────────────────────── */}
      {!rows && !loading && (
        <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-border bg-card text-sm text-muted-foreground">
          Select an ad account to load creative performance data.
        </div>
      )}

      {rows && rows.length === 0 && needsRefresh && !loading && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          <p>No cached snapshot yet for this account.</p>
          <p className="text-xs text-muted-foreground/80">
            Click <span className="font-medium text-foreground">Refresh from Meta</span>{" "}
            to populate the cache. The first fetch can take a few minutes
            on large accounts; subsequent loads are instant.
          </p>
          <Button onClick={() => void refresh()} disabled={loading} size="sm">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh from Meta
          </Button>
        </div>
      )}

      {loading && isRefreshing && <RefreshProgressBar />}
      {loading && !isRefreshing && !rows && (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
      )}

      {/*
       * Render the table whenever we have rows, even mid-fetch — the
       * client snapshot makes the background refresh non-disruptive,
       * and the "Showing cached snapshot" chip up top tells the user
       * what they're looking at. We still hide it during a live
       * `?refresh=1` (isRefreshing) so the progress bar isn't
       * competing with stale data.
       */}
      {filteredRows && summary && !isRefreshing && (
        <>
          <ObjectiveChips
            value={objective}
            onChange={handleObjectiveChange}
            counts={objectiveCounts}
            total={rows?.length ?? 0}
          />

          <SummaryBar summary={summary} preset={activePreset} />

          {filteredRows.length === 0 ? (
            <div className="rounded-md border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No creatives match the current filters.
            </div>
          ) : (
            <CreativesTable
              rows={filteredRows}
              sort={sort}
              onSortChange={(key) => setSort(nextSort(sort, key))}
              onTagAdded={handleTagAdded}
              onTagRemoved={handleTagRemoved}
              visibleMetrics={activePreset?.visibleMetrics ?? null}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Objective chip row ─────────────────────────────────────────────────────

/**
 * Chip row for the objective filter. Renders an "All" chip first, then
 * one per group in `OBJECTIVE_GROUP_ORDER`. The count next to each
 * label is the per-group total across the whole row set (independent
 * of the active filter) so the chips read as "where my ads live", not
 * "what's in the current view".
 */
function ObjectiveChips({
  value,
  onChange,
  counts,
  total,
}: {
  value: ObjectiveFilter;
  onChange: (next: ObjectiveFilter) => void;
  counts: Record<ObjectiveGroup, number>;
  total: number;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by campaign objective"
      className="flex flex-wrap items-center gap-1.5"
    >
      <ObjectiveChip
        active={value === "all"}
        onClick={() => onChange("all")}
        label="All"
        count={total}
      />
      {OBJECTIVE_GROUP_ORDER.map((g) => {
        const c = counts[g];
        // Hide groups with 0 ads — they'd just be visual noise.
        // `other` is included even at 0 so the user can confirm
        // every objective got mapped.
        if (c === 0 && g !== "other") return null;
        return (
          <ObjectiveChip
            key={g}
            active={value === g}
            onClick={() => onChange(g)}
            label={OBJECTIVE_PRESETS[g].label}
            count={c}
          />
        );
      })}
    </div>
  );
}

function ObjectiveChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
      ].join(" ")}
    >
      <span>{label}</span>
      <span
        className={[
          "tabular-nums",
          active ? "text-background/70" : "text-muted-foreground/70",
        ].join(" ")}
      >
        {count}
      </span>
    </button>
  );
}

// ─── Summary bar ────────────────────────────────────────────────────────────

interface SummaryShape {
  count: number;
  totalSpend: number;
  avgCtr: number;
  fatigued: number;
  totalRegistrations: number;
  totalPurchases: number;
  totalLinkClicks: number;
  totalReach: number;
  blendedCpr: number | null;
  blendedCpc: number | null;
  blendedCpm: number | null;
}

/**
 * Summary chip strip. When no objective preset is active we keep the
 * pre-H3 wording (count · spend · CTR · fatigued); when a preset is
 * active we lead with that group's primary metric (e.g. "312 ads ·
 * £4,812 spend · 287 registrations · £16.77 CPR" for the leads
 * preset). Counts always survive the swap so the user can tell at
 * a glance how many ads they're looking at.
 */
function SummaryBar({
  summary,
  preset,
}: {
  summary: SummaryShape;
  preset: ObjectivePreset | null;
}) {
  const adsLabel = `${summary.count} ad${summary.count === 1 ? "" : "s"}`;

  if (!preset) {
    return (
      <div className="rounded-md border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{summary.count}</span> ads ·{" "}
        <span className="font-medium text-foreground">{fmtMoney(summary.totalSpend)}</span>{" "}
        total spend · Avg CTR{" "}
        <span className="font-medium text-foreground">{fmtPct(summary.avgCtr)}</span> ·{" "}
        <span className="font-medium text-foreground">{summary.fatigued}</span>{" "}
        creative{summary.fatigued === 1 ? "" : "s"} flagged as fatigued
      </div>
    );
  }

  // Per-preset headline. The cases below pick the metric pair that
  // actually matters for that group; the generic spend/CTR pair stays
  // available below as the always-visible secondary line.
  let headline: React.ReactNode = null;
  switch (preset.group) {
    case "leads":
      headline = (
        <>
          <span className="font-medium text-foreground">
            {fmtNum(summary.totalRegistrations)}
          </span>{" "}
          registrations · CPR{" "}
          <span className="font-medium text-foreground">
            {summary.blendedCpr != null ? fmtMoney(summary.blendedCpr) : "—"}
          </span>
        </>
      );
      break;
    case "sales":
      headline = (
        <>
          <span className="font-medium text-foreground">
            {fmtNum(summary.totalPurchases)}
          </span>{" "}
          purchases · CPC{" "}
          <span className="font-medium text-foreground">
            {summary.blendedCpc != null ? fmtMoney(summary.blendedCpc) : "—"}
          </span>
        </>
      );
      break;
    case "traffic":
      headline = (
        <>
          <span className="font-medium text-foreground">
            {fmtNum(summary.totalLinkClicks)}
          </span>{" "}
          link clicks · CPC{" "}
          <span className="font-medium text-foreground">
            {summary.blendedCpc != null ? fmtMoney(summary.blendedCpc) : "—"}
          </span>
        </>
      );
      break;
    case "awareness":
      headline = (
        <>
          <span className="font-medium text-foreground">
            {fmtNum(summary.totalReach)}
          </span>{" "}
          reach · CPM{" "}
          <span className="font-medium text-foreground">
            {summary.blendedCpm != null ? fmtMoney(summary.blendedCpm) : "—"}
          </span>
        </>
      );
      break;
    case "engagement":
      headline = (
        <>
          Avg CTR{" "}
          <span className="font-medium text-foreground">
            {fmtPct(summary.avgCtr)}
          </span>
        </>
      );
      break;
    default:
      headline = (
        <>
          Avg CTR{" "}
          <span className="font-medium text-foreground">
            {fmtPct(summary.avgCtr)}
          </span>
        </>
      );
  }

  return (
    <div className="rounded-md border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{adsLabel}</span> ·{" "}
      <span className="font-medium text-foreground">
        {fmtMoney(summary.totalSpend)}
      </span>{" "}
      spend · {headline} ·{" "}
      <span className="font-medium text-foreground">{summary.fatigued}</span>{" "}
      flagged
    </div>
  );
}


// ─── Date preset chip group ─────────────────────────────────────────────────

function DatePresetChips({
  value,
  onChange,
  disabled,
}: {
  value: CreativeDatePreset;
  onChange: (next: CreativeDatePreset) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Date range"
      className="mt-3 flex flex-wrap items-center gap-1.5"
    >
      <span className="mr-1 text-xs text-muted-foreground">Window:</span>
      {DATE_PRESETS.map((p) => {
        const active = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            disabled={disabled}
            aria-pressed={active}
            className={[
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              "disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground",
            ].join(" ")}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Live-refresh progress bar ──────────────────────────────────────────────

/**
 * The cron-warmed cache returns in <1s, but a manual ?refresh=1 against
 * a 1k-ad account can take 30-60s. The skeleton-rows treatment that
 * works for the cache path leaves the user thinking the page froze on
 * the live path — so we replace it with a labelled progress bar that
 * fills linearly to 90% over 45s (the realistic p50) then holds at
 * 90% until the request resolves.
 *
 * The progress is intentionally honest about what it isn't: we cannot
 * know true progress without Meta telling us, and the spec says don't
 * label it "85% complete". Label is just "Refreshing…".
 */
function RefreshProgressBar() {
  const [pct, setPct] = useState(2);

  useEffect(() => {
    const startedAt = Date.now();
    const targetMs = 45_000;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const fraction = Math.min(elapsed / targetMs, 1);
      // Cap at 90% so the bar visibly waits on the network round-trip
      // rather than pretending we know when it'll arrive.
      setPct(2 + fraction * 88);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-2 rounded-md border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="inline-flex items-center gap-2 text-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Refreshing from Meta…
        </span>
        <span className="text-muted-foreground">
          This can take up to 2 minutes on large accounts.
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Refreshing from Meta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


// ─── Sortable header cell ───────────────────────────────────────────────────

/**
 * Click-to-sort `<th>` with `aria-sort` + a tiny arrow indicator. The
 * three-way cycle (asc → desc → unsorted) lives in the parent via
 * `nextSort` so the indicator only needs to render the current state.
 */
function SortableTh({
  label,
  sortKey,
  sort,
  onSortChange,
  align = "left",
  hint,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  align?: "left" | "right";
  /**
   * Optional aria-described tooltip text. When present, renders a
   * small ⓘ marker next to the label with `title=hint` so the user
   * can read it on hover. Used for the "Purchases" column to call
   * out that counts may be 0 outside sales-objective campaigns.
   */
  hint?: string;
}) {
  const ariaSort = ariaSortFor(sort, sortKey);
  const isActive = sort?.key === sortKey;
  const arrow = !isActive ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <th
      aria-sort={ariaSort}
      className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSortChange(sortKey)}
        className={[
          "inline-flex items-center gap-1 rounded px-1 py-0.5 text-muted-foreground hover:text-foreground",
          isActive ? "text-foreground" : "",
        ].join(" ")}
      >
        <span>{label}</span>
        {hint && (
          <span
            title={hint}
            aria-label={hint}
            className="cursor-help text-[10px] text-muted-foreground/70"
          >
            ⓘ
          </span>
        )}
        <span
          aria-hidden
          className={[
            "text-[9px] tabular-nums",
            isActive ? "opacity-100" : "opacity-40",
          ].join(" ")}
        >
          {arrow}
        </span>
      </button>
    </th>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────

/**
 * Catalog of every metric column the table can render. Order here is
 * the canonical column order — when an objective preset trims to a
 * subset we still render in this order so muscle memory survives the
 * column swap.
 */
interface MetricColumn {
  key: CreativeNumericMetric;
  label: string;
  format: "money" | "int" | "pct" | "ratio";
  /** Optional header tooltip — see SortableTh.hint. */
  hint?: string;
}

const METRIC_COLUMNS: MetricColumn[] = [
  { key: "spend", label: "Spend", format: "money" },
  { key: "impressions", label: "Impr.", format: "int" },
  { key: "reach", label: "Reach", format: "int" },
  { key: "ctr", label: "CTR", format: "pct" },
  { key: "cpm", label: "CPM", format: "money" },
  { key: "cpc", label: "CPC", format: "money" },
  { key: "frequency", label: "Freq.", format: "ratio" },
  { key: "linkClicks", label: "Link clicks", format: "int" },
  { key: "cpl", label: "CPL", format: "money" },
  { key: "registrations", label: "Reg.", format: "int" },
  { key: "cpr", label: "CPR", format: "money" },
  {
    key: "purchases",
    label: "Purchases",
    format: "int",
    hint: "Counted only on Sales / Conversion campaigns. Lead, traffic, awareness and engagement objectives will read 0 here — that's correct, not broken.",
  },
];

const ALL_METRIC_KEYS: CreativeNumericMetric[] = METRIC_COLUMNS.map((c) => c.key);

function formatMetric(
  value: number | null | undefined,
  format: "money" | "int" | "pct" | "ratio",
): string {
  if (value == null) return "—";
  if (format === "money") return fmtMoney(value);
  if (format === "pct") return fmtPct(value);
  if (format === "ratio") return Number(value).toFixed(2);
  return fmtNum(value);
}

function CreativesTable({
  rows,
  sort,
  onSortChange,
  onTagAdded,
  onTagRemoved,
  visibleMetrics,
}: {
  rows: CreativeInsightRow[];
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  onTagAdded: (adId: string, tag: CreativeInsightRow["tags"][number]) => void;
  onTagRemoved: (adId: string, tagId: string) => void;
  /** When null, render the full column catalog (objective='all'). */
  visibleMetrics: CreativeNumericMetric[] | null;
}) {
  const allowed = visibleMetrics ?? ALL_METRIC_KEYS;
  const columns = METRIC_COLUMNS.filter((c) => allowed.includes(c.key));

  // The page wrapper caps width at `max-w-6xl` (1152px). With 14+
  // columns the rightmost ones (Reg., CPR, Purchases) get squeezed
  // to nothing or clip outright. Force the inner table to a real
  // minimum so `overflow-x-auto` actually engages, and overlay a
  // subtle right-edge gradient as a scroll affordance — macOS hides
  // scrollbars by default and Matas was missing the affordance
  // entirely. The scrollbar gutter is reserved via Tailwind's
  // arbitrary `[scrollbar-gutter:stable]` so the layout doesn't jump
  // when content stops needing scroll.
  return (
    <div className="relative">
      <div className="overflow-x-auto rounded-md border border-border bg-card [scrollbar-gutter:stable]">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="border-b border-border bg-muted/30 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-medium">Creative</th>
              <th className="px-2 py-2 font-medium">Ad</th>
              {columns.map((col) => (
                <SortableTh
                  key={col.key}
                  label={col.label}
                  sortKey={col.key}
                  sort={sort}
                  onSortChange={onSortChange}
                  align="right"
                  hint={col.hint}
                />
              ))}
              <th className="px-2 py-2 font-medium">Fatigue</th>
              <th className="px-2 py-2 font-medium">Tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <CreativeRow
                key={row.adId}
                row={row}
                columns={columns}
                onTagAdded={onTagAdded}
                onTagRemoved={onTagRemoved}
              />
            ))}
          </tbody>
        </table>
      </div>
      {/*
       * Right-edge gradient that fades the table off into the card
       * background when there's more to scroll to. `pointer-events-none`
       * keeps it from blocking clicks on the rightmost cells; the
       * `from-card` matches the surface the table sits on so it's
       * invisible against an empty area.
       */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-md bg-gradient-to-l from-card to-transparent"
      />
    </div>
  );
}

function CreativeRow({
  row,
  columns,
  onTagAdded,
  onTagRemoved,
}: {
  row: CreativeInsightRow;
  columns: MetricColumn[];
  onTagAdded: (adId: string, tag: CreativeInsightRow["tags"][number]) => void;
  onTagRemoved: (adId: string, tagId: string) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const fatigueClasses =
    row.fatigueScore === "ok"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : row.fatigueScore === "warning"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        : "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";

  const removeTag = async (tagId: string) => {
    try {
      await fetch("/api/intelligence/creatives/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tagId }),
      });
      onTagRemoved(row.adId, tagId);
    } catch {
      // Network blip — leave the tag visible; user can retry.
    }
  };

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-2 py-2">
        {row.thumbnailUrl ? (
          <Image
            src={row.thumbnailUrl}
            alt={row.adName}
            width={40}
            height={40}
            unoptimized
            loading="lazy"
            className="h-10 w-10 rounded object-cover"
          />
        ) : (
          <div className="h-10 w-10 rounded bg-muted" />
        )}
      </td>
      <td className="px-2 py-2 max-w-[260px]">
        <div className="truncate font-medium text-foreground" title={row.adName}>
          {row.adName}
        </div>
        <div className="truncate text-[10px] text-muted-foreground" title={row.creativeName ?? ""}>
          {row.creativeName ?? row.creativeId ?? "—"}
        </div>
      </td>
      {columns.map((col) => (
        <td key={col.key} className="px-2 py-2 text-right tabular-nums">
          {formatMetric(row[col.key], col.format)}
        </td>
      ))}
      <td className="px-2 py-2">
        <span
          className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${fatigueClasses}`}
        >
          {row.fatigueScore}
        </span>
      </td>
      <td className="px-2 py-2 max-w-[220px]">
        <div className="flex flex-wrap items-center gap-1">
          {row.tags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void removeTag(t.id)}
              title="Remove tag"
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] hover:opacity-80 ${TAG_COLOR[t.type]}`}
            >
              <Tag className="h-2.5 w-2.5" />
              {t.value}
              <X className="h-2.5 w-2.5 opacity-60" />
            </button>
          ))}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPopoverOpen((o) => !o)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground"
              aria-label="Add tag"
            >
              <Plus className="h-3 w-3" />
            </button>
            {popoverOpen && (
              <TagPopover
                adId={row.adId}
                creativeId={row.creativeId}
                onClose={() => setPopoverOpen(false)}
                onAdded={(tag) => {
                  onTagAdded(row.adId, tag);
                  setPopoverOpen(false);
                }}
              />
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function TagPopover({
  adId,
  creativeId,
  onClose,
  onAdded,
}: {
  adId: string;
  creativeId: string | null;
  onClose: () => void;
  onAdded: (tag: { id: string; type: CreativeTagType; value: string }) => void;
}) {
  const [tagType, setTagType] = useState<CreativeTagType>("hook");
  const [tagValue, setTagValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const value = tagValue.trim();
    if (!value) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/intelligence/creatives/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaAdId: adId,
          metaCreativeId: creativeId,
          tagType,
          tagValue: value,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as {
        tag: { id: string; tag_type: CreativeTagType; tag_value: string };
      };
      onAdded({ id: j.tag.id, type: j.tag.tag_type, value: j.tag.tag_value });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save tag");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute right-0 top-6 z-20 w-64 space-y-2 rounded-md border border-border bg-card p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Add tag
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <Select
        value={tagType}
        onChange={(e) => setTagType(e.target.value as CreativeTagType)}
        options={TAG_TYPES}
      />
      <Input
        placeholder="Tag value"
        value={tagValue}
        onChange={(e) => setTagValue(e.target.value)}
        autoFocus
      />
      {err && <p className="text-[11px] text-destructive">{err}</p>}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={saving || !tagValue.trim()}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
