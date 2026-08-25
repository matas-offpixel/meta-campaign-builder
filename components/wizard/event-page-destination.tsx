"use client";

import { useCallback, useEffect, useState } from "react";

import {
  canonicalLandingPageUrl,
  resolveCanonicalLandingPage,
  type CanonicalLandingPage,
} from "@/lib/landing-pages/canonical-url";
import type { EventLandingPageRecord } from "@/lib/landing-pages/event-lookup";
import {
  canAutoFillDestinationUrl,
  destinationUrlsMatch,
  OFF_FUNNEL_NUDGE,
  shouldNudgeOffFunnel,
  USE_EVENT_PAGE_WHY,
} from "@/lib/wizard/lp-destination";
import type { WizardDestinationUrlFieldId } from "@/lib/wizard/lp-destination-fields";

/**
 * Offer (never force) the event landing page as the ad destination.
 * Shared by every Meta + TikTok destination-URL field.
 */

type Snapshot = {
  record: EventLandingPageRecord | null;
  resolved: CanonicalLandingPage;
  url: string | null;
};

const cache = new Map<string, Snapshot>();
const listeners = new Set<() => void>();

function emitCache() {
  for (const listener of listeners) listener();
}

function snapshotFromRecord(
  record: EventLandingPageRecord | null,
  origin: string,
): Snapshot {
  if (!record) {
    const resolved: CanonicalLandingPage = { kind: "none" };
    return { record: null, resolved, url: null };
  }
  const resolved = resolveCanonicalLandingPage({
    hasPage: record.hasPage,
    clientSlug: record.clientSlug,
    eventSlug: record.eventSlug,
    publicOrigin: origin,
    customHost: record.customHost,
  });
  return { record, resolved, url: canonicalLandingPageUrl(resolved) };
}

function publicOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function EventPageDestination({
  fieldId,
  eventId,
  value,
  onChange,
}: {
  fieldId: WizardDestinationUrlFieldId;
  eventId: string | null | undefined;
  value: string;
  onChange: (url: string) => void;
}) {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onCache = () => setVersion((n) => n + 1);
    listeners.add(onCache);
    return () => {
      listeners.delete(onCache);
    };
  }, []);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    const cached = cache.get(eventId);
    if (cached) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/wizard/event-landing-page?eventId=${encodeURIComponent(eventId)}`,
          { credentials: "same-origin" },
        );
        const json = (await res.json()) as {
          ok?: boolean;
          record?: EventLandingPageRecord | null;
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError("Couldn’t load the event page.");
          return;
        }
        cache.set(eventId, snapshotFromRecord(json.record ?? null, publicOrigin()));
        emitCache();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn’t load the event page.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, version]);

  const applyUrl = useCallback(
    (url: string) => {
      onChange(url);
    },
    [onChange],
  );

  const createPage = useCallback(async () => {
    if (!eventId || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/wizard/event-landing-page", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        record?: EventLandingPageRecord | null;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.record) {
        setError(json.error ?? "Couldn’t create the event page.");
        return;
      }
      const next = snapshotFromRecord(json.record, publicOrigin());
      cache.set(eventId, next);
      emitCache();
      if (next.url && canAutoFillDestinationUrl(value, next.url)) {
        applyUrl(next.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t create the event page.");
    } finally {
      setCreating(false);
    }
  }, [applyUrl, creating, eventId, value]);

  if (!eventId) return null;

  const snapshot = cache.get(eventId) ?? null;
  const record = snapshot?.record ?? null;
  const lpUrl = snapshot?.url ?? null;
  const eventKnown = record != null;
  const hasPage = eventKnown && record.hasPage && lpUrl != null;
  const alreadyUsing = Boolean(lpUrl && destinationUrlsMatch(value, lpUrl));
  const showNudge = shouldNudgeOffFunnel({ lpUrl, chosenUrl: value });

  if (loading && !snapshot) {
    return (
      <p className="mt-1.5 text-[11px] text-muted-foreground" data-lp-destination-field={fieldId}>
        Checking for an event page…
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1" data-lp-destination-field={fieldId}>
      {hasPage && lpUrl && !alreadyUsing && (
        <>
          <button
            type="button"
            onClick={() => applyUrl(lpUrl)}
            className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Use event page
          </button>
          <p className="text-[11px] text-muted-foreground">{USE_EVENT_PAGE_WHY}</p>
        </>
      )}

      {eventKnown && !hasPage && (
        <>
          <button
            type="button"
            onClick={() => void createPage()}
            disabled={creating}
            className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          >
            {creating ? "Creating event page…" : "Create event page"}
          </button>
          <p className="text-[11px] text-muted-foreground">{USE_EVENT_PAGE_WHY}</p>
        </>
      )}

      {showNudge && (
        <p className="text-[11px] text-muted-foreground">{OFF_FUNNEL_NUDGE}</p>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
