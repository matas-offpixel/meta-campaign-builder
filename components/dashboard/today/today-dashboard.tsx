"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Ticket,
  Users,
  Megaphone,
  AlertTriangle,
  Loader2,
  ArrowRight,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { createClient as createSupabase } from "@/lib/supabase/client";
import { listEvents, type EventWithClient } from "@/lib/db/events";
import { listClients, type ClientRow } from "@/lib/db/clients";

// ─── Date helpers ────────────────────────────────────────────────────────────

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function parseDateOnly(iso: string | null): Date | null {
  if (!iso) return null;
  // event_date is yyyy-mm-dd; treat as local calendar date.
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDay(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function relativeLabel(eventDate: Date): string {
  const diff = daysBetween(today(), eventDate);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff > 7) return fmtDay(eventDate);
  if (diff === -1) return "Yesterday";
  return fmtDay(eventDate);
}

// ─── Partition helpers ───────────────────────────────────────────────────────

type MissingTag =
  | "no event date"
  | "no client"
  | "no announcement"
  | "no presale"
  | "no general sale";

function missingFields(e: EventWithClient): MissingTag[] {
  const out: MissingTag[] = [];
  if (!e.event_date) out.push("no event date");
  if (!e.client_id) out.push("no client");
  // Only flag milestone gaps for events that aren't already past or completed.
  const date = parseDateOnly(e.event_date);
  const isFutureOrUnknown = !date || daysBetween(today(), date) >= 0;
  const stillLive = e.status !== "completed" && e.status !== "cancelled";
  if (isFutureOrUnknown && stillLive) {
    if (!e.announcement_at) out.push("no announcement");
    if (!e.presale_at) out.push("no presale");
    if (!e.general_sale_at) out.push("no general sale");
  }
  return out;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TodayDashboard() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventWithClient[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const [ev, cl] = await Promise.all([
        listEvents(user.id),
        listClients(user.id),
      ]);
      setEvents(ev);
      setClients(cl);
      setLoading(false);
    }
    load();
  }, []);

  const partitions = useMemo(() => {
    const t = today();
    const todayEvents: EventWithClient[] = [];
    const upcoming: EventWithClient[] = [];
    const needsAttention: Array<{ e: EventWithClient; tags: MissingTag[] }> = [];
    const recent: EventWithClient[] = [];

    for (const e of events) {
      const date = parseDateOnly(e.event_date);
      const diff = date ? daysBetween(t, date) : null;

      if (diff === 0) todayEvents.push(e);
      else if (diff != null && diff > 0 && diff <= 14) upcoming.push(e);

      const tags = missingFields(e);
      if (tags.length > 0) needsAttention.push({ e, tags });
    }

    // Upcoming sort: soonest first.
    upcoming.sort(
      (a, b) =>
        (parseDateOnly(a.event_date)?.getTime() ?? 0) -
        (parseDateOnly(b.event_date)?.getTime() ?? 0),
    );

    // Recent = last 5 updated overall (live data — uses updated_at).
    recent.push(
      ...[...events]
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, 5),
    );

    // Cap needs-attention to most recent 6 so Today stays skimmable.
    needsAttention.sort(
      (a, b) =>
        new Date(b.e.updated_at).getTime() - new Date(a.e.updated_at).getTime(),
    );

    return {
      todayEvents,
      upcoming,
      needsAttention: needsAttention.slice(0, 6),
      recent,
    };
  }, [events]);

  const recentClients = useMemo(
    () =>
      [...clients]
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        .slice(0, 5),
    [clients],
  );

  const todayLabel = today().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <>
      <PageHeader
        title="Today"
        description={todayLabel}
        actions={
          <>
            <Link href="/events/new">
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5" />
                New event
              </Button>
            </Link>
            <Link href="/clients/new">
              <Button size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5" />
                New client
              </Button>
            </Link>
            <Link href="/">
              <Button size="sm">
                <Megaphone className="h-3.5 w-3.5" />
                Open creator
              </Button>
            </Link>
          </>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* ───── Today ───── */}
              <Section
                title="Happening today"
                count={partitions.todayEvents.length}
                emptyHint="No shows today."
              >
                {partitions.todayEvents.map((e) => (
                  <EventRow key={e.id} event={e} showRelative />
                ))}
              </Section>

              {/* ───── Upcoming this fortnight ───── */}
              <Section
                title="Upcoming · next 14 days"
                count={partitions.upcoming.length}
                emptyHint="Nothing scheduled in the next fortnight."
              >
                {partitions.upcoming.map((e) => (
                  <EventRow key={e.id} event={e} showRelative />
                ))}
              </Section>

              {/* ───── Needs attention ───── */}
              {partitions.needsAttention.length > 0 && (
                <Section
                  title="Needs attention"
                  count={partitions.needsAttention.length}
                  emptyHint=""
                  accent="warn"
                >
                  {partitions.needsAttention.map(({ e, tags }) => (
                    <EventRow key={e.id} event={e} tags={tags} />
                  ))}
                </Section>
              )}

              {/* ───── Two column row: Recent events + Recent clients ───── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Section
                  title="Recent events"
                  count={partitions.recent.length}
                  emptyHint="No events yet — create your first."
                  footer={
                    <Link
                      href="/events"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      All events
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  }
                >
                  {partitions.recent.map((e) => (
                    <EventRow key={e.id} event={e} compact />
                  ))}
                </Section>

                <Section
                  title="Recent clients"
                  count={recentClients.length}
                  emptyHint="No clients yet — add one."
                  footer={
                    <Link
                      href="/clients"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      All clients
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  }
                >
                  {recentClients.map((c) => (
                    <ClientLinkRow key={c.id} client={c} />
                  ))}
                </Section>
              </div>

              {/* ───── Empty-state block when nothing at all ───── */}
              {events.length === 0 && clients.length === 0 && (
                <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
                  <p className="font-heading text-lg tracking-wide">
                    Nothing here yet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start by adding a client, then create events underneath it.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <Link href="/clients/new">
                      <Button size="sm">
                        <Users className="h-3.5 w-3.5" />
                        New client
                      </Button>
                    </Link>
                    <Link href="/events/new">
                      <Button size="sm" variant="outline">
                        <Ticket className="h-3.5 w-3.5" />
                        New event
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}

// ─── Section wrapper ─────────────────────────────────────────────────────────

function Section({
  title,
  count,
  emptyHint,
  children,
  accent,
  footer,
}: {
  title: string;
  count: number;
  emptyHint: string;
  children: React.ReactNode;
  accent?: "warn";
  footer?: React.ReactNode;
}) {
  const titleAccent =
    accent === "warn" ? "text-amber-700 dark:text-amber-400" : "";
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className={`font-heading text-base tracking-wide ${titleAccent}`}>
          {accent === "warn" && (
            <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5" />
          )}
          {title}
          {count > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {footer}
      </div>
      {count === 0 ? (
        emptyHint ? (
          <p className="text-sm text-muted-foreground">{emptyHint}</p>
        ) : null
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

// ─── Event row ───────────────────────────────────────────────────────────────

function EventRow({
  event: e,
  showRelative,
  tags,
  compact,
}: {
  event: EventWithClient;
  showRelative?: boolean;
  tags?: MissingTag[];
  compact?: boolean;
}) {
  const date = parseDateOnly(e.event_date);
  return (
    <Link
      href={`/events/${e.id}`}
      className="group flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-border-strong"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {e.name}
          </p>
          {!compact && (
            <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {e.status.replace("_", " ")}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {e.client?.name && <span className="truncate">{e.client.name}</span>}
          {e.venue_city && <span>{e.venue_city}</span>}
          {e.capacity != null && <span>{e.capacity.toLocaleString()} cap</span>}
        </div>
        {tags && tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-medium text-foreground">
          {showRelative && date ? relativeLabel(date) : date ? fmtDay(date) : "—"}
        </p>
        {!compact && date && (
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            <CalendarClock className="h-2.5 w-2.5" />
            {date.toLocaleDateString("en-GB", { weekday: "short" })}
          </p>
        )}
      </div>
    </Link>
  );
}

// ─── Client row ──────────────────────────────────────────────────────────────

function ClientLinkRow({ client }: { client: ClientRow }) {
  return (
    <Link
      href={`/clients/${client.id}`}
      className="flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-border-strong"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {client.name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {client.primary_type}
          {client.contact_name ? ` · ${client.contact_name}` : ""}
        </p>
      </div>
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
        {client.status}
      </span>
    </Link>
  );
}
