"use client";

import { useEffect, useState } from "react";

/**
 * lib/hooks/useClients.ts
 *
 * Client-side hook that fetches the current user's clients from
 * `GET /api/clients`. Mirrors the {data, loading, error} shape used by
 * useFetchAdAccounts (lib/hooks/useMeta.ts) so library / picker UIs
 * have a consistent loading model.
 */

export interface ClientPickerRow {
  id: string;
  name: string;
  slug: string;
  primary_type: string | null;
  status: string;
}

export interface UseFetchClientsState {
  clients: ClientPickerRow[];
  loading: boolean;
  error: string | null;
}

interface ClientsResponse {
  ok?: boolean;
  error?: string;
  clients?: ClientPickerRow[];
}

export function useFetchClients(): UseFetchClientsState {
  const [state, setState] = useState<UseFetchClientsState>({
    clients: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    fetch("/api/clients")
      .then(async (res) => {
        const json = (await res.json()) as ClientsResponse;
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setState({
            clients: json.clients ?? [],
            loading: false,
            error: null,
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load clients";
        setState({ clients: [], loading: false, error: msg });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
