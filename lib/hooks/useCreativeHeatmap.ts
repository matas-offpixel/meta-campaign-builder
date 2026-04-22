"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  CreativeDatePreset,
  CreativeInsightRow,
} from "@/lib/types/intelligence";
import type { MetaAdAccount } from "@/lib/types";

/**
 * lib/hooks/useCreativeHeatmap.ts
 *
 * Owns every piece of state the creative heatmap UI needs to talk to
 * `/api/intelligence/creatives`. The component itself is already past
 * 600 lines after H1 — extracting the fetch / cache / sort state
 * keeps H2's filter-bar reflow + sort + progress additions sane to
 * read.
 *
 * Surface area is intentionally narrow: filter inputs (`adAccountId`,
 * `datePreset`, `status`), the resulting row set + cache metadata, an
 * error model that survives the route's friendly mapping, and three
 * action verbs (`load`, `refresh`, `retry`). Tag mutations stay in
 * the component because they're tightly coupled to the row / popover
 * UI; lifting them up would just be ceremony.
 */

export type HeatmapErrorPath = "accounts" | "creatives" | null;

export interface HeatmapError {
  message: string;
  /** Surfaced from the route body; defaults to true on unstructured failures. */
  retryable: boolean;
}

/**
 * Internal-only error so the catch block can distinguish a structured
 * failure (parsed from the route's JSON body) from anything else
 * thrown along the way (network errors, JSON parse failures, etc.).
 * Mirrors the original `HeatmapFetchError` from the component
 * pre-extraction.
 */
class HeatmapFetchError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "HeatmapFetchError";
  }
}

interface CreativesResponse {
  creatives?: CreativeInsightRow[];
  snapshotAt?: string | null;
  needsRefresh?: boolean;
  source?: "cache" | "live";
}

export interface UseCreativeHeatmapResult {
  // ── Inputs ────────────────────────────────────────────────────────
  adAccountId: string;
  setAdAccountId: (next: string) => void;
  datePreset: CreativeDatePreset;
  setDatePreset: (next: CreativeDatePreset) => void;

  // ── Ad account list ───────────────────────────────────────────────
  adAccounts: MetaAdAccount[];
  adAccountsLoading: boolean;

  // ── Row set + cache metadata ──────────────────────────────────────
  /** `null` means "no fetch attempted yet"; an empty array is a real result. */
  rows: CreativeInsightRow[] | null;
  setRows: (
    update: (
      prev: CreativeInsightRow[] | null,
    ) => CreativeInsightRow[] | null,
  ) => void;
  snapshotAt: string | null;
  needsRefresh: boolean;
  /** `'cache'` for the default read; `'live'` for `?refresh=1`. */
  source: "cache" | "live" | null;

  // ── State ─────────────────────────────────────────────────────────
  loading: boolean;
  /** True when the in-flight request is the live `?refresh=1` path. */
  isRefreshing: boolean;
  error: HeatmapError | null;
  lastFailed: HeatmapErrorPath;

  // ── Verbs ─────────────────────────────────────────────────────────
  /** Cached read for the current `(adAccountId, datePreset)`. */
  load: () => Promise<void>;
  /** `?refresh=1` live fetch; writes through to the cache. */
  refresh: () => Promise<void>;
  /** Re-run whichever fetch produced the current error. */
  retry: () => Promise<void>;
}

export function useCreativeHeatmap(): UseCreativeHeatmapResult {
  const [adAccounts, setAdAccounts] = useState<MetaAdAccount[]>([]);
  const [adAccountsLoading, setAdAccountsLoading] = useState(true);
  const [adAccountId, setAdAccountId] = useState<string>("");
  const [datePreset, setDatePreset] = useState<CreativeDatePreset>("last_30d");

  const [rows, setRowsState] = useState<CreativeInsightRow[] | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [source, setSource] = useState<"cache" | "live" | null>(null);

  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<HeatmapError | null>(null);
  const [lastFailed, setLastFailed] = useState<HeatmapErrorPath>(null);

  // Pass-through setter so the component can do optimistic tag edits
  // without recreating the rows-array setState ergonomics.
  const setRows = useCallback(
    (
      update: (
        prev: CreativeInsightRow[] | null,
      ) => CreativeInsightRow[] | null,
    ) => {
      setRowsState((prev) => update(prev));
    },
    [],
  );

  // ── Ad accounts (mount + retry path) ─────────────────────────────
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
      setError({ message: msg, retryable: true });
      setLastFailed("accounts");
    } finally {
      setAdAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  // ── Fetch core ────────────────────────────────────────────────────
  const fetchCreatives = useCallback(
    async (refresh: boolean): Promise<void> => {
      if (!adAccountId) {
        setError({ message: "Choose an ad account first.", retryable: false });
        setLastFailed(null);
        return;
      }
      setLoading(true);
      setIsRefreshing(refresh);
      setError(null);
      setLastFailed(null);
      try {
        const sp = new URLSearchParams({ adAccountId, datePreset });
        if (refresh) sp.set("refresh", "1");
        const res = await fetch(
          `/api/intelligence/creatives?${sp.toString()}`,
          { cache: "no-store" },
        );
        if (!res.ok) {
          // The creatives route returns { ok:false, error, retryable, code?, fbtrace_id? }.
          // Default `retryable` to true for unstructured failures (network blip,
          // gateway) since GET is idempotent.
          const body = (await res.json().catch(() => null)) as
            | { error?: string; retryable?: boolean }
            | null;
          const message = body?.error ?? `HTTP ${res.status}`;
          const retryable =
            typeof body?.retryable === "boolean" ? body.retryable : true;
          throw new HeatmapFetchError(message, retryable);
        }
        const j = (await res.json()) as CreativesResponse;
        setRowsState(j.creatives ?? []);
        setSnapshotAt(j.snapshotAt ?? null);
        setNeedsRefresh(j.needsRefresh === true);
        setSource(j.source ?? null);
      } catch (err) {
        if (err instanceof HeatmapFetchError) {
          setError({ message: err.message, retryable: err.retryable });
        } else {
          setError({
            message:
              err instanceof Error ? err.message : "Failed to load creatives",
            retryable: true,
          });
        }
        setLastFailed("creatives");
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [adAccountId, datePreset],
  );

  const load = useCallback(() => fetchCreatives(false), [fetchCreatives]);
  const refresh = useCallback(() => fetchCreatives(true), [fetchCreatives]);

  // Auto-fire cached read when the account or preset changes. Cache
  // path is fast (single Postgres query) so the user gets immediate
  // feedback after picking either filter. Re-firing on every keystroke
  // would only matter if we surfaced a free-text filter — neither
  // input here is free text.
  useEffect(() => {
    if (!adAccountId) return;
    void fetchCreatives(false);
  }, [adAccountId, datePreset, fetchCreatives]);

  const retry = useCallback(async (): Promise<void> => {
    if (lastFailed === "accounts") {
      await loadAccounts();
    } else if (lastFailed === "creatives") {
      await fetchCreatives(false);
    }
  }, [lastFailed, loadAccounts, fetchCreatives]);

  return {
    adAccountId,
    setAdAccountId,
    datePreset,
    setDatePreset,
    adAccounts,
    adAccountsLoading,
    rows,
    setRows,
    snapshotAt,
    needsRefresh,
    source,
    loading,
    isRefreshing,
    error,
    lastFailed,
    load,
    refresh,
    retry,
  };
}
