"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { EventWithClient } from "@/lib/db/events";
import type { ClientRow } from "@/lib/db/clients";

/**
 * lib/wizard/use-event-context.tsx
 *
 * React context that exposes the wizard's resolved event + client (if
 * any) to every step. Hydrated once via /api/wizard/event-context after
 * the wizard's draft load completes, then never mutated for the
 * lifetime of the wizard mount.
 *
 * Loaded === false until the fetch resolves; consumers should wait
 * before applying defaults so they don't race the user's first
 * interaction.
 */

export interface WizardEventContextValue {
  event: EventWithClient | null;
  client: ClientRow | null;
  loaded: boolean;
}

const EMPTY: WizardEventContextValue = {
  event: null,
  client: null,
  loaded: true,
};

const Ctx = createContext<WizardEventContextValue>(EMPTY);

export function WizardEventContextProvider({
  draftId,
  enabled,
  children,
}: {
  draftId: string;
  /**
   * False until the parent has finished hydrating its draft. Avoids a
   * pre-hydration round-trip that races the draft load.
   */
  enabled: boolean;
  children: ReactNode;
}) {
  const [event, setEvent] = useState<EventWithClient | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || !draftId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/wizard/event-context?draftId=${encodeURIComponent(draftId)}`,
          { credentials: "same-origin" },
        );
        const json = (await res.json()) as {
          ok?: boolean;
          event?: EventWithClient | null;
          client?: ClientRow | null;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setEvent(null);
          setClient(null);
        } else {
          setEvent(json.event ?? null);
          setClient(json.client ?? null);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn(
          "[WizardEventContext] fetch failed:",
          err instanceof Error ? err.message : String(err),
        );
        setEvent(null);
        setClient(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, enabled]);

  const value = useMemo<WizardEventContextValue>(
    () => ({ event, client, loaded }),
    [event, client, loaded],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWizardEventContext(): WizardEventContextValue {
  return useContext(Ctx);
}
