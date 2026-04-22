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

// ─── Client-side snapshot layer ─────────────────────────────────────
//
// Persists the last-loaded row set per (adAccountId, datePreset) in
// localStorage so an accidental browser refresh on a £5,583-spend,
// 2 000-ad heatmap doesn't nuke the view and force the user to wait
// out another multi-minute Meta fetch. The server-side write-through
// in `app/api/intelligence/creatives/route.ts` is best-effort
// (swallows upsert errors), so the client cache is the only reliable
// fallback for "I already saw this; show it to me again".
//
// Versioned key prefix so a future schema change to CreativeInsightRow
// can be invalidated wholesale without manual user action.

const SNAPSHOT_KEY_PREFIX = "creative-heatmap:v1";

interface ClientSnapshot {
  rows: CreativeInsightRow[];
  snapshotAt: string | null;
  source: "cache" | "live" | null;
  savedAt: string;
}

function snapshotKey(adAccountId: string, datePreset: CreativeDatePreset): string {
  return `${SNAPSHOT_KEY_PREFIX}:${adAccountId}:${datePreset}`;
}

function readSnapshot(
  adAccountId: string,
  datePreset: CreativeDatePreset,
): ClientSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(snapshotKey(adAccountId, datePreset));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientSnapshot> | null;
    if (
      !parsed ||
      !Array.isArray(parsed.rows) ||
      typeof parsed.savedAt !== "string"
    ) {
      return null;
    }
    return {
      rows: parsed.rows,
      snapshotAt: parsed.snapshotAt ?? null,
      source: parsed.source ?? null,
      savedAt: parsed.savedAt,
    };
  } catch {
    // Quota error, JSON parse failure, Safari private mode — treat as
    // cache miss rather than letting the hook crash on mount.
    return null;
  }
}

function writeSnapshot(
  adAccountId: string,
  datePreset: CreativeDatePreset,
  snapshot: ClientSnapshot,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      snapshotKey(adAccountId, datePreset),
      JSON.stringify(snapshot),
    );
  } catch {
    // Quota / private mode — best-effort, the in-memory state still
    // works for this session.
  }
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
  /**
   * `savedAt` of the localStorage snapshot currently backing `rows`,
   * or `null` when `rows` came from a fresh server response (or no
   * snapshot exists yet). Lets the UI render "Showing cached
   * snapshot · 12 mins ago" while a slow Meta fetch is in flight.
   */
  snapshotSavedAt: string | null;

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
  // Default window is "last_7d" rather than "last_30d" so a cold
  // page load asks Meta for one week of insights instead of a month.
  // Pairs with the "Active" status default to keep the first request
  // under Meta's rate-limit threshold on heavy accounts; "Last 30d"
  // and "All time" remain available as opt-in chips.
  const [datePreset, setDatePreset] = useState<CreativeDatePreset>("last_7d");

  const [rows, setRowsState] = useState<CreativeInsightRow[] | null>(null);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [source, setSource] = useState<"cache" | "live" | null>(null);
  const [snapshotSavedAt, setSnapshotSavedAt] = useState<string | null>(null);

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
        const incoming = j.creatives ?? [];
        const incomingNeedsRefresh = j.needsRefresh === true;

        // Regression guard: when the server cache is cold it returns
        // `{ creatives: [], needsRefresh: true }`. The previous
        // implementation unconditionally `setRowsState(j.creatives)`,
        // which wiped whatever was on screen — including the local
        // snapshot we just hydrated from. Surface the refresh CTA
        // (snapshotAt / needsRefresh / source) without touching rows
        // when the server is telling us "I have nothing fresh".
        const shouldOverwriteRows =
          !(incoming.length === 0 && incomingNeedsRefresh);
        if (shouldOverwriteRows) {
          setRowsState(incoming);
        }
        setSnapshotAt(j.snapshotAt ?? null);
        setNeedsRefresh(incomingNeedsRefresh);
        setSource(j.source ?? null);

        // Write-through to the client snapshot. Only persist non-empty
        // result sets — an empty `[]` is either a cold cache or a real
        // "no ads in this window" answer; either way overwriting a
        // populated snapshot would defeat the whole point of this
        // layer. We persist the cache-source response too because
        // hydrating from it on the next page load is exactly the same
        // shape the server would have returned.
        if (incoming.length > 0) {
          const savedAt = new Date().toISOString();
          writeSnapshot(adAccountId, datePreset, {
            rows: incoming,
            snapshotAt: j.snapshotAt ?? null,
            source: j.source ?? null,
            savedAt,
          });
          setSnapshotSavedAt(savedAt);
        }
      } catch (err) {
        // `rows` is intentionally not touched here — the previous-state
        // snapshot stays on screen so a transient network blip doesn't
        // empty the heatmap. The error banner + Try-again button are
        // the user-facing recovery path.
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

  // Hydrate the client snapshot for the new (account, preset) pair
  // BEFORE the network fetch fires. Synchronous read inside the
  // effect — React batches the state updates with the fetch trigger
  // below, so the user never sees a flash of empty state when
  // there's a valid snapshot on disk. The fetch then runs in the
  // background and either confirms the snapshot (server cache hit
  // with newer data) or leaves rows untouched (cold-cache path,
  // see fetchCreatives' `shouldOverwriteRows` guard).
  useEffect(() => {
    if (!adAccountId) {
      setRowsState(null);
      setSnapshotAt(null);
      setNeedsRefresh(false);
      setSource(null);
      setSnapshotSavedAt(null);
      return;
    }
    const snap = readSnapshot(adAccountId, datePreset);
    if (snap) {
      setRowsState(snap.rows);
      setSnapshotAt(snap.snapshotAt);
      setSource(snap.source);
      setSnapshotSavedAt(snap.savedAt);
      setNeedsRefresh(false);
    } else {
      setRowsState(null);
      setSnapshotAt(null);
      setNeedsRefresh(false);
      setSource(null);
      setSnapshotSavedAt(null);
    }
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
    snapshotSavedAt,
    loading,
    isRefreshing,
    error,
    lastFailed,
    load,
    refresh,
    retry,
  };
}
