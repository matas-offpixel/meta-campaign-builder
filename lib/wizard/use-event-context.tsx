"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { EventWithClient } from "@/lib/db/events";
import type { ClientRow } from "@/lib/db/clients";
import { useFetchEvents, type EventPickerRow } from "@/lib/hooks/useEvents";
import type { CampaignDraft } from "@/lib/types";
import { applyEventEndToDraft, derivedEventEnd } from "@/lib/wizard/event-end-date";

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
  jsonEventId: string | null;
  columnEventId: string | null;
  resolvedEventId: string | null;
  carriersDisagree: boolean;
  /**
   * The event for `draftEventId`, from the same events list the Campaign
   * step's EVENT block uses. Null when that id is empty or still loading.
   */
  followsDraft: boolean;
  draftEventId: string | null;
  selectedEvent: EventPickerRow | null;
}

const EMPTY: WizardEventContextValue = {
  event: null,
  client: null,
  loaded: true,
  jsonEventId: null,
  columnEventId: null,
  resolvedEventId: null,
  carriersDisagree: false,
  followsDraft: false,
  draftEventId: null,
  selectedEvent: null,
};

const Ctx = createContext<WizardEventContextValue>(EMPTY);

export function WizardEventContextProvider({
  draftId,
  eventId = null,
  enabled,
  children,
}: {
  draftId: string;
  /**
   * The draft's current `settings.eventId`. The selected event follows
   * this, not the one-shot column read.
   */
  eventId?: string | null;
  /**
   * False until the parent has finished hydrating its draft. Avoids a
   * pre-hydration round-trip that races the draft load.
   */
  enabled: boolean;
  children: ReactNode;
}) {
  const [event, setEvent] = useState<EventWithClient | null>(null);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [jsonEventId, setJsonEventId] = useState<string | null>(null);
  const [columnEventId, setColumnEventId] = useState<string | null>(null);
  const [resolvedEventId, setResolvedEventId] = useState<string | null>(null);
  const [carriersDisagree, setCarriersDisagree] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const draftEventId = eventId?.trim() || null;
  const { events: draftEvents } = useFetchEvents(draftEventId);
  const selectedEvent = useMemo(
    () => draftEvents.find((row) => row.id === draftEventId) ?? null,
    [draftEvents, draftEventId],
  );

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
          jsonEventId?: string | null;
          columnEventId?: string | null;
          resolvedEventId?: string | null;
          carriersDisagree?: boolean;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setEvent(null);
          setClient(null);
          setJsonEventId(null);
          setColumnEventId(null);
          setResolvedEventId(null);
          setCarriersDisagree(false);
        } else {
          setEvent(json.event ?? null);
          setClient(json.client ?? null);
          setJsonEventId(json.jsonEventId ?? null);
          setColumnEventId(json.columnEventId ?? null);
          setResolvedEventId(json.resolvedEventId ?? null);
          setCarriersDisagree(json.carriersDisagree === true);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn(
          "[WizardEventContext] fetch failed:",
          err instanceof Error ? err.message : String(err),
        );
        setEvent(null);
        setClient(null);
        setJsonEventId(null);
        setColumnEventId(null);
        setResolvedEventId(null);
        setCarriersDisagree(false);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftId, enabled]);

  const value = useMemo<WizardEventContextValue>(
    () => ({
      event,
      client,
      loaded,
      jsonEventId,
      columnEventId,
      resolvedEventId,
      carriersDisagree,
      followsDraft: true,
      draftEventId,
      selectedEvent,
    }),
    [
      event,
      client,
      loaded,
      jsonEventId,
      columnEventId,
      resolvedEventId,
      carriersDisagree,
      draftEventId,
      selectedEvent,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWizardEventContext(): WizardEventContextValue {
  return useContext(Ctx);
}

/**
 * Writes the event end onto the draft when the attached event changes.
 * An operator-typed end date is left as it is.
 */
export function EventEndDateSync({
  draft,
  updateDraft,
}: {
  draft: CampaignDraft;
  updateDraft: (updater: (d: CampaignDraft) => CampaignDraft) => void;
}) {
  const { followsDraft, draftEventId, selectedEvent } = useWizardEventContext();
  const prev = useRef<{ id: string; date: string | null } | null>(null);

  useEffect(() => {
    if (!followsDraft || !draftEventId || !selectedEvent || selectedEvent.id !== draftEventId) {
      return;
    }
    const nextDate = selectedEvent.event_date;
    const previous = prev.current;
    const derived = derivedEventEnd(nextDate);
    const stored = draft.budgetSchedule.endDate ?? "";
    const source = draft.budgetSchedule.endDateSource;
    const eventMoved = !previous || previous.id !== draftEventId || previous.date !== nextDate;
    const derivedMissing = source === "event" && Boolean(derived) && stored !== derived;
    const shouldFill = !stored.trim() && source !== "operator" && Boolean(derived);
    if (!eventMoved && !derivedMissing && !shouldFill) return;
    const previousEventDate = previous && previous.id !== draftEventId ? previous.date : null;
    const synced = applyEventEndToDraft(draft, {
      previousEventDate,
      nextEventDate: nextDate,
    });
    prev.current = { id: draftEventId, date: nextDate };
    if (synced === draft) return;
    updateDraft((latest) =>
      applyEventEndToDraft(latest, {
        previousEventDate,
        nextEventDate: nextDate,
      }),
    );
  }, [followsDraft, draftEventId, selectedEvent, draft, updateDraft]);

  return null;
}
