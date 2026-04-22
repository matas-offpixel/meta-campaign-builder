"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Tag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  CreativeInsightRow,
  CreativeTagType,
} from "@/lib/types/intelligence";
import type { MetaAdAccount } from "@/lib/types";

/**
 * Surfaced error shape for the heatmap's two read paths.
 * `retryable` drives whether the destructive banner shows a "Try
 * again" button. The mount fetch (ad accounts) is always treated as
 * retryable because `/api/meta/ad-accounts` shares the same
 * `graphGetWithToken` retry/transient code path that the creatives
 * route uses, so the same Meta rate-limit blip can hit either.
 */
type HeatmapError = { message: string; retryable: boolean } | null;

/**
 * Internal-only error so the catch block can distinguish a structured
 * failure (parsed from the route's JSON body) from anything else
 * thrown along the way (network errors, JSON parse failures, etc.).
 */
class HeatmapFetchError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "HeatmapFetchError";
  }
}

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

function defaultDate(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function CreativeHeatmapPage() {
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [adAccountsLoading, setAdAccountsLoading] = useState(true);
  const [adAccountId, setAdAccountId] = useState<string>("");
  const [since, setSince] = useState(defaultDate(30));
  const [until, setUntil] = useState(defaultDate(0));
  const [status, setStatus] = useState<string>("ALL");

  const [rows, setRows] = useState<CreativeInsightRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<HeatmapError>(null);
  // Tracks which fetch path produced the current error so the "Try
  // again" button knows what to re-run. `null` whenever there is no
  // active error or the error is non-retryable user input.
  const [lastFailed, setLastFailed] = useState<"accounts" | "creatives" | null>(
    null,
  );

  // Load ad accounts on mount so the dropdown is populated by the time
  // the user lands on the page. Wrapped in a useCallback so the
  // "Try again" button can re-invoke it without re-running the whole
  // mount effect.
  const loadAccounts = useCallback(async (): Promise<void> => {
    setAdAccountsLoading(true);
    try {
      const res = await fetch("/api/meta/ad-accounts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { data: MetaAdAccount[] };
      setAdAccounts(j.data ?? []);
    } catch (err) {
      const msg =
        err instanceof Error
          ? `Couldn't load ad accounts: ${err.message}`
          : "Couldn't load ad accounts.";
      // /api/meta/ad-accounts goes through the same graphGetWithToken
      // retry path as the creatives route — if it still failed, the
      // most likely cause is a transient Meta hiccup that's worth
      // letting the user retry by hand.
      setError({ message: msg, retryable: true });
      setLastFailed("accounts");
    } finally {
      setAdAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const loadCreatives = useCallback(async (): Promise<void> => {
    if (!adAccountId) {
      // User-error, not a Meta failure — no point offering retry.
      setError({ message: "Choose an ad account first.", retryable: false });
      setLastFailed(null);
      return;
    }
    setLoading(true);
    setError(null);
    setLastFailed(null);
    try {
      const sp = new URLSearchParams({ adAccountId, since, until });
      const res = await fetch(
        `/api/intelligence/creatives?${sp.toString()}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        // The creatives route now returns
        //   { ok: false, error, retryable, code?, fbtrace_id? }
        // Honour `retryable` when present, fall back to true on
        // unstructured failures (network blip, gateway) since reads
        // are idempotent and a retry is harmless.
        const body = (await res.json().catch(() => null)) as
          | { error?: string; retryable?: boolean }
          | null;
        const message = body?.error ?? `HTTP ${res.status}`;
        const retryable =
          typeof body?.retryable === "boolean" ? body.retryable : true;
        throw new HeatmapFetchError(message, retryable);
      }
      const j = (await res.json()) as { creatives: CreativeInsightRow[] };
      setRows(j.creatives ?? []);
    } catch (err) {
      if (err instanceof HeatmapFetchError) {
        setError({ message: err.message, retryable: err.retryable });
      } else {
        setError({
          message: err instanceof Error ? err.message : "Failed to load creatives",
          retryable: true,
        });
      }
      setLastFailed("creatives");
    } finally {
      setLoading(false);
    }
  }, [adAccountId, since, until]);

  const handleRetry = useCallback((): void => {
    if (lastFailed === "accounts") {
      void loadAccounts();
    } else if (lastFailed === "creatives") {
      void loadCreatives();
    }
  }, [lastFailed, loadAccounts, loadCreatives]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const filtered = status === "ALL"
      ? rows
      : rows.filter((r) => (r.status ?? "").toUpperCase() === status);
    // Ascending CPL with nulls last so the best-performing ads land at top.
    return [...filtered].sort((a, b) => {
      if (a.cpl == null && b.cpl == null) return b.spend - a.spend;
      if (a.cpl == null) return 1;
      if (b.cpl == null) return -1;
      return a.cpl - b.cpl;
    });
  }, [rows, status]);

  const summary = useMemo(() => {
    if (!filteredRows) return null;
    const totalSpend = filteredRows.reduce((s, r) => s + r.spend, 0);
    const totalImpr = filteredRows.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = filteredRows.reduce((s, r) => s + r.clicks, 0);
    const avgCtr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
    const fatigued = filteredRows.filter((r) => r.fatigueScore !== "ok").length;
    return { count: filteredRows.length, totalSpend, avgCtr, fatigued };
  }, [filteredRows]);

  const handleTagAdded = (adId: string, tag: CreativeInsightRow["tags"][number]) => {
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
          <Select
            label="Ad account"
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value)}
            placeholder={adAccountsLoading ? "Loading…" : "Choose ad account"}
            disabled={adAccountsLoading}
            options={adAccounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.currency})`,
            }))}
          />
          <Input
            label="Since"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
          <Input
            label="Until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={STATUS_FILTERS}
          />
          <div className="flex items-end">
            <Button
              onClick={() => void loadCreatives()}
              disabled={loading || !adAccountId}
              size="sm"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Load creatives
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          <span className="leading-relaxed">{error.message}</span>
          {error.retryable && lastFailed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRetry()}
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

      {loading && (
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
              onTagAdded={handleTagAdded}
              onTagRemoved={handleTagRemoved}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────

function CreativesTable({
  rows,
  onTagAdded,
  onTagRemoved,
}: {
  rows: CreativeInsightRow[];
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
            <th className="px-2 py-2 font-medium text-right">Spend</th>
            <th className="px-2 py-2 font-medium text-right">Impr.</th>
            <th className="px-2 py-2 font-medium text-right">CTR</th>
            <th className="px-2 py-2 font-medium text-right">CPM</th>
            <th className="px-2 py-2 font-medium text-right">CPC</th>
            <th className="px-2 py-2 font-medium text-right">Freq.</th>
            <th className="px-2 py-2 font-medium text-right">CPL</th>
            <th className="px-2 py-2 font-medium text-right">Purchases</th>
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
