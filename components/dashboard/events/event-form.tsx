"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createClient as createSupabase } from "@/lib/supabase/client";
import { listClients, type ClientRow } from "@/lib/db/clients";
import {
  type EventRow,
  type EventStatus,
  EVENT_STATUSES,
  createEventRow,
  updateEventRow,
  slugifyEvent,
} from "@/lib/db/events";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  initial?: EventRow;
  /** Pre-select this client on create. */
  defaultClientId?: string;
  /**
   * Pre-fill `event_date` on create. Must already be a canonical
   * `YYYY-MM-DD` string (validate at the route boundary via
   * `parseDateParam`). Ignored in edit mode so an existing row's
   * stored date is never overwritten.
   */
  initialDate?: string;
}

const STATUS_OPTIONS = EVENT_STATUSES.map((s) => ({
  value: s,
  label: s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
}));

/** ISO datetime-local → full ISO string, interpreting input as browser-local TZ. */
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** ISO string → value suitable for `datetime-local` input (local TZ). */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function EventForm({
  mode,
  initial,
  defaultClientId,
  initialDate,
}: Props) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientId, setClientId] = useState(
    initial?.client_id ?? defaultClientId ?? "",
  );
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(initial?.slug));
  const [eventCode, setEventCode] = useState(initial?.event_code ?? "");
  const [capacity, setCapacity] = useState(
    initial?.capacity != null ? String(initial.capacity) : "",
  );
  const [genres, setGenres] = useState((initial?.genres ?? []).join(", "));
  const [venueName, setVenueName] = useState(initial?.venue_name ?? "");
  const [venueCity, setVenueCity] = useState(initial?.venue_city ?? "");
  const [venueCountry, setVenueCountry] = useState(initial?.venue_country ?? "");
  const [eventTimezone, setEventTimezone] = useState(initial?.event_timezone ?? "");
  // initialDate is create-only — never overwrite an existing edit-mode
  // row's stored event_date, even if it's empty.
  const [eventDate, setEventDate] = useState(
    mode === "create"
      ? (initialDate ?? "")
      : (initial?.event_date ?? ""),
  );
  const [eventStartAt, setEventStartAt] = useState(
    isoToLocalInput(initial?.event_start_at),
  );
  const [announcementAt, setAnnouncementAt] = useState(
    isoToLocalInput(initial?.announcement_at),
  );
  const [presaleAt, setPresaleAt] = useState(
    isoToLocalInput(initial?.presale_at),
  );
  const [generalSaleAt, setGeneralSaleAt] = useState(
    isoToLocalInput(initial?.general_sale_at),
  );
  const [ticketUrl, setTicketUrl] = useState(initial?.ticket_url ?? "");
  const [signupUrl, setSignupUrl] = useState(initial?.signup_url ?? "");
  const [status, setStatus] = useState<EventStatus>(
    (initial?.status as EventStatus | undefined) ?? "upcoming",
  );
  const [budgetMarketing, setBudgetMarketing] = useState(
    initial?.budget_marketing != null ? String(initial.budget_marketing) : "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  useEffect(() => {
    async function init() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const rows = await listClients(user.id);
      setClients(rows);
    }
    init();
  }, []);

  useEffect(() => {
    if (mode === "create" && !slugTouched) {
      setSlug(slugifyEvent(name));
    }
  }, [name, slugTouched, mode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      setError("Pick a client for this event.");
      return;
    }
    if (!userId && mode === "create") {
      setError("Not signed in.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const payload = {
      name: name.trim(),
      slug: slug || slugifyEvent(name),
      client_id: clientId,
      event_code: eventCode || null,
      capacity: capacity ? Number.parseInt(capacity, 10) : null,
      genres: genres
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean),
      venue_name: venueName || null,
      venue_city: venueCity || null,
      venue_country: venueCountry || null,
      event_timezone: eventTimezone || null,
      event_date: eventDate || null,
      event_start_at: localInputToIso(eventStartAt),
      announcement_at: localInputToIso(announcementAt),
      presale_at: localInputToIso(presaleAt),
      general_sale_at: localInputToIso(generalSaleAt),
      ticket_url: ticketUrl || null,
      signup_url: signupUrl || null,
      status,
      budget_marketing: budgetMarketing
        ? Number.parseFloat(budgetMarketing)
        : null,
      notes: notes || null,
    } as const;

    try {
      if (mode === "create" && userId) {
        const created = await createEventRow({
          ...payload,
          user_id: userId,
        });
        if (created) router.push(`/events/${created.id}`);
      } else if (mode === "edit" && initial) {
        await updateEventRow(initial.id, payload);
        router.push(`/events/${initial.id}`);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save event.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const clientOptions = clients.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="rounded-md border border-border bg-card p-5 space-y-4">
        <h2 className="font-heading text-base tracking-wide">Basics</h2>

        <Select
          id="event-client"
          label="Client"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={clientOptions}
          placeholder={
            clientOptions.length === 0
              ? "No clients — create one first"
              : "Pick a client"
          }
          disabled={clientOptions.length === 0}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            id="event-name"
            label="Event name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Louder at Drumsheds"
          />
          <Input
            id="event-slug"
            label="Slug"
            required
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="louder-drumsheds-2026-05"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            id="event-code"
            label="Event code"
            value={eventCode}
            onChange={(e) => setEventCode(e.target.value)}
            placeholder="internal reference"
          />
          <Input
            id="event-capacity"
            label="Capacity"
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            min={0}
          />
          <Select
            id="event-status"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as EventStatus)}
            options={STATUS_OPTIONS}
          />
        </div>

        <Input
          id="event-genres"
          label="Genres"
          value={genres}
          onChange={(e) => setGenres(e.target.value)}
          placeholder="melodic techno, afro house"
        />
      </section>

      <section className="rounded-md border border-border bg-card p-5 space-y-4">
        <h2 className="font-heading text-base tracking-wide">Venue</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            id="event-venue-name"
            label="Venue"
            value={venueName}
            onChange={(e) => setVenueName(e.target.value)}
          />
          <Input
            id="event-venue-city"
            label="City"
            value={venueCity}
            onChange={(e) => setVenueCity(e.target.value)}
          />
          <Input
            id="event-venue-country"
            label="Country"
            value={venueCountry}
            onChange={(e) => setVenueCountry(e.target.value)}
          />
        </div>
        <Input
          id="event-timezone"
          label="Event timezone"
          value={eventTimezone}
          onChange={(e) => setEventTimezone(e.target.value)}
          placeholder="Europe/London"
        />
      </section>

      <section className="rounded-md border border-border bg-card p-5 space-y-4">
        <h2 className="font-heading text-base tracking-wide">Dates</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            id="event-date"
            label="Event date"
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
          <Input
            id="event-start-at"
            label="Doors / start"
            type="datetime-local"
            value={eventStartAt}
            onChange={(e) => setEventStartAt(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Input
            id="event-announcement-at"
            label="Announcement"
            type="datetime-local"
            value={announcementAt}
            onChange={(e) => setAnnouncementAt(e.target.value)}
          />
          <Input
            id="event-presale-at"
            label="Presale"
            type="datetime-local"
            value={presaleAt}
            onChange={(e) => setPresaleAt(e.target.value)}
          />
          <Input
            id="event-general-sale-at"
            label="General sale"
            type="datetime-local"
            value={generalSaleAt}
            onChange={(e) => setGeneralSaleAt(e.target.value)}
          />
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-5 space-y-4">
        <h2 className="font-heading text-base tracking-wide">Links & budget</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            id="event-ticket-url"
            label="Ticket URL"
            type="url"
            value={ticketUrl}
            onChange={(e) => setTicketUrl(e.target.value)}
          />
          <Input
            id="event-signup-url"
            label="Signup URL"
            type="url"
            value={signupUrl}
            onChange={(e) => setSignupUrl(e.target.value)}
          />
        </div>
        <Input
          id="event-budget-marketing"
          label="Marketing budget (GBP)"
          type="number"
          step="0.01"
          value={budgetMarketing}
          onChange={(e) => setBudgetMarketing(e.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-notes" className="text-sm font-medium">
            Notes
          </label>
          <textarea
            id="event-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-border-strong bg-background px-3 py-2 text-sm
              focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </section>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !clientId}
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "create" ? "Create event" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
