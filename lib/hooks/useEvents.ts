"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * lib/hooks/useEvents.ts
 *
 * Client-side hook that fetches a client's events from
 * `GET /api/events?clientId=<id>`. Returns {events, loading, error}
 * plus a `reload()` callback so callers can refresh after creating an
 * event inline (the library's "New Campaign" picker uses it).
 *
 * When `clientId` is null/empty the hook resolves immediately to an
 * empty list — the caller doesn't have to special-case the
 * "no client picked yet" state.
 */

export interface EventPickerRow {
  id: string;
  name: string;
  slug: string;
  event_date: string | null;
  status: string;
  capacity: number | null;
  genres: string[];
  venue_name: string | null;
  venue_city: string | null;
  client_id: string;
  client_name: string | null;
}

export interface UseFetchEventsState {
  events: EventPickerRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface EventsResponse {
  ok?: boolean;
  error?: string;
  events?: EventPickerRow[];
}

interface FetchState {
  events: EventPickerRow[];
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: FetchState = { events: [], loading: false, error: null };

export function useFetchEventsForClient(
  clientId: string | null,
): UseFetchEventsState {
  // One state object so the loading→data transition is a single set
  // call from the network callback. Initial value already reflects
  // the no-clientId case, which avoids any reset-from-effect (which
  // the project's react-hooks/set-state-in-effect rule rejects).
  const [state, setState] = useState<FetchState>(() =>
    clientId
      ? { events: [], loading: true, error: null }
      : EMPTY_STATE,
  );
  // `reloadKey` increments to force the effect to re-run when the
  // caller wants a fresh fetch (e.g. after POST /api/events succeeds).
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    fetch(`/api/events?clientId=${encodeURIComponent(clientId)}`)
      .then(async (res) => {
        const json = (await res.json()) as EventsResponse;
        if (!res.ok || !json.ok) {
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
        if (!cancelled) {
          setState({ events: json.events ?? [], loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to load events";
        setState({ events: [], loading: false, error: msg });
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, reloadKey]);

  // When clientId flips back to null after we had data, return a clean
  // empty payload without poking state — the consumer doesn't care
  // about the stale data once they cleared the parent picker.
  const view = clientId ? state : EMPTY_STATE;

  return { ...view, reload };
}
