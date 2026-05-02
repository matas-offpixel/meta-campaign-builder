"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Link as LinkIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ExternalEventPicker } from "@/components/dashboard/events/external-event-picker";
import type {
  EventTicketingLink,
  ExternalEventSummary,
} from "@/lib/ticketing/types";
import type { SafeTicketingConnection } from "@/lib/db/event-ticketing-summary";

/**
 * components/dashboard/events/eventbrite-link-panel.tsx
 *
 * Two-step linking UI for binding an internal event to its
 * external ticketing counterpart.
 *
 *   Step 1  Pick a connection. Skipped automatically when the client
 *           has exactly one connection (the common case for v1).
 *
 *   Step 2  Pick the external event from a dropdown populated by
 *           GET /api/ticketing/events?connectionId=…. Lazy-loaded so
 *           the page-load doesn't pay for an upstream list fetch
 *           every time the event detail renders — only the first time
 *           the user actually opens the panel.
 *
 *   Save    POST /api/ticketing/links → calls router.refresh() so the
 *           live block above re-paints with the new link prefetched.
 *
 * If the event is already linked the panel renders a compact summary
 * with a "Change" button that re-enables the dropdown. Unlinking is
 * out of scope for v1 — the operator can re-bind to a different
 * external event but never to "no event".
 */

interface Props {
  eventId: string;
  clientId: string;
  /** Pre-redacted (credentials: null) per the server boundary. */
  availableConnections: SafeTicketingConnection[];
  /** Existing link, when one exists. */
  existingLink: EventTicketingLink | null;
}

export function EventbriteLinkPanel({
  eventId,
  clientId,
  availableConnections,
  existingLink,
}: Props) {
  const router = useRouter();

  // Limit the dropdown to live API providers. Manual connections don't
  // expose provider-side events to pick.
  const liveConnections = availableConnections.filter(
    (c) => c.provider === "eventbrite" || c.provider === "fourthefans",
  );

  const [editing, setEditing] = useState(!existingLink);
  const [connectionId, setConnectionId] = useState<string>(
    existingLink?.connection_id ?? liveConnections[0]?.id ?? "",
  );
  const [externalEventId, setExternalEventId] = useState<string>(
    existingLink?.external_event_id ?? "",
  );
  const [externalEventUrl, setExternalEventUrl] = useState<string | null>(
    existingLink?.external_event_url ?? null,
  );
  const [externalEvents, setExternalEvents] = useState<
    ExternalEventSummary[] | null
  >(null);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMessage, setOkMessage] = useState<string | null>(null);

  // Re-fetch the external events whenever the chosen connection
  // changes (or on first reveal of the dropdown).
  useEffect(() => {
    if (!editing) return;
    if (!connectionId) return;
    let cancelled = false;
    setLoadingEvents(true);
    setError(null);
    setExternalEvents(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/ticketing/events?connectionId=${encodeURIComponent(connectionId)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as {
          ok: boolean;
          error?: string;
          events?: ExternalEventSummary[];
        };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setError(
            json.error ?? "Failed to load ticketing events for this connection.",
          );
          return;
        }
        setExternalEvents(json.events ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error.");
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, editing]);

  async function handleSave() {
    setError(null);
    setOkMessage(null);
    if (!connectionId || !externalEventId) {
      setError("Pick a connection and an external event to link.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/ticketing/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          connectionId,
          externalEventId,
          externalEventUrl,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        link?: EventTicketingLink;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Failed to save the link.");
        return;
      }
      setOkMessage("Linked.");
      setEditing(false);
      // router.refresh() re-runs the server fetches that produced
      // initialLink/initialConnection on the live block above so the
      // new link state propagates without a hard reload.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  if (liveConnections.length === 0) {
    // No active ticketing API connection on this client — the live block
    // already renders the connection CTA, so we show
    // nothing here to avoid duplicate guidance.
    return null;
  }

  if (!editing && existingLink) {
    const linked = externalEvents?.find(
      (e) => e.externalEventId === existingLink.external_event_id,
    );
    return (
      <section className="rounded-md border border-border bg-card p-4">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <LinkIcon className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-medium">Ticketing link</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Bound to{" "}
                <span className="font-medium text-foreground">
                  {linked?.name ?? existingLink.external_event_id}
                </span>
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
        </header>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-border bg-card p-4 space-y-3">
      <header className="flex items-start gap-3">
        <LinkIcon className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium">
            {existingLink ? "Re-link ticketing event" : "Link ticketing event"}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Pick the ticketing event that matches this dashboard event.
            Saving triggers an immediate sync.
          </p>
        </div>
      </header>

      {liveConnections.length > 1 && (
        <Select
          value={connectionId}
          onChange={(e) => setConnectionId(e.target.value)}
          options={liveConnections.map((c) => ({
            value: c.id,
            label: c.external_account_id
              ? `${providerLabel(c.provider)} · ${c.external_account_id}`
              : providerLabel(c.provider),
          }))}
        />
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          Ticketing event
        </label>
        {loadingEvents ? (
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading events…
          </div>
        ) : externalEvents && externalEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            This connection has no events yet. Create one in the ticketing
            platform, then click Refresh.
          </p>
        ) : (
          <ExternalEventPicker
            events={externalEvents ?? []}
            value={externalEventId}
            onChange={(id, ev) => {
              setExternalEventId(id);
              setExternalEventUrl(ev?.url ?? null);
            }}
            placeholder="Select a ticketing event"
          />
        )}
      </div>

      {error ? (
        <p className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      ) : null}
      {okMessage ? (
        <p className="inline-flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          {okMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => void handleSave()}
          disabled={submitting || !externalEventId}
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          {existingLink ? "Save link" : "Link event"}
        </Button>
        {existingLink ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setError(null);
              setOkMessage(null);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
        ) : null}
        <a
          href={`/clients/${clientId}?tab=ticketing`}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Manage connections →
        </a>
      </div>
    </section>
  );
}

function providerLabel(provider: SafeTicketingConnection["provider"]): string {
  return provider === "fourthefans" ? "4thefans" : "Eventbrite";
}

