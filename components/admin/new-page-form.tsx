"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  createEventWithPage,
  createPageForExistingEvent,
} from "@/lib/actions/update-page-event";
import {
  slugifyEventName,
  type PageEventActionState,
} from "@/lib/admin/page-event-schema";
import type { EventOption } from "@/lib/db/client-admin";

/**
 * components/admin/new-page-form.tsx — the two create flows (OP909
 * Phase 3): (a) attach a page to an existing event without one, or
 * (b) create a new event + page together. Both land in the editor.
 */

const IDLE: PageEventActionState = { status: "idle", errors: {} };

export function NewPageForm({ eventOptions }: { eventOptions: EventOption[] }) {
  const [mode, setMode] = useState<"existing" | "new">(
    eventOptions.length > 0 ? "existing" : "new",
  );

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <ModeButton
          active={mode === "existing"}
          onClick={() => setMode("existing")}
          disabled={eventOptions.length === 0}
          label="Use an existing event"
          hint={
            eventOptions.length === 0
              ? "All your events already have pages"
              : `${eventOptions.length} without a page`
          }
        />
        <ModeButton
          active={mode === "new"}
          onClick={() => setMode("new")}
          label="Create a new event"
          hint="Event + page together"
        />
      </div>

      {mode === "existing" ? (
        <ExistingEventForm eventOptions={eventOptions} />
      ) : (
        <NewEventForm />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-md border px-4 py-3 text-left transition-colors disabled:opacity-40 ${
        active
          ? "border-foreground bg-muted/60"
          : "border-border bg-card hover:bg-muted/40"
      }`}
    >
      <span className="block text-sm font-medium">{label}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
    </button>
  );
}

function ExistingEventForm({ eventOptions }: { eventOptions: EventOption[] }) {
  const [state, formAction, pending] = useActionState(
    createPageForExistingEvent,
    IDLE,
  );
  return (
    <form action={formAction} className="rounded-md border border-border bg-card p-5">
      <label className="block text-sm font-medium" htmlFor="event_id">
        Event
      </label>
      <select
        id="event_id"
        name="event_id"
        required
        className="mt-1.5 h-9 w-full max-w-md rounded-md border border-border-strong bg-background px-3 text-sm"
        defaultValue=""
      >
        <option value="" disabled>
          Choose an event…
        </option>
        {eventOptions.map((option) => (
          <option key={option.eventId} value={option.eventId}>
            {option.eventName}
          </option>
        ))}
      </select>
      {state.errors._form && (
        <p className="mt-2 text-xs text-destructive">{state.errors._form}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Create page
      </button>
    </form>
  );
}

function NewEventForm() {
  const [state, formAction, pending] = useActionState(createEventWithPage, IDLE);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const err = state.errors;
  const effectiveSlug = slugTouched ? slug : slugifyEventName(name);

  return (
    <form action={formAction} className="rounded-md border border-border bg-card p-5 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="name">
            Event name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jackies — Open Air Mallorca"
            className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
          />
          {err.name && <FieldError message={err.name} />}
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="slug">
            URL slug
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="jackies-open-air-mallorca"
            className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-generated from the name — edit if needed.
          </p>
          {err.slug && <FieldError message={err.slug} />}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <DateTimeField
          id="presale_at"
          label="Presale opens"
          error={err.presale_at}
        />
        <DateTimeField
          id="general_sale_at"
          label="General sale"
          error={err.general_sale_at}
        />
        <DateTimeField
          id="event_start_at"
          label="Event start"
          error={err.event_start_at}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium" htmlFor="venue">
            Venue
          </label>
          <input
            id="venue"
            name="venue"
            type="text"
            placeholder="Ushuaïa, Platja d'en Bossa, Ibiza"
            className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium" htmlFor="venue_short">
            Venue (short)
          </label>
          <input
            id="venue_short"
            name="venue_short"
            type="text"
            placeholder="Defaults to the part before the first comma"
            className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
          />
        </div>
      </div>

      {err._form && <FieldError message={err._form} />}

      <button
        type="submit"
        disabled={pending}
        className="flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-sm font-medium text-background hover:bg-foreground/90 disabled:opacity-40"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Create event &amp; page
      </button>
    </form>
  );
}

function DateTimeField({
  id,
  label,
  error,
}: {
  id: string;
  label: string;
  error?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="datetime-local"
        className="mt-1.5 h-9 w-full rounded-md border border-border-strong bg-background px-3 text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">UK time</p>
      {error && <FieldError message={error} />}
    </div>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-destructive">{message}</p>;
}
