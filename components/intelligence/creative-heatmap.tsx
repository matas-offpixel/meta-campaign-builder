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

/** Columns the user can click-to-sort. Anchored at the table header. */
type SortKey =
  | "spend"
  | "impressions"
  | "ctr"
  | "cpm"
  | "cpc"
  | "frequency"
  | "cpl"
  | "purchases";

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

export function CreativeHeatmapPage() {
  const heatmap = useCreativeHeatmap();
  // Status filter stays component-local — it never round-trips to the
  // route, just shapes the rendered set.
  const [status, setStatus] = useState<string>("ALL");
  // Sort state is component-local for the same reason. Default sort
  // is ascending CPL (best leads first), matching pre-H2 behaviour.
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  return <CreativeHeatmapInner heatmap={heatmap} status={status} setStatus={setStatus} sort={sort} setSort={setSort} />;
}

function CreativeHeatmapInner({
  heatmap,
  status,
  setStatus,
  sort,
  setSort,
}: {
  heatmap: UseCreativeHeatmapResult;
  status: string;
  setStatus: (v: string) => void;
  sort: SortState;
  setSort: (next: SortState) => void;
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
    loading,
    isRefreshing,
    error,
    lastFailed,
    refresh,
    retry,
  } = heatmap;

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const filtered =
      status === "ALL"
        ? rows
        : rows.filter((r) => (r.status ?? "").toUpperCase() === status);
    return applySort(filtered, sort);
  }, [rows, status, sort]);

  const summary = useMemo(() => {
    if (!filteredRows) return null;
    const totalSpend = filteredRows.reduce((s, r) => s + r.spend, 0);
    const totalImpr = filteredRows.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = filteredRows.reduce((s, r) => s + r.clicks, 0);
    const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
    const fatigued = filteredRows.filter((r) => r.fatigueScore !== "ok").length;
    return { count: filteredRows.length, totalSpend, avgCtr, fatigued };
  }, [filteredRows]);

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
      {loading && !isRefreshing && (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
      )}

      {filteredRows && !loading && summary && (
        <>
          <div className="rounded-md border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {summary.count}
            </span>{" "}
            ads ·{" "}
            <span className="font-medium text-foreground">
              {fmtMoney(summary.totalSpend)}
            </span>{" "}
            total spend · Avg CTR{" "}
            <span className="font-medium text-foreground">
              {fmtPct(summary.avgCtr)}
            </span>{" "}
            ·{" "}
            <span className="font-medium text-foreground">
              {summary.fatigued}
            </span>{" "}
            creative{summary.fatigued === 1 ? "" : "s"} flagged as fatigued
          </div>

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
            />
          )}
        </>
      )}
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
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  align?: "left" | "right";
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

function CreativesTable({
  rows,
  sort,
  onSortChange,
  onTagAdded,
  onTagRemoved,
}: {
  rows: CreativeInsightRow[];
  sort: SortState;
  onSortChange: (key: SortKey) => void;
  onTagAdded: (adId: string, tag: CreativeInsightRow["tags"][number]) => void;
  onTagRemoved: (adId: string, tagId: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full text-xs">
        <thead className="border-b border-border bg-muted/30 text-left text-muted-foreground">
          <tr>
            <th className="px-2 py-2 font-medium">Creative</th>
            <th className="px-2 py-2 font-medium">Ad</th>
            <SortableTh label="Spend" sortKey="spend" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="Impr." sortKey="impressions" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="CTR" sortKey="ctr" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="CPM" sortKey="cpm" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="CPC" sortKey="cpc" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="Freq." sortKey="frequency" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="CPL" sortKey="cpl" sort={sort} onSortChange={onSortChange} align="right" />
            <SortableTh label="Purchases" sortKey="purchases" sort={sort} onSortChange={onSortChange} align="right" />
            <th className="px-2 py-2 font-medium">Fatigue</th>
            <th className="px-2 py-2 font-medium">Tags</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CreativeRow
              key={row.adId}
              row={row}
              onTagAdded={onTagAdded}
              onTagRemoved={onTagRemoved}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreativeRow({
  row,
  onTagAdded,
  onTagRemoved,
}: {
  row: CreativeInsightRow;
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
      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(row.spend)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtNum(row.impressions)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtPct(row.ctr)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(row.cpm)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(row.cpc)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{row.frequency.toFixed(2)}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {row.cpl != null ? fmtMoney(row.cpl) : "—"}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtNum(row.purchases)}</td>
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
