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
      const res = await fetch("/api/auth/facebook-token");
      const json = (await res.json()) as { token?: string | null; error?: string };
      if (res.ok && json.token) {
        persistTokenForUser(user.id, json.token);
        return json.token;
      }
    } catch (e) {
      console.warn("[useFacebookToken] GET /api/auth/facebook-token failed:", e);
    }

    // 3 — session (right after OAuth exchange)
    const { data: sessionData } = await supabase.auth.getSession();
    const pt = sessionData.session?.provider_token ?? null;
    if (pt) {
      persistTokenForUser(user.id, pt);
      try {
        await fetch("/api/auth/facebook-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerToken: pt }),
        });
      } catch {
        /* non-fatal */
      }
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
          persistTokenForUser(uid, freshToken);
          setToken(freshToken);
          try {
            await fetch("/api/auth/facebook-token", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ providerToken: freshToken }),
            });
          } catch {
            /* ignore */
          }
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

export interface UserPagesFetchState {
  data: MetaApiPage[];
  loading: boolean;
  error: string | null;
  loaded: boolean;
  /** Total number of pages returned by Facebook */
  count: number;
  /** Trigger a fetch using the stored Facebook provider token */
  fetch: () => void;
}

/**
 * Manually-triggered hook that loads ALL pages the logged-in Facebook user
 * manages, using their provider_token. Not called on mount — consumer must
 * invoke `state.fetch()` (e.g. from a button click).
 *
 * Requires a prior Facebook OAuth login so a provider_token is available.
 */
export function useFetchUserPages(): UserPagesFetchState {
  const [data, setData] = useState<MetaApiPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [count, setCount] = useState(0);
  const { token, refresh } = useFacebookToken();

  const doFetch = useCallback(async () => {
    if (loading) return;

    setLoading(true);
    setError(null);

    // If we don't have a token yet, try refreshing from session
    let accessToken = token;
    if (!accessToken) {
      accessToken = await refresh();
    }

    if (!accessToken) {
      // Distinguish between "never logged in" and "logged in but token not captured"
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const hasSession = !!sessionData.session;
      const msg = hasSession
        ? "Facebook connection succeeded but no provider token was captured. Open Account Setup and use Connect Facebook again, or check the OAuth callback."
        : "Sign in with email first, then connect Facebook in Account Setup to load your pages.";
      console.warn("[useFetchUserPages]", msg, "| session:", hasSession, "| localStorage key:", FB_TOKEN_STORAGE_KEY);
      setError(msg);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/meta/pages/user", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const json = (await res.json()) as {
        data?: MetaApiPage[];
        count?: number;
        error?: string;
        code?: string;
      };

      if (!res.ok || json.error) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }

      setData(json.data ?? []);
      setCount(json.count ?? json.data?.length ?? 0);
      setLoaded(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load your Facebook pages";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [loading, token, refresh]);

  return { data, loading, error, loaded, count, fetch: doFetch };
}
