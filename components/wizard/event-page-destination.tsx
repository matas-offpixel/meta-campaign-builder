"use client";

import { useCallback, useEffect, useState } from "react";

import {
  canonicalLandingPageUrl,
  resolveCanonicalLandingPage,
  type CanonicalLandingPage,
} from "@/lib/landing-pages/canonical-url";
import type { EventLandingPageRecord } from "@/lib/landing-pages/event-lookup";
import type { WizardLpAssessment } from "@/lib/landing-pages/wizard-renderability";
import {
  canAutoFillDestinationUrl,
  destinationHelperKind,
  destinationHelperText,
  destinationUrlsMatch,
} from "@/lib/wizard/lp-destination";
import type { WizardDestinationUrlFieldId } from "@/lib/wizard/lp-destination-fields";

/**
 * Offer (never force) the event landing page as the ad destination.
 * Shared by every Meta + TikTok destination-URL field.
 *
 * Only a renderable URL is filled: ready = live internal page + client
 * landing-page config. Draft / unconfigured never land in the field.
 */

type Snapshot = {
  record: EventLandingPageRecord | null;
  resolved: CanonicalLandingPage;
  url: string | null;
  renderability: WizardLpAssessment;
};

const cache = new Map<string, Snapshot>();
const listeners = new Set<() => void>();

function emitCache() {
  for (const listener of listeners) listener();
}

function snapshotFromPayload(
  record: EventLandingPageRecord | null,
  renderability: WizardLpAssessment,
  origin: string,
): Snapshot {
  if (!record) {
    return {
      record: null,
      resolved: { kind: "none" },
      url: null,
      renderability,
    };
  }
  const resolved = resolveCanonicalLandingPage({
    hasPage: record.hasPage,
    clientSlug: record.clientSlug,
    eventSlug: record.eventSlug,
    publicOrigin: origin,
    customHost: record.customHost,
  });
  const rawUrl = canonicalLandingPageUrl(resolved);
  return {
    record,
    resolved,
    url: renderability.offerUrl ? rawUrl : null,
    renderability,
  };
}

function publicOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

type ApiPayload = {
  ok?: boolean;
  record?: EventLandingPageRecord | null;
  renderability?: WizardLpAssessment;
  error?: string;
};

function parsePayload(json: ApiPayload): {
  record: EventLandingPageRecord | null;
  renderability: WizardLpAssessment;
} {
  return {
    record: json.record ?? null,
    renderability: json.renderability ?? { state: "none", offerUrl: false },
  };
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
        const json = (await res.json()) as ApiPayload;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError("Couldn’t load the event page.");
          return;
        }
        const parsed = parsePayload(json);
        cache.set(
          eventId,
          snapshotFromPayload(parsed.record, parsed.renderability, publicOrigin()),
        );
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

  const ensurePage = useCallback(async () => {
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
      const json = (await res.json()) as ApiPayload;
      if (!res.ok || !json.ok || !json.record) {
        setError(json.error ?? "Couldn’t create the event page.");
        return;
      }
      const parsed = parsePayload(json);
      const next = snapshotFromPayload(
        parsed.record,
        parsed.renderability,
        publicOrigin(),
      );
      cache.set(eventId, next);
      emitCache();
      if (
        next.renderability.offerUrl &&
        next.url &&
        canAutoFillDestinationUrl(value, next.url)
      ) {
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
  const renderability = snapshot?.renderability ?? {
    state: "none" as const,
    offerUrl: false,
  };
  const eventKnown = record != null;
  const alreadyUsing = Boolean(lpUrl && destinationUrlsMatch(value, lpUrl));
  const helperKind = destinationHelperKind({
    state: renderability.state,
    offerUrl: renderability.offerUrl,
    lpUrl,
    chosenUrl: value,
  });
  const helperText = destinationHelperText(helperKind);

  const showUse =
    eventKnown && renderability.offerUrl && lpUrl != null && !alreadyUsing;
  const showCreate = eventKnown && renderability.state === "none";
  const showFinish = eventKnown && renderability.state === "unconfigured";
  const showPublish = eventKnown && renderability.state === "draft";

  if (loading && !snapshot) {
    return (
      <p className="mt-1.5 text-[11px] text-muted-foreground" data-lp-destination-field={fieldId}>
        Checking for an event page…
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1" data-lp-destination-field={fieldId}>
      {showUse && lpUrl && (
        <button
          type="button"
          onClick={() => applyUrl(lpUrl)}
          className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Use event page
        </button>
      )}

      {(showCreate || showFinish || showPublish) && (
        <button
          type="button"
          onClick={() => void ensurePage()}
          disabled={creating}
          className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
        >
          {creating
            ? showPublish
              ? "Publishing event page…"
              : "Creating event page…"
            : showPublish
              ? "Publish event page"
              : "Create event page"}
        </button>
      )}

      {helperText && (
        <p className="text-[11px] text-muted-foreground">{helperText}</p>
      )}

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
