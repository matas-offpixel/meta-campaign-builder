"use client";

/**
 * lib/hooks/useMeta.ts
 *
 * Client-side hooks that fetch Meta assets from the internal /api/meta/*
 * route handlers. Each hook returns { data, loading, error }.
 *
 * These hooks are only for use inside Client Components.
 */

import { useState, useEffect } from "react";
import type {
  MetaAdAccount,
  MetaApiPage,
  MetaApiPixel,
  MetaInstagramAccount,
} from "@/lib/types";

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

export function useFetchPages(): MetaFetchState<MetaApiPage> {
  const [state, setState] = useState<MetaFetchState<MetaApiPage>>({
    data: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    apiFetch<MetaApiPage>("/api/meta/pages")
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
  }, []);

  return state;
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
