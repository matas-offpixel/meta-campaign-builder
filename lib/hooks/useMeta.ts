"use client";

/**
 * lib/hooks/useMeta.ts
 *
 * Client-side hooks that fetch Meta assets from the internal /api/meta/*
 * route handlers. Each hook returns { data, loading, error }.
 *
 * These hooks are only for use inside Client Components.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  MetaAdAccount,
  MetaApiPage,
  MetaApiPageBatch,
  MetaApiPixel,
  MetaInstagramAccount,
  CustomAudience,
  PagePost,
  MetaCampaignSummary,
  MetaCampaignsResponse,
} from "@/lib/types";
import {
  FB_TOKEN_STORAGE_KEY,
  parseStoredFacebookToken,
  serializeStoredFacebookToken,
  type StoredFacebookToken,
} from "@/lib/facebook-token-storage";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface MetaFetchState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
}

type IGWithPage = MetaInstagramAccount & { linkedPageId: string };

// ─── Shared fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  const json = (await res.json()) as { data?: T[]; error?: string };

  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  return json.data ?? [];
}

// ─── useFetchAdAccounts ───────────────────────────────────────────────────────

export function useFetchAdAccounts(): MetaFetchState<MetaAdAccount> {
  const [state, setState] = useState<MetaFetchState<MetaAdAccount>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    apiFetch<MetaAdAccount>("/api/meta/ad-accounts")
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to load ad accounts";
          setState({ data: [], loading: false, error: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ─── useFetchPages ────────────────────────────────────────────────────────────

/**
 * Fetches Business Manager pages when `adAccountId` is provided (passes it to
 * the route which resolves the business and calls /{businessId}/owned_pages).
 * Without `adAccountId` falls back to /me/accounts.
 */
export function useFetchPages(
  adAccountId?: string,
): MetaFetchState<MetaApiPage> {
  const [state, setState] = useState<MetaFetchState<MetaApiPage>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ data: [], loading: true, error: null });

    const url = adAccountId
      ? `/api/meta/pages?adAccountId=${encodeURIComponent(adAccountId)}`
      : "/api/meta/pages";

    apiFetch<MetaApiPage>(url)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to load pages";
          setState({ data: [], loading: false, error: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adAccountId]);

  return state;
}

// ─── useFetchAdditionalPages ──────────────────────────────────────────────────

export interface AdditionalPagesState {
  /** Accumulated pages across all loaded batches */
  pages: MetaApiPage[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  /** How many pages have been loaded so far */
  loaded: number;
  /** Triggers the next batch load */
  loadMore: () => void;
}

/**
 * Manages cursor-based batch loading of personal pages from /me/accounts.
 * On the first call `loadMore()` fetches the first batch of 50.
 * Each subsequent call advances the cursor until `hasMore` is false.
 *
 * Pass `excludeIds` to filter out pages already shown in the business section.
 */
export function useFetchAdditionalPages(
  excludeIds?: Set<string>,
): AdditionalPagesState {
  const [pages, setPages] = useState<MetaApiPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;

    setLoading(true);
    setError(null);

    const url = nextCursor
      ? `/api/meta/pages/additional?after=${encodeURIComponent(nextCursor)}&limit=50`
      : "/api/meta/pages/additional?limit=50";

    fetch(url)
      .then(async (res) => {
        const json = (await res.json()) as MetaApiPageBatch & { error?: string };
        if (!res.ok || json.error) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }

        const incoming = excludeIds
          ? json.data.filter((p) => !excludeIds.has(p.id))
          : json.data;

        setPages((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          return [...prev, ...incoming.filter((p) => !existing.has(p.id))];
        });
        setNextCursor(json.nextCursor);
        setHasMore(json.hasMore);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to load additional pages";
        setError(msg);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [loading, hasMore, nextCursor, excludeIds]);

  return { pages, loading, error, hasMore, loaded: pages.length, loadMore };
}

// ─── useFetchPixels ───────────────────────────────────────────────────────────

/**
 * Fetches pixels for the given ad account.
 * Pass undefined/empty string to skip fetching (returns empty state).
 */
export function useFetchPixels(
  adAccountId: string | undefined,
): MetaFetchState<MetaApiPixel> {
  const [state, setState] = useState<MetaFetchState<MetaApiPixel>>({
    data: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!adAccountId) {
      setState({ data: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ data: [], loading: true, error: null });

    apiFetch<MetaApiPixel>(
      `/api/meta/pixels?adAccountId=${encodeURIComponent(adAccountId)}`,
    )
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to load pixels";
          setState({ data: [], loading: false, error: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adAccountId]);

  return state;
}

// ─── useFetchInstagramAccounts ────────────────────────────────────────────────

export function useFetchInstagramAccounts(): MetaFetchState<IGWithPage> {
  const [state, setState] = useState<MetaFetchState<IGWithPage>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    apiFetch<IGWithPage>("/api/meta/instagram-accounts")
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            err instanceof Error
              ? err.message
              : "Failed to load Instagram accounts";
          setState({ data: [], loading: false, error: msg });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ─── useFetchPagePosts ────────────────────────────────────────────────────────

/**
 * Discriminated UI state for the existing-post picker. Each value maps to a
 * concrete render branch in `components/steps/creatives.tsx`:
 *
 *   idle    — no pageId yet (or hook disabled); render the "select a page" hint
 *   loading — request in flight
 *   success — at least one usable post returned
 *   empty   — request succeeded but the page has no eligible published posts
 *   error   — request failed (network or Meta API error)
 */
export type PagePostsStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error";

export interface PagePostsState {
  status: PagePostsStatus;
  data: PagePost[];
  error: string | null;
  /** Manually re-run the fetch (e.g. for a "Try again" button). */
  refetch: () => void;
}

interface UseFetchPagePostsOptions {
  /** When false the hook stays in `idle` and never fetches. */
  enabled?: boolean;
  /** Hard cap on posts returned by the API. Defaults to the server default. */
  limit?: number;
}

/**
 * Loads recent published posts for the given Facebook Page. The hook:
 *   - returns `idle` when disabled or `pageId` is empty (no fetch issued)
 *   - cancels in-flight requests when `pageId` changes
 *   - logs `pageId` + outcome to the browser console for debugging
 */
export function useFetchPagePosts(
  pageId: string | undefined,
  options: UseFetchPagePostsOptions = {},
): PagePostsState {
  const { enabled = true, limit } = options;

  const [inner, setInner] = useState<{
    status: PagePostsStatus;
    data: PagePost[];
    error: string | null;
  }>({ status: "idle", data: [], error: null });

  // Bumping this counter re-runs the fetch effect for a manual refetch.
  const [refetchCounter, setRefetchCounter] = useState(0);
  const refetch = useCallback(() => setRefetchCounter((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !pageId) {
      setInner({ status: "idle", data: [], error: null });
      return;
    }

    const controller = new AbortController();
    setInner({ status: "loading", data: [], error: null });

    const params = new URLSearchParams({ pageId });
    if (limit) params.set("limit", String(limit));
    const url = `/api/meta/page-posts?${params.toString()}`;

    console.log(`[useFetchPagePosts] fetch start pageId=${pageId}`);

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as { data?: PagePost[]; error?: string };
        if (!res.ok || json.error) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        const data = Array.isArray(json.data) ? json.data : [];
        console.log(
          `[useFetchPagePosts] fetch success pageId=${pageId} count=${data.length}`,
        );
        setInner({
          status: data.length === 0 ? "empty" : "success",
          data,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Failed to load posts";
        console.error(
          `[useFetchPagePosts] fetch failure pageId=${pageId} reason=${msg}`,
        );
        setInner({ status: "error", data: [], error: msg });
      });

    return () => controller.abort();
  }, [pageId, enabled, limit, refetchCounter]);

  return { ...inner, refetch };
}

// ─── useFetchCampaigns ────────────────────────────────────────────────────────

/**
 * Discriminated UI state for the "Add to existing campaign" picker. Mirrors
 * {@link PagePostsStatus} so the picker can mount the right empty / loading /
 * error branch without re-deriving state.
 */
export type CampaignsStatus =
  | "idle"
  | "loading"
  | "success"
  | "empty"
  | "error";

export interface CampaignsState {
  status: CampaignsStatus;
  data: MetaCampaignSummary[];
  error: string | null;
  /** True when at least one more page is available from the API. */
  hasMore: boolean;
  /** Re-run the fetch from page 1 with the current filter / search. */
  refetch: () => void;
  /** Append the next page of results, if any. No-op when `!hasMore`. */
  loadMore: () => void;
  /** True while a `loadMore` request is in flight. */
  loadingMore: boolean;
}

interface UseFetchCampaignsOptions {
  enabled?: boolean;
  /** "relevant" (active+paused, recency-sorted) | "all". */
  filter?: "relevant" | "all";
  /** Case-insensitive substring match on campaign name. */
  search?: string;
  /** Initial page size — server-capped at 50. */
  limit?: number;
}

/**
 * Live-fetches Meta campaigns under the given ad account for the picker.
 * Supports server-side cursor pagination via `loadMore()`. Cancels in-flight
 * requests when the inputs (account / filter / search) change so the UI
 * never displays stale results.
 */
export function useFetchCampaigns(
  adAccountId: string | undefined,
  options: UseFetchCampaignsOptions = {},
): CampaignsState {
  const { enabled = true, filter = "relevant", search, limit = 25 } = options;

  const [inner, setInner] = useState<{
    status: CampaignsStatus;
    data: MetaCampaignSummary[];
    error: string | null;
    hasMore: boolean;
    nextCursor?: string;
  }>({ status: "idle", data: [], error: null, hasMore: false });

  const [loadingMore, setLoadingMore] = useState(false);
  const [refetchCounter, setRefetchCounter] = useState(0);
  const refetch = useCallback(() => setRefetchCounter((n) => n + 1), []);

  // Stable ref to the latest cursor so `loadMore` doesn't depend on `inner`
  // (which would close over a stale value otherwise). Updated via effect
  // (not during render) to satisfy the React Hooks ref rules.
  const cursorRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    cursorRef.current = inner.nextCursor;
  }, [inner.nextCursor]);

  const buildUrl = useCallback(
    (after?: string): string => {
      const params = new URLSearchParams({
        adAccountId: adAccountId ?? "",
        filter,
        limit: String(limit),
      });
      if (search?.trim()) params.set("search", search.trim());
      if (after) params.set("after", after);
      return `/api/meta/campaigns?${params.toString()}`;
    },
    [adAccountId, filter, limit, search],
  );

  // First-page fetch — re-runs whenever inputs change or `refetch` is called.
  useEffect(() => {
    if (!enabled || !adAccountId) {
      setInner({ status: "idle", data: [], error: null, hasMore: false });
      return;
    }

    const controller = new AbortController();
    setInner({ status: "loading", data: [], error: null, hasMore: false });

    console.log(
      `[useFetchCampaigns] fetch start adAccountId=${adAccountId} filter=${filter}` +
        ` search=${search ?? "-"}`,
    );

    fetch(buildUrl(), { signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as Partial<MetaCampaignsResponse> & {
          error?: string;
        };
        if (!res.ok || json.error) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        const data = Array.isArray(json.data) ? json.data : [];
        const hasMore = Boolean(json.paging?.hasMore);
        console.log(
          `[useFetchCampaigns] fetch success adAccountId=${adAccountId}` +
            ` count=${data.length} hasMore=${hasMore}`,
        );
        setInner({
          status: data.length === 0 ? "empty" : "success",
          data,
          error: null,
          hasMore,
          nextCursor: json.paging?.after,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load campaigns";
        console.error(
          `[useFetchCampaigns] fetch failure adAccountId=${adAccountId} reason=${msg}`,
        );
        setInner({
          status: "error",
          data: [],
          error: msg,
          hasMore: false,
        });
      });

    return () => controller.abort();
  }, [adAccountId, enabled, filter, search, limit, refetchCounter, buildUrl]);

  const loadMore = useCallback(() => {
    const after = cursorRef.current;
    if (!enabled || !adAccountId || !after || loadingMore) return;

    setLoadingMore(true);
    console.log(
      `[useFetchCampaigns] loadMore start adAccountId=${adAccountId} after=yes`,
    );

    fetch(buildUrl(after))
      .then(async (res) => {
        const json = (await res.json()) as Partial<MetaCampaignsResponse> & {
          error?: string;
        };
        if (!res.ok || json.error) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        const more = Array.isArray(json.data) ? json.data : [];
        const hasMore = Boolean(json.paging?.hasMore);
        console.log(
          `[useFetchCampaigns] loadMore success adAccountId=${adAccountId}` +
            ` added=${more.length} hasMore=${hasMore}`,
        );
        setInner((prev) => ({
          ...prev,
          status: "success",
          data: [...prev.data, ...more],
          hasMore,
          nextCursor: json.paging?.after,
        }));
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error ? err.message : "Failed to load more campaigns";
        console.error(
          `[useFetchCampaigns] loadMore failure adAccountId=${adAccountId} reason=${msg}`,
        );
        // Don't blow away the existing data on a paging failure — surface
        // the error and let the user retry.
        setInner((prev) => ({ ...prev, error: msg }));
      })
      .finally(() => setLoadingMore(false));
  }, [adAccountId, enabled, loadingMore, buildUrl]);

  return {
    status: inner.status,
    data: inner.data,
    error: inner.error,
    hasMore: inner.hasMore,
    refetch,
    loadMore,
    loadingMore,
  };
}

// ─── useFetchCustomAudiences ──────────────────────────────────────────────────

export interface CustomAudiencesFetchState {
  data: CustomAudience[];
  loading: boolean;
  error: string | null;
  /** True once a successful fetch has completed */
  loaded: boolean;
  /** Call to trigger a fetch (or re-fetch). No-ops when already loading. */
  fetch: () => void;
}

/**
 * Manually-triggered hook — audiences are NOT fetched on mount.
 * The consumer must call `state.fetch()` explicitly (e.g. from a button click).
 *
 * If `adAccountId` is absent the fetch is skipped and an error hint is set.
 * Refetches automatically if `adAccountId` changes after a previous load.
 */
export function useFetchCustomAudiences(
  adAccountId: string | undefined,
): CustomAudiencesFetchState {
  const [data, setData] = useState<CustomAudience[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Reset when ad account changes so stale data is never shown
  useEffect(() => {
    setData([]);
    setLoaded(false);
    setError(null);
  }, [adAccountId]);

  const doFetch = useCallback(() => {
    if (loading) return;

    if (!adAccountId) {
      setError("Select an ad account first to load custom audiences.");
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/meta/custom-audiences?adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(async (res) => {
        const json = (await res.json()) as { data?: CustomAudience[]; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json.data ?? []);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load custom audiences";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [loading, adAccountId]);

  return { data, loading, error, loaded, fetch: doFetch };
}

// ─── useFetchSavedAudiences ───────────────────────────────────────────────────

export interface SavedAudienceItem {
  id: string;
  name: string;
  approximateCount?: number;
  description?: string;
}

export interface SavedAudiencesFetchState {
  data: SavedAudienceItem[];
  loading: boolean;
  error: string | null;
  /** True once a successful fetch has completed */
  loaded: boolean;
  /** Call to trigger a fetch (or re-fetch). No-ops when already loading. */
  fetch: () => void;
}

/**
 * Manually-triggered hook for fetching Saved Audiences from a Meta ad account.
 * Saved Audiences are pre-configured targeting bundles created in Ads Manager —
 * distinct from Custom Audiences (pixel/upload lists).
 *
 * The consumer must call `state.fetch()` explicitly (e.g. from a button click).
 */
export function useFetchSavedAudiences(
  adAccountId: string | undefined,
): SavedAudiencesFetchState {
  const [data, setData] = useState<SavedAudienceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Reset when ad account changes so stale data is never shown
  useEffect(() => {
    setData([]);
    setLoaded(false);
    setError(null);
  }, [adAccountId]);

  const doFetch = useCallback(() => {
    if (loading) return;

    if (!adAccountId) {
      setError("Select an ad account first to load saved audiences.");
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/meta/saved-audiences?adAccountId=${encodeURIComponent(adAccountId)}`)
      .then(async (res) => {
        const json = (await res.json()) as { data?: SavedAudienceItem[]; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json.data ?? []);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load saved audiences";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [loading, adAccountId]);

  return { data, loading, error, loaded, fetch: doFetch };
}

// ─── Location search hook ────────────────────────────────────────────────────

export interface LocationSearchResult {
  key: string;
  name: string;
  type: string;
  country_code: string;
  country_name: string;
  region: string;
  region_id?: number;
}

export function useLocationSearch(): {
  results: LocationSearchResult[];
  loading: boolean;
  error: string | null;
  search: (query: string) => void;
  clear: () => void;
} {
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((query: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query || query.trim().length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/meta/location-search?q=${encodeURIComponent(query.trim())}&types=city,region,country`,
        );
        const json = (await res.json()) as { data?: LocationSearchResult[]; error?: string };
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        setResults(json.data ?? []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Location search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setResults([]);
    setError(null);
    setLoading(false);
  }, []);

  return { results, loading, error, search, clear };
}

// ─── Facebook provider token management ───────────────────────────────────────

/** Re-export for callers that imported from useMeta before. */
export { FB_TOKEN_STORAGE_KEY } from "@/lib/facebook-token-storage";

function persistTokenForUser(userId: string, providerToken: string): void {
  const entry: StoredFacebookToken = { userId, token: providerToken };
  localStorage.setItem(FB_TOKEN_STORAGE_KEY, serializeStoredFacebookToken(entry));
}

/**
 * Manages the Facebook provider_token for the signed-in Supabase user.
 *
 * Order of resolution:
 *   1. localStorage JSON `{ userId, token }` matching current user
 *   2. GET /api/auth/facebook-token (Supabase `user_facebook_tokens` row)
 *   3. `session.provider_token` from getSession() (briefly after OAuth)
 */
export function useFacebookToken(): {
  token: string | null;
  loading: boolean;
  refresh: () => Promise<string | null>;
} {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const resolveToken = useCallback(async (): Promise<string | null> => {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setToken(null);
      return null;
    }

    // 1 — localStorage (user-scoped)
    const raw = typeof window !== "undefined" ? localStorage.getItem(FB_TOKEN_STORAGE_KEY) : null;
    const parsed = parseStoredFacebookToken(raw);
    if (parsed?.userId === user.id && parsed.token) {
      return parsed.token;
    }

    // 2 — server-persisted token for this user
    try {
      const res = await fetch("/api/auth/facebook-token", { credentials: "same-origin" });
      const json = (await res.json()) as {
        token?: string | null;
        step?: string;
        error?: string;
        diagnostic?: { message?: string; code?: string; details?: string; hint?: string; hintText?: string };
      };

      if (res.status === 401) {
        console.warn("[useFacebookToken] GET facebook-token: not authenticated", json.step, json.error);
        return null;
      }

      if (json.token) {
        persistTokenForUser(user.id, json.token);
        console.info("[useFacebookToken] loaded token from Supabase storage");
        return json.token;
      }

      if (json.diagnostic) {
        console.warn(
          "[useFacebookToken] GET facebook-token: no row or DB issue —",
          json.step ?? "unknown",
          json.diagnostic.message,
          json.diagnostic.hintText ?? "",
        );
      } else if (!res.ok) {
        console.warn("[useFacebookToken] GET facebook-token HTTP", res.status, json);
      }
    } catch (e) {
      console.warn("[useFacebookToken] GET /api/auth/facebook-token network error:", e);
    }

    // 3 — session (briefly present right after OAuth exchange in the same tab)
    // Note: provider_token is NOT persisted by Supabase across page loads.
    // The server callback route (/auth/facebook-callback) is responsible for
    // writing it to user_facebook_tokens during the exchange, so we only
    // cache it in localStorage here — no secondary POST needed.
    const { data: sessionData } = await supabase.auth.getSession();
    const pt = sessionData.session?.provider_token ?? null;
    if (pt) {
      persistTokenForUser(user.id, pt);
      return pt;
    }

    return null;
  }, []);

  const refresh = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    try {
      const t = await resolveToken();
      setToken(t);
      console.debug("[useFacebookToken] refresh —", t ? "token present" : "no token");
      return t;
    } finally {
      setLoading(false);
    }
  }, [resolveToken]);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    (async () => {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      await refresh();

      const { data } = supabase.auth.onAuthStateChange(async (_event, session) => {
        const uid = session?.user?.id;
        const freshToken = session?.provider_token ?? null;
        if (uid && freshToken) {
          // Cache in localStorage; DB persistence is handled by the server callback.
          persistTokenForUser(uid, freshToken);
          setToken(freshToken);
        }
      });
      subscription = data.subscription;
    })();

    return () => {
      subscription?.unsubscribe();
    };
  }, [refresh]);

  return { token, loading, refresh };
}

/** True once loading finishes and a Facebook provider token exists for the user. */
export function useFacebookConnectionStatus(): {
  connected: boolean;
  loading: boolean;
  refresh: () => Promise<string | null>;
} {
  const { token, loading, refresh } = useFacebookToken();
  return { connected: !!token, loading, refresh };
}

// ─── useFetchUserPages ────────────────────────────────────────────────────────

// ── LocalStorage cache ───────────────────────────────────────────────────────

const PAGES_CACHE_KEY = "meta_user_pages_v2";
const PAGES_CACHE_EXPIRY_MS = 24 * 60 * 60 * 1_000; // 24 hours

/**
 * "test"   — first 10 pages only, enrichment skipped (fast smoke-test).
 * "sample" — first 50 pages, fully enriched. Good default for most users.
 * "all"    — every accessible page until cursor exhausted, fully enriched.
 */
export type PageLoadMode = "test" | "sample" | "all";

/** Page counts targeted by each load mode. null = unlimited. */
export const PAGE_LOAD_MODE_LIMITS: Record<PageLoadMode, number | null> = {
  test:   10,
  sample: 50,
  all:    null,
};

interface PagesCache {
  v: 2;
  data: MetaApiPage[];
  count: number;
  batchesLoaded: number;
  enrichComplete: boolean;
  loadedAt: number; // Unix ms timestamp
  loadMode?: PageLoadMode;
  enrichmentSkipped?: boolean;
}

function readPagesCache(): PagesCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PAGES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PagesCache;
    if (parsed.v !== 2 || !Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePagesCache(entry: Omit<PagesCache, "v">): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PAGES_CACHE_KEY, JSON.stringify({ v: 2, ...entry }));
  } catch {
    // localStorage quota exceeded or unavailable — silent fail
  }
}

/**
 * Returns currently cached user pages (from localStorage), or an empty array.
 * Safe to call from any client component without triggering a fetch.
 */
export function getCachedUserPages(): import("@/lib/types").MetaApiPage[] {
  return readPagesCache()?.data ?? [];
}

/**
 * Persist capability failures back into the pages cache after a launch run.
 * Call this from the review-launch UI when `LaunchSummary.engagementAudiencesFailed`
 * contains items with `isPermissionFailure: true`.
 *
 * The next time the page list is shown, `inferCapabilities()` in
 * page-audiences-panel will read these stored flags and show the correct badges.
 */
export function markPageCapabilityFailures(
  failures: Array<{
    pageId: string;
    type: string;          // e.g. "fb_likes", "fb_engagement_365d", "ig_followers"
    isPermissionFailure: boolean;
    isNoInstagram: boolean; // true when the failure was "No linked Instagram"
  }>,
): void {
  if (typeof window === "undefined") return;
  const cache = readPagesCache();
  if (!cache) return;

  // Group failures by page ID
  const byPageId = new Map<string, typeof failures>();
  for (const f of failures) {
    if (!byPageId.has(f.pageId)) byPageId.set(f.pageId, []);
    byPageId.get(f.pageId)!.push(f);
  }
  if (byPageId.size === 0) return;

  const updated = cache.data.map((page) => {
    const pageFails = byPageId.get(page.id);
    if (!pageFails || pageFails.length === 0) return page;

    const caps: import("@/lib/types").PageCapabilities = page.capabilities ?? {
      standardPageAudience: true,
      fbLikesSource: true,
      fbEngagementSource: true,
      igFollowersSource: !!(page.hasInstagramLinked),
      igEngagementSource: !!(page.hasInstagramLinked),
      lookalikeEligible: true,
      failureReasons: {},
    };

    const reasons: Record<string, string> = { ...(caps.failureReasons ?? {}) };

    for (const f of pageFails) {
      if (f.isPermissionFailure) {
        if (f.type === "fb_likes") {
          caps.fbLikesSource = false;
          reasons.fbLikesSource = "No permission for event source (FB Likes)";
        } else if (f.type === "fb_engagement_365d") {
          caps.fbEngagementSource = false;
          reasons.fbEngagementSource = "No permission for event source (FB Engagement)";
        }
      }
      if (f.isNoInstagram) {
        caps.igFollowersSource = false;
        caps.igEngagementSource = false;
        reasons.igFollowersSource = "No linked Instagram account";
        reasons.igEngagementSource = "No linked Instagram account";
      }
    }

    // If no FB or IG source audiences are available, mark lookalike as ineligible
    if (!caps.fbLikesSource && !caps.fbEngagementSource && !caps.igFollowersSource && !caps.igEngagementSource) {
      caps.lookalikeEligible = false;
      reasons.lookalikeEligible = "No valid engagement source audiences available";
    }

    return { ...page, capabilities: { ...caps, failureReasons: reasons } };
  });

  writePagesCache({ ...cache, data: updated });
}

/** Hard limit: stop after this many list-batches (~10 000 pages). */
const MAX_LIST_BATCHES = 200;
/** Hard time limit for the entire operation (listing + enrichment). */
const MAX_RUNTIME_MS = 90_000;
/** Pages per enrichment API call. */
const ENRICH_CHUNK = 50;

export type UserPagesLoadStatus =
  | "idle"
  | "listing"     // Phase 1: fetching page list
  | "enriching"   // Phase 2: enriching with pictures/followers/Instagram
  | "done"
  | "partial"     // completed with some failures (list or enrich)
  | "error";      // failed with zero usable data

export interface RateLimitInfo {
  appCallCountPct: number | null;
  businessCallCountPct: number | null;
  raw: { appUsage: string | null; pageUsage: string | null; businessUsage: string | null };
}

export interface UserPagesFetchState {
  /** Accumulated pages — updated live after every batch/enrich chunk */
  data: MetaApiPage[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  count: number;
  /** List batches completed */
  batchesLoaded: number;
  /** Enrichment chunks completed */
  enrichChunksDone: number;
  /** Total enrichment chunks needed (set at start of Phase 2) */
  enrichChunksTotal: number;
  loadStatus: UserPagesLoadStatus;
  failedAtBatch?: number;
  /** True if enrichment fell back to basic fields (no Instagram) */
  enrichFallback?: boolean;
  /** Timestamp of when the current page list was loaded from Meta */
  loadedAt: Date | null;
  /** Whether pages were loaded from the local cache (not a live fetch) */
  fromCache: boolean;
  /** Most-recent rate-limit header values from Meta */
  rateLimit: RateLimitInfo | null;
  /** True while waiting out a rate-limit backoff before retrying */
  rateLimitWaiting: boolean;
  /** Remaining wait time in ms during a rate-limit backoff */
  rateLimitWaitMs: number | null;
  /** Which load mode was used for the current data */
  loadMode: PageLoadMode | null;
  /**
   * True when pages were loaded in "test" mode and enrichment was skipped.
   * Call enrich() to run Phase 2 enrichment on the existing data.
   */
  enrichmentSkipped: boolean;
  /** Manual trigger — fetches pages using the given mode (default "all") */
  fetch: (mode?: PageLoadMode) => void;
  /** Run enrichment on already-listed pages (useful after "test" mode). */
  enrich: () => void;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

import type { EnrichedPageData } from "@/app/api/meta/pages/enrich/route";
import type { UserPagesBatchResponse } from "@/app/api/meta/pages/user/route";

/** Backoff delays for rate-limit retries: 10 s, 30 s, 60 s. */
const RATE_LIMIT_BACKOFFS_MS = [10_000, 30_000, 60_000];
const MAX_RATE_LIMIT_RETRIES = RATE_LIMIT_BACKOFFS_MS.length;

/**
 * Manually-triggered hook that loads Facebook pages in two phases:
 *   Phase 1 — batch-list (id, name) until cursor or page-count target exhausted
 *   Phase 2 — enrich 50 pages at a time (picture, followers, Instagram)
 *             (skipped for "test" mode — call enrich() to run later)
 *
 * Load modes:
 *   "test"   — 10 pages, no enrichment (fastest, no rate-limit risk)
 *   "sample" — 50 pages, full enrichment (good default)
 *   "all"    — unlimited pages until cursor exhausted, full enrichment
 *
 * State updates after every batch / chunk so the UI shows live progress.
 *
 * Persistence: page data is cached in localStorage (key: meta_user_pages_v2)
 * and hydrated on mount. Navigating away and back restores all loaded pages
 * and enrichment data without re-fetching.
 */
export function useFetchUserPages(): UserPagesFetchState {
  const [data, setData] = useState<MetaApiPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [count, setCount] = useState(0);
  const [batchesLoaded, setBatchesLoaded] = useState(0);
  const [enrichChunksDone, setEnrichChunksDone] = useState(0);
  const [enrichChunksTotal, setEnrichChunksTotal] = useState(0);
  const [loadStatus, setLoadStatus] = useState<UserPagesLoadStatus>("idle");
  const [failedAtBatch, setFailedAtBatch] = useState<number | undefined>(undefined);
  const [enrichFallback, setEnrichFallback] = useState<boolean | undefined>(undefined);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [rateLimitWaiting, setRateLimitWaiting] = useState(false);
  const [rateLimitWaitMs, setRateLimitWaitMs] = useState<number | null>(null);
  const [loadMode, setLoadMode] = useState<PageLoadMode | null>(null);
  const [enrichmentSkipped, setEnrichmentSkipped] = useState(false);

  // Ref to let enrich() access current data/token without stale closure
  const dataRef = useRef<MetaApiPage[]>([]);
  const { token, refresh } = useFacebookToken();

  // ── Hydrate from localStorage on first mount ──────────────────────────────
  useEffect(() => {
    const cache = readPagesCache();
    if (!cache || cache.data.length === 0) return;

    dataRef.current = cache.data;
    setData(cache.data);
    setCount(cache.count);
    setBatchesLoaded(cache.batchesLoaded);
    setLoaded(true);
    setFromCache(true);
    setLoadedAt(new Date(cache.loadedAt));
    setLoadMode(cache.loadMode ?? "all");
    setEnrichmentSkipped(cache.enrichmentSkipped ?? false);
    setLoadStatus(cache.enrichComplete ? "done" : "partial");
    console.info(
      `[useFetchUserPages] hydrated from cache — ${cache.count} pages,`,
      `mode: ${cache.loadMode ?? "unknown"},`,
      `loaded at ${new Date(cache.loadedAt).toLocaleTimeString()},`,
      cache.enrichComplete ? "fully enriched" : (cache.enrichmentSkipped ? "enrichment skipped" : "partial enrichment"),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Shared enrichment logic (used by both doFetch and enrich) ─────────────
  const runEnrichment = useCallback(async (
    pages: MetaApiPage[],
    accessToken: string,
    startedAt: number,
    batchNum: number,
    mode: PageLoadMode,
  ): Promise<MetaApiPage[]> => {
    const chunks = chunkArray(pages.map((p) => p.id), ENRICH_CHUNK);
    setEnrichChunksTotal(chunks.length);
    setLoadStatus("enriching");

    let enrichedPages: MetaApiPage[] = [...pages];
    let anyFallback = false;
    let enrichChunk = 0;

    for (const ids of chunks) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        console.warn("[useFetchUserPages] enrichment timed out — returning partially enriched list");
        break;
      }

      enrichChunk++;
      console.info(`[useFetchUserPages] enrich chunk ${enrichChunk}/${chunks.length} (${ids.length} pages)`);

      try {
        const res = await fetch("/api/meta/pages/enrich", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ ids }),
        });

        const enrichJson = (await res.json()) as {
          data?: Record<string, EnrichedPageData>;
          stats?: Record<string, number>;
          fallback?: boolean;
          error?: string;
        };

        if (enrichJson.fallback) anyFallback = true;

        if (enrichJson.data) {
          enrichedPages = enrichedPages.map((p) => {
            const enriched = enrichJson.data![p.id];
            if (!enriched) return p;
            // When the enrich call fell back to basic fields (no IG data), we must
            // NOT overwrite hasInstagramLinked with false — the previous value (from
            // a prior full-enrich run, or the raw API fields) is more accurate.
            const enrichFellBack = !!enrichJson.fallback;
            const merged = {
              ...p,
              pictureUrl:         enriched.pictureUrl         ?? p.pictureUrl,
              facebookFollowers:  enriched.facebookFollowers  ?? p.facebookFollowers,
              // IG fields: only overwrite when we actually requested IG data
              instagramAccountId: enrichFellBack ? p.instagramAccountId : (enriched.instagramAccountId ?? p.instagramAccountId),
              instagramUsername:  enrichFellBack ? p.instagramUsername  : (enriched.instagramUsername  ?? p.instagramUsername),
              instagramFollowers: enrichFellBack ? p.instagramFollowers : (enriched.instagramFollowers ?? p.instagramFollowers),
              hasInstagramLinked: enrichFellBack ? p.hasInstagramLinked : (enriched.hasInstagramLinked ?? p.hasInstagramLinked),
              igLinkSource: enrichFellBack
                ? p.igLinkSource
                : ((enriched as { igLinkSource?: "instagram_business_account" | "connected_instagram_account" | null }).igLinkSource ?? p.igLinkSource),
            };
            if (enriched.hasInstagramLinked) {
              console.info(
                `[useFetchUserPages] page ${p.id} (${p.name}): IG linked via` +
                ` ${(enriched as { igLinkSource?: string }).igLinkSource ?? "unknown"} →` +
                ` igId=${enriched.instagramAccountId}`,
              );
            }
            return merged;
          });
          dataRef.current = enrichedPages;
          setData([...enrichedPages]);
        }
      } catch (enrichErr) {
        console.warn(`[useFetchUserPages] enrich chunk ${enrichChunk} failed (non-fatal):`, enrichErr);
      }

      setEnrichChunksDone(enrichChunk);
    }

    if (anyFallback) setEnrichFallback(true);

    const withIg = enrichedPages.filter((p) => p.hasInstagramLinked).length;
    console.info(
      `[useFetchUserPages] Phase 2 complete — ${enrichChunk} chunks, Instagram linked: ${withIg}/${enrichedPages.length}`,
    );

    // Update cache with enriched data
    writePagesCache({
      data: enrichedPages,
      count: enrichedPages.length,
      batchesLoaded: batchNum,
      enrichComplete: true,
      loadedAt: Date.now(),
      loadMode: mode,
      enrichmentSkipped: false,
    });
    setEnrichmentSkipped(false);

    return enrichedPages;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const doFetch = useCallback(async (mode: PageLoadMode = "all") => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setData([]);
    dataRef.current = [];
    setCount(0);
    setBatchesLoaded(0);
    setEnrichChunksDone(0);
    setEnrichChunksTotal(0);
    setLoaded(false);
    setFromCache(false);
    setLoadStatus("listing");
    setFailedAtBatch(undefined);
    setEnrichFallback(undefined);
    setRateLimit(null);
    setRateLimitWaiting(false);
    setRateLimitWaitMs(null);
    setLoadMode(mode);
    setEnrichmentSkipped(false);

    let accessToken = token;
    if (!accessToken) accessToken = await refresh();

    if (!accessToken) {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const hasSession = !!sessionData.session;
      const msg = hasSession
        ? "Facebook connection succeeded but no provider token was captured. Open Account Setup and use Connect Facebook again."
        : "Sign in with email first, then connect Facebook in Account Setup to load your pages.";
      console.warn("[useFetchUserPages]", msg, "| hasSession:", hasSession);
      setError(msg);
      setLoadStatus("error");
      setLoading(false);
      return;
    }

    const startedAt = Date.now();
    const pageLimit = PAGE_LOAD_MODE_LIMITS[mode]; // null = unlimited
    // For test/sample modes, request exactly the target count in one call.
    // For "all", use the standard 50-per-batch paging loop.
    const batchSize = mode === "test" ? 10 : 50;
    const maxBatches = mode === "all" ? MAX_LIST_BATCHES : 1;

    console.info(`[useFetchUserPages] start — mode=${mode}, batchSize=${batchSize}, pageLimit=${pageLimit ?? "∞"}`);

    // ════════════════════════════════════════════════════════════════════════
    // Phase 1: List pages (id + name)
    // ════════════════════════════════════════════════════════════════════════
    const accumulated: MetaApiPage[] = [];
    let cursor: string | null = null;
    let batchNum = 0;
    let listFailed = false;
    let rateLimitRetries = 0;

    while (batchNum < maxBatches) {
      if (Date.now() - startedAt > MAX_RUNTIME_MS) {
        console.warn(`[useFetchUserPages] hit ${MAX_RUNTIME_MS}ms safety timeout after ${batchNum} batches`);
        setLoadStatus(accumulated.length > 0 ? "partial" : "error");
        setError(`Timed out after ${batchNum} batches (${accumulated.length} pages loaded).`);
        listFailed = true;
        break;
      }

      batchNum++;
      const urlParams = new URLSearchParams({ batchSize: String(batchSize) });
      if (cursor) urlParams.set("after", cursor);
      const url = `/api/meta/pages/user?${urlParams.toString()}`;

      console.info(`[useFetchUserPages] list batch ${batchNum}/${maxBatches === 1 ? "1" : "max"} — so far: ${accumulated.length}`);

      let res: Response;
      let json: UserPagesBatchResponse & { error?: string };
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        json = (await res.json()) as typeof json;
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : "Network error";
        console.error(`[useFetchUserPages] list batch ${batchNum} network error:`, fetchErr);
        setError(`Batch ${batchNum} failed: ${msg}`);
        setFailedAtBatch(batchNum);
        setLoadStatus(accumulated.length > 0 ? "partial" : "error");
        listFailed = true;
        break;
      }

      if (json.rateLimit) setRateLimit(json.rateLimit);

      // ── Rate limit hit → exponential backoff ──────────────────────────────
      if (json.rateLimitHit) {
        if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
          const msg = "Meta API request limit reached. Please wait a few minutes and reload.";
          console.warn(`[useFetchUserPages] rate limit — max retries exhausted (${rateLimitRetries})`);
          setError(msg);
          setFailedAtBatch(batchNum);
          setLoadStatus(accumulated.length > 0 ? "partial" : "error");
          listFailed = true;
          break;
        }

        const waitMs = RATE_LIMIT_BACKOFFS_MS[rateLimitRetries] ?? 60_000;
        rateLimitRetries++;
        console.warn(
          `[useFetchUserPages] rate limit hit — retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES}`,
          `waiting ${waitMs / 1000}s…`,
        );
        setRateLimitWaiting(true);
        setRateLimitWaitMs(waitMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        setRateLimitWaiting(false);
        setRateLimitWaitMs(null);
        batchNum--;
        continue;
      }

      // ── Non-rate-limit error ──────────────────────────────────────────────
      if (!res.ok || json.error) {
        const msg = json.error ?? `HTTP ${res.status}`;
        console.error(`[useFetchUserPages] list batch ${batchNum} error:`, json);
        setError(`Batch ${batchNum} failed: ${msg}`);
        setFailedAtBatch(batchNum);
        setLoadStatus(accumulated.length > 0 ? "partial" : "error");
        listFailed = true;
        break;
      }

      // ── Success ───────────────────────────────────────────────────────────
      rateLimitRetries = 0;
      const batch = json.data ?? [];
      accumulated.push(...batch);
      dataRef.current = [...accumulated];
      setData([...accumulated]);
      setCount(accumulated.length);
      setBatchesLoaded(batchNum);

      console.info(
        `[useFetchUserPages] list batch ${batchNum} OK — got ${batch.length},`,
        `total ${accumulated.length}, nextCursor: ${json.nextCursor ? "yes" : "none"}`,
        json.rateLimit?.appCallCountPct != null ? `app-usage: ${json.rateLimit.appCallCountPct}%` : "",
      );

      cursor = json.nextCursor ?? null;
      // Stop if: no more pages, OR we've hit the page target for this mode
      if (!cursor) break;
      if (pageLimit !== null && accumulated.length >= pageLimit) break;
    }

    if (!accumulated.length) {
      setLoadStatus("error");
      if (!error) setError("No pages were returned by Facebook.");
      setLoading(false);
      return;
    }

    console.info(
      `[useFetchUserPages] Phase 1 complete — ${accumulated.length} pages in ${batchNum} batches. mode=${mode}`,
    );

    const now = Date.now();
    setLoadedAt(new Date(now));

    // ════════════════════════════════════════════════════════════════════════
    // Phase 2: Enrich — skipped for "test" mode
    // ════════════════════════════════════════════════════════════════════════
    if (mode === "test") {
      // Save minimal cache (enrichment pending)
      writePagesCache({
        data: accumulated,
        count: accumulated.length,
        batchesLoaded: batchNum,
        enrichComplete: false,
        loadedAt: now,
        loadMode: mode,
        enrichmentSkipped: true,
      });
      setEnrichmentSkipped(true);
      setLoaded(true);
      setLoadStatus("done");
      setLoading(false);
      return;
    }

    // Save Phase 1 result to cache immediately (enrichment pending)
    writePagesCache({
      data: accumulated,
      count: accumulated.length,
      batchesLoaded: batchNum,
      enrichComplete: false,
      loadedAt: now,
      loadMode: mode,
      enrichmentSkipped: false,
    });

    await runEnrichment(accumulated, accessToken, startedAt, batchNum, mode);

    setLoaded(true);
    setLoadStatus(listFailed ? "partial" : "done");
    setLoading(false);
  }, [loading, token, refresh, runEnrichment]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Post-hoc enrichment — called from UI after "test" mode load ───────────
  const doEnrich = useCallback(async () => {
    if (loading || dataRef.current.length === 0) return;

    let accessToken = token;
    if (!accessToken) accessToken = await refresh();
    if (!accessToken) {
      setError("No Facebook token — reconnect Facebook before enriching pages.");
      return;
    }

    setLoading(true);
    setError(null);
    setEnrichmentSkipped(false);

    await runEnrichment(
      dataRef.current,
      accessToken,
      Date.now(),
      batchesLoaded,
      loadMode ?? "all",
    );

    setLoaded(true);
    setLoadStatus("done");
    setLoading(false);
  }, [loading, token, refresh, batchesLoaded, loadMode, runEnrichment]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data,
    loading,
    error,
    loaded,
    count,
    batchesLoaded,
    enrichChunksDone,
    enrichChunksTotal,
    loadStatus,
    failedAtBatch,
    enrichFallback,
    loadedAt,
    fromCache,
    rateLimit,
    rateLimitWaiting,
    rateLimitWaitMs,
    loadMode,
    enrichmentSkipped,
    fetch: doFetch,
    enrich: doEnrich,
  };
}
