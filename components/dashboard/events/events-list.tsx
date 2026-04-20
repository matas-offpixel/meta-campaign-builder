"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { EventsFilters } from "@/components/dashboard/events/events-filters";
import { useWriteParams } from "@/components/dashboard/_shared/use-write-params";
import { type EventWithClient } from "@/lib/db/events";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import { KindBadge } from "@/components/dashboard/_shared/kind-badge";
import { fmtDate } from "@/lib/dashboard/format";

/**
 * Prop-driven list. Server route fetches the filtered rows and passes
 * them in; this component owns only the page chrome + filter strip.
 * The router import stays for the "New event" header action — the only
 * client-side mutation surface at this level.
 */
export function EventsList({
  events,
  filtersActive,
}: {
  events: EventWithClient[];
  /** True when any of ?client/?status/?q/?pendingAction is set. */
  filtersActive: boolean;
}) {
  const router = useRouter();
  const { writeParams } = useWriteParams();

  const clearFilters = () =>
    writeParams((p) => {
      p.delete("client");
      p.delete("status");
      p.delete("q");
      p.delete("pendingAction");
    });

  return (
    <>
      <PageHeader
        title="Events"
        description="All upcoming and historical shows across clients."
        actions={
          <Button onClick={() => router.push("/events/new")}>
            <Plus className="h-4 w-4" />
            New event
          </Button>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <EventsFilters />

          {events.length === 0 ? (
            filtersActive ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium">
                  No events match these filters.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try widening the search or clearing one of the filters.
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-16 text-center">
                <Ticket className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm font-medium">No events yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Create an event to start planning campaigns and activity.
                </p>
                <div className="mt-4">
                  <Button onClick={() => router.push("/events/new")}>
                    <Plus className="h-4 w-4" />
                    New event
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-2">
              {events.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="block rounded-md border border-border bg-card p-4 transition-colors
                    hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {ev.name}
                        </p>
                        <KindBadge kind={ev.kind} />
                        <StatusPill status={ev.status} kind="event" />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {ev.client?.name && (
                          <span className="font-medium">
                            {ev.client.name}
                          </span>
                        )}
                        {ev.venue_name && <span>{ev.venue_name}</span>}
                        {ev.venue_city && <span>{ev.venue_city}</span>}
                        {ev.capacity != null && (
                          <span>{ev.capacity.toLocaleString()} cap</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      {ev.event_date ? fmtDate(ev.event_date) : "TBD"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
