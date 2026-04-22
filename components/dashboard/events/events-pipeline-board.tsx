"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Megaphone, Ticket } from "lucide-react";

import type { EventWithClient } from "@/lib/db/events";
import type { CampaignPhase } from "@/lib/wizard/phase";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import { fmtShort } from "@/lib/dashboard/format";

/**
 * components/dashboard/events/events-pipeline-board.tsx
 *
 * Kanban variant of /events. Bucketed by the same `derivePhase`
 * helper used by the wizard pre-population (PR #16) — never
 * reimplement, never "simpler version", because the rollup +
 * linked-campaigns surfaces both rely on identical bucketing.
 *
 * Columns (left → right):
 *   Pre-announce · Announce · Presale · On sale · Final push · Post-event
 *
 * Events whose status is `cancelled` are rendered in a separate
 * collapsed strip at the bottom of the board so a long tail of
 * dead campaigns doesn't dominate the view.
 *
 * Phase computation lives server-side (the parent server route
 * computes a {eventId → phase} map and passes it in via `phaseOf`)
 * so we don't ship `derivePhase` to the browser unnecessarily.
 */

interface Props {
  events: EventWithClient[];
  /**
   * Phase lookup, computed server-side. Function shape (not a Map)
   * so the parent can serialise it as a plain object across the
   * client boundary without losing TypeScript narrowing.
   */
  phaseOf: (eventId: string) => CampaignPhase;
  /**
   * Optional `eventId → linked draft count` lookup. When omitted the
   * card hides the "Linked" badge. Linked-campaign counts are
   * surfaced as a quick "is anything running" cue per card.
   */
  linkedCountOf?: (eventId: string) => number;
}

const DISPLAY_PHASES: CampaignPhase[] = [
  "Pre-announce",
  "Announce",
  "Presale",
  "On sale",
  "Final push",
  "Post-event",
];

const PHASE_TONES: Record<CampaignPhase, string> = {
  "Pre-announce": "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  Announce: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Presale: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  "On sale": "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  "Final push": "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  "Post-event": "bg-muted text-muted-foreground",
  Campaign: "bg-muted text-muted-foreground",
};

export function EventsPipelineBoard({ events, phaseOf, linkedCountOf }: Props) {
  // Split cancelled into its own strip up front so the active
  // pipeline only sees live work.
  const { active, cancelled } = useMemo(() => {
    const a: EventWithClient[] = [];
    const c: EventWithClient[] = [];
    for (const e of events) {
      if (e.status === "cancelled") c.push(e);
      else a.push(e);
    }
    return { active: a, cancelled: c };
  }, [events]);

  // Bucket active events by phase. "Campaign" (the no-dates fallback
  // from derivePhase) is folded into Pre-announce so a freshly-created
  // event without milestones still shows up at the head of the board.
  const buckets = useMemo(() => {
    const m = new Map<CampaignPhase, EventWithClient[]>();
    for (const phase of DISPLAY_PHASES) m.set(phase, []);
    for (const ev of active) {
      const raw = phaseOf(ev.id);
      const target = raw === "Campaign" ? "Pre-announce" : raw;
      const arr = m.get(target);
      if (arr) arr.push(ev);
      else m.set(target, [ev]);
    }
    // Preserve the parent's incoming order inside each column
    // (events-server.ts orders by event_date ascending) so a column
    // reads top-to-bottom in date order.
    return m;
  }, [active, phaseOf]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {DISPLAY_PHASES.map((phase) => {
          const items = buckets.get(phase) ?? [];
          return (
            <PhaseColumn
              key={phase}
              phase={phase}
              events={items}
              linkedCountOf={linkedCountOf}
            />
          );
        })}
      </div>

      {cancelled.length > 0 && (
        <CancelledStrip events={cancelled} linkedCountOf={linkedCountOf} />
      )}
    </div>
  );
}

// ─── Column ─────────────────────────────────────────────────────────────────

function PhaseColumn({
  phase,
  events,
  linkedCountOf,
}: {
  phase: CampaignPhase;
  events: EventWithClient[];
  linkedCountOf?: (eventId: string) => number;
}) {
  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${PHASE_TONES[phase]}`}
        >
          {phase}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {events.length}
        </span>
      </div>
      <div className="space-y-2 p-2">
        {events.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/60">
            No events in this phase
          </p>
        ) : (
          events.map((ev) => (
            <EventCard
              key={ev.id}
              event={ev}
              linkedCount={linkedCountOf?.(ev.id) ?? 0}
            />
          ))
        )}
      </div>
    </div>
  );
}

function EventCard({
  event,
  linkedCount,
}: {
  event: EventWithClient;
  linkedCount: number;
}) {
  const ticketsSold =
    (event as unknown as { tickets_sold: number | null }).tickets_sold ?? null;

  return (
    <Link
      href={`/events/${event.id}`}
      className="block rounded-md border border-border/80 bg-background p-2.5 transition-colors hover:border-border-strong"
    >
      <p className="line-clamp-2 text-xs font-medium text-foreground">
        {event.name}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
        {event.client?.name && (
          <span className="font-medium text-muted-foreground">
            {event.client.name}
          </span>
        )}
        {event.event_date && <span>{fmtShort(event.event_date)}</span>}
        {event.venue_name && <span className="truncate">{event.venue_name}</span>}
      </div>
      {(linkedCount > 0 || ticketsSold != null) && (
        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
          {linkedCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Megaphone className="h-2.5 w-2.5" />
              {linkedCount} linked
            </span>
          ) : (
            <span />
          )}
          {ticketsSold != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Ticket className="h-2.5 w-2.5" />
              {ticketsSold.toLocaleString("en-GB")}
            </span>
          )}
        </div>
      )}
    </Link>
  );
}

// ─── Cancelled strip ────────────────────────────────────────────────────────

function CancelledStrip({
  events,
  linkedCountOf,
}: {
  events: EventWithClient[];
  linkedCountOf?: (eventId: string) => number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-md border border-dashed border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs"
      >
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          Cancelled · {events.length}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {events.map((ev) => (
            <Link
              key={ev.id}
              href={`/events/${ev.id}`}
              className="block rounded-md border border-border/60 bg-background p-2.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="line-clamp-1 text-xs font-medium text-foreground">
                  {ev.name}
                </p>
                <StatusPill status={ev.status} kind="event" />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {ev.client?.name ?? "—"}{" "}
                {ev.event_date && `· ${fmtShort(ev.event_date)}`}
                {linkedCountOf && linkedCountOf(ev.id) > 0 && (
                  <span> · {linkedCountOf(ev.id)} linked</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
