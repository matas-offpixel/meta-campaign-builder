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
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { MilestoneChip } from "@/components/dashboard/_shared/milestone-chip";
import { createClient as createSupabase } from "@/lib/supabase/client";
import {
  listEvents,
  listDraftsForUserByEvent,
  type EventWithClient,
} from "@/lib/db/events";
import { listClients, type ClientRow } from "@/lib/db/clients";
import {
  daysBetween,
  fmtDay,
  fmtRelative,
  nextMilestone,
  parseDateOnly,
  today,
} from "@/lib/dashboard/format";

// ─── Partition helpers ───────────────────────────────────────────────────────

/**
 * Statuses that count as an "active" event for operational surfaces.
 * sold_out / completed / cancelled are excluded — they don't need a
 * fresh campaign even if a milestone is technically imminent.
 */
const ACTIVE_EVENT_STATUSES = new Set(["upcoming", "announced", "on_sale"]);

const PENDING_HORIZON_DAYS = 21;
const PENDING_ROW_LIMIT = 10;

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
  const [draftByEvent, setDraftByEvent] = useState<
    Map<string, { id: string; updated_at: string }>
  >(() => new Map());
  // Stabilised "now" — captured once on mount via lazy initializer so
  // milestone math is deterministic across renders and React 19's
  // purity rule for render bodies stays satisfied.
  const [now] = useState(() => new Date());

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
      const [ev, cl, dr] = await Promise.all([
        listEvents(user.id),
        listClients(user.id),
        listDraftsForUserByEvent(user.id),
      ]);
      setEvents(ev);
      setClients(cl);
      setDraftByEvent(dr);
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

  // Pending action: events with an imminent milestone (within
  // PENDING_HORIZON_DAYS) and no campaign draft started yet. Active
  // statuses only — sold_out / completed / cancelled are excluded
  // because no campaign is needed even if a milestone is near.
  const pendingAction = useMemo(() => {
    const matches: Array<{ event: EventWithClient; ms: NonNullable<ReturnType<typeof nextMilestone>> }> = [];
    for (const e of events) {
      if (!ACTIVE_EVENT_STATUSES.has(e.status)) continue;
      if (draftByEvent.has(e.id)) continue;
      const ms = nextMilestone(e, now);
      if (!ms) continue;
      if (ms.daysAway < 0 || ms.daysAway > PENDING_HORIZON_DAYS) continue;
      matches.push({ event: e, ms });
    }
    matches.sort((a, b) => a.ms.daysAway - b.ms.daysAway);
    return {
      visible: matches.slice(0, PENDING_ROW_LIMIT),
      overflow: Math.max(0, matches.length - PENDING_ROW_LIMIT),
    };
  }, [events, draftByEvent, now]);

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
              {/* ───── Pending action ───── */}
              {pendingAction.visible.length > 0 && (
                <section className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-heading text-base tracking-wide">
                      <Zap className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5" />
                      Pending action
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {pendingAction.visible.length + pendingAction.overflow}
                      </span>
                    </h2>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Imminent milestone, no campaign draft yet.
                  </p>
                  <div className="space-y-2">
                    {pendingAction.visible.map(({ event, ms }) => (
                      <PendingActionRow
                        key={event.id}
                        event={event}
                        milestone={ms}
                      />
                    ))}
                  </div>
                  {pendingAction.overflow > 0 && (
                    <Link
                      href="/events?pendingAction=1"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      +{pendingAction.overflow} more
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </section>
              )}

              {/* ───── Today ───── */}
              <Section
                title="Happening today"
                count={partitions.todayEvents.length}
                emptyHint="No shows today."
              >
                {partitions.todayEvents.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    showRelative
                    now={now}
                    latestDraft={draftByEvent.get(e.id) ?? null}
                  />
                ))}
              </Section>

              {/* ───── Upcoming this fortnight ───── */}
              <Section
                title="Upcoming · next 14 days"
                count={partitions.upcoming.length}
                emptyHint="Nothing scheduled in the next fortnight."
              >
                {partitions.upcoming.map((e) => (
                  <EventRow
                    key={e.id}
                    event={e}
                    showRelative
                    now={now}
                    latestDraft={draftByEvent.get(e.id) ?? null}
                  />
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
  now,
  latestDraft,
}: {
  event: EventWithClient;
  showRelative?: boolean;
  tags?: MissingTag[];
  compact?: boolean;
  /** Required when `showRelative` is true; ignored otherwise. */
  now?: Date;
  /** Latest linked draft for this event, if any. */
  latestDraft?: { id: string; updated_at: string } | null;
}) {
  const date = parseDateOnly(e.event_date);
  const ms = showRelative && now ? nextMilestone(e, now) : null;

  // The row-wide click target is the leftmost panel; sibling actions
  // (chip is non-interactive, "Open campaign" is its own link) sit to the
  // right so we don't nest <a> elements.
  const openCampaignHref = latestDraft
    ? `/campaign/${latestDraft.id}?eventId=${e.id}`
    : `/events/${e.id}?tab=campaigns`;

  return (
    <div className="group flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-border-strong">
      <Link
        href={`/events/${e.id}`}
        className="flex min-w-0 flex-1 items-center justify-between gap-4"
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
            {e.client?.name && (
              <span className="truncate">{e.client.name}</span>
            )}
            {e.venue_city && <span>{e.venue_city}</span>}
            {e.capacity != null && (
              <span>{e.capacity.toLocaleString()} cap</span>
            )}
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
            {showRelative && date
              ? fmtRelative(date)
              : date
                ? fmtDay(date)
                : "—"}
          </p>
          {!compact && date && (
            <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <CalendarClock className="h-2.5 w-2.5" />
              {date.toLocaleDateString("en-GB", { weekday: "short" })}
            </p>
          )}
        </div>
      </Link>
      {showRelative && (
        <div className="flex shrink-0 items-center gap-3 pl-1">
          {ms && <MilestoneChip kind={ms.kind} daysAway={ms.daysAway} />}
          <Link
            href={openCampaignHref}
            className="inline-flex items-center whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Open campaign
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Pending action row ──────────────────────────────────────────────────────

function PendingActionRow({
  event,
  milestone,
}: {
  event: EventWithClient;
  milestone: NonNullable<ReturnType<typeof nextMilestone>>;
}) {
  return (
    <div className="group flex items-center justify-between gap-4 rounded-md border border-border bg-card px-4 py-3 transition-colors hover:border-border-strong">
      <div className="min-w-0 flex-1">
        <Link
          href={`/events/${event.id}`}
          className="block truncate text-sm font-medium text-foreground hover:underline underline-offset-2"
        >
          {event.name}
        </Link>
        {event.client?.name && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {event.client.name}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <MilestoneChip kind={milestone.kind} daysAway={milestone.daysAway} />
        <Link
          href={`/events/${event.id}?tab=campaigns`}
          className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
        >
          Start campaign
          <ArrowRight className="h-3 w-3" />
        </Link>
        <Link
          href={`/events/${event.id}`}
          className="hidden whitespace-nowrap text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:inline-flex"
        >
          View event
        </Link>
      </div>
    </div>
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
