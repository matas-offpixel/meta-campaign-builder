"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFetchClients } from "@/lib/hooks/useClients";
import {
  useFetchEventsForClient,
  type EventPickerRow,
} from "@/lib/hooks/useEvents";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { saveDraftToDb } from "@/lib/db/drafts";

/**
 * components/library/new-campaign-modal.tsx
 *
 * Modal launched from the campaign library's "New Campaign" button.
 * Asks for client → event before opening the wizard so the wizard
 * (and every downstream feature) can rely on the FK columns being
 * populated from the start. Cancelling the modal does nothing — no
 * orphan draft is created until the user confirms.
 *
 * Inline event creation is collapsed by default; it auto-expands when
 * the picked client has zero events so the modal stays a single
 * flow rather than punting the user to /events/new.
 */

interface Props {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}

interface InlineEventFields {
  name: string;
  event_date: string;
  venue_name: string;
  venue_city: string;
  capacity: string;
  presale_at: string;
  general_sale_at: string;
}

const EMPTY_INLINE: InlineEventFields = {
  name: "",
  event_date: "",
  venue_name: "",
  venue_city: "",
  capacity: "",
  presale_at: "",
  general_sale_at: "",
};

interface CreateEventResponse {
  ok?: boolean;
  error?: string;
  event?: EventPickerRow;
}

/** datetime-local input value → ISO string (browser-local TZ). Empty → null. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function NewCampaignModal({ open, userId, onClose }: Props) {
  const router = useRouter();

  const { clients, loading: clientsLoading, error: clientsError } =
    useFetchClients();

  const [clientId, setClientId] = useState<string>("");
  const [eventId, setEventId] = useState<string>("");

  const [showInlineEvent, setShowInlineEvent] = useState(false);
  const [inline, setInline] = useState<InlineEventFields>(EMPTY_INLINE);

  const [submitting, setSubmitting] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    events,
    loading: eventsLoading,
    error: eventsError,
    reload: reloadEvents,
  } = useFetchEventsForClient(clientId || null);

  // Reset transient state every time the modal opens so a previously
  // half-filled session doesn't leak in.
  useEffect(() => {
    if (!open) return;
    setClientId("");
    setEventId("");
    setShowInlineEvent(false);
    setInline(EMPTY_INLINE);
    setError(null);
    setSubmitting(false);
    setCreatingEvent(false);
  }, [open]);

  // Auto-open the inline event form when the picked client has no
  // events yet — the user otherwise stares at an empty dropdown with
  // no obvious next step. Don't auto-open while the events list is
  // still loading; that flickers the form on slow networks.
  useEffect(() => {
    if (!clientId) return;
    if (eventsLoading) return;
    if (events.length === 0) {
      setShowInlineEvent(true);
    }
  }, [clientId, eventsLoading, events.length]);

  const clientOptions = useMemo(
    () =>
      clients.map((c) => ({
        value: c.id,
        label: c.name,
      })),
    [clients],
  );

  const eventOptions = useMemo(
    () =>
      events.map((e) => ({
        value: e.id,
        label: e.event_date ? `${e.name} — ${e.event_date}` : e.name,
      })),
    [events],
  );

  const canStart = Boolean(userId && clientId && eventId && !submitting);

  // ─── Actions ──────────────────────────────────────────────────────────
  const handleCreateInlineEvent = async () => {
    if (!clientId) return;
    const name = inline.name.trim();
    if (!name) {
      setError("Event name is required.");
      return;
    }
    setCreatingEvent(true);
    setError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          name,
          event_date: inline.event_date || undefined,
          venue_name: inline.venue_name.trim() || undefined,
          venue_city: inline.venue_city.trim() || undefined,
          capacity: inline.capacity ? Number(inline.capacity) : undefined,
          presale_at: localInputToIso(inline.presale_at) ?? undefined,
          general_sale_at: localInputToIso(inline.general_sale_at) ?? undefined,
        }),
      });
      const json = (await res.json()) as CreateEventResponse;
      if (!res.ok || !json.ok || !json.event) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      // Refresh the list, auto-pick the new row, collapse the form.
      reloadEvents();
      setEventId(json.event.id);
      setShowInlineEvent(false);
      setInline(EMPTY_INLINE);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create event";
      setError(msg);
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleStart = async () => {
    if (!userId || !clientId || !eventId) return;
    setSubmitting(true);
    setError(null);
    try {
      const draft = createDefaultDraft();
      draft.settings.clientId = clientId;
      draft.settings.eventId = eventId;
      await saveDraftToDb(draft, userId);
      router.push(`/campaign/${draft.id}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to create campaign draft";
      setError(msg);
      setSubmitting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onClose={submitting ? () => {} : onClose}>
      <DialogContent>
        <DialogHeader onClose={submitting ? undefined : onClose}>
          <DialogTitle>New Campaign</DialogTitle>
          <DialogDescription>
            Pick the client and event this campaign is for. Both stay linked
            for reporting and downstream automations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Client picker ── */}
          {clientsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading clients…
            </div>
          ) : clientsError ? (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span className="text-sm text-destructive">{clientsError}</span>
            </div>
          ) : clients.length === 0 ? (
            <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
              You don&apos;t have any clients yet. Create one from the
              dashboard&apos;s Clients tab before starting a campaign.
            </div>
          ) : (
            <Select
              label="Client"
              value={clientId}
              onChange={(e) => {
                const next = e.target.value;
                setClientId(next);
                setEventId("");
                setShowInlineEvent(false);
                setError(null);
              }}
              placeholder="Select a client…"
              options={clientOptions}
            />
          )}

          {/* ── Event picker ── */}
          {clientId && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  Event
                </label>
                {events.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowInlineEvent((s) => !s)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-3 w-3" />
                    {showInlineEvent ? "Cancel" : "New event"}
                  </button>
                )}
              </div>

              {eventsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading events…
                </div>
              ) : eventsError ? (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                  <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="text-sm text-destructive">{eventsError}</span>
                </div>
              ) : events.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No events for this client yet — create one below.
                </p>
              ) : (
                <Select
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value);
                    setError(null);
                  }}
                  placeholder="Select an event…"
                  options={eventOptions}
                />
              )}
            </div>
          )}

          {/* ── Inline event creation ── */}
          {clientId && showInlineEvent && (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground">
                Create event for this client
              </p>

              <Input
                label="Event name"
                value={inline.name}
                onChange={(e) =>
                  setInline((s) => ({ ...s, name: e.target.value }))
                }
                placeholder="e.g. RIANBRAZIL — London"
                disabled={creatingEvent}
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Event date"
                  type="date"
                  value={inline.event_date}
                  onChange={(e) =>
                    setInline((s) => ({ ...s, event_date: e.target.value }))
                  }
                  disabled={creatingEvent}
                />
                <Input
                  label="Capacity"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={inline.capacity}
                  onChange={(e) =>
                    setInline((s) => ({ ...s, capacity: e.target.value }))
                  }
                  disabled={creatingEvent}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Venue name"
                  value={inline.venue_name}
                  onChange={(e) =>
                    setInline((s) => ({ ...s, venue_name: e.target.value }))
                  }
                  disabled={creatingEvent}
                />
                <Input
                  label="Venue city"
                  value={inline.venue_city}
                  onChange={(e) =>
                    setInline((s) => ({ ...s, venue_city: e.target.value }))
                  }
                  disabled={creatingEvent}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Presale at"
                  type="datetime-local"
                  value={inline.presale_at}
                  onChange={(e) =>
                    setInline((s) => ({ ...s, presale_at: e.target.value }))
                  }
                  disabled={creatingEvent}
                />
                <Input
                  label="General sale at"
                  type="datetime-local"
                  value={inline.general_sale_at}
                  onChange={(e) =>
                    setInline((s) => ({
                      ...s,
                      general_sale_at: e.target.value,
                    }))
                  }
                  disabled={creatingEvent}
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                {events.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowInlineEvent(false);
                      setInline(EMPTY_INLINE);
                    }}
                    disabled={creatingEvent}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCreateInlineEvent}
                  disabled={creatingEvent || !inline.name.trim()}
                >
                  {creatingEvent ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    "Create event"
                  )}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span className="text-sm text-destructive">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={!canStart}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : (
              "Start campaign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
