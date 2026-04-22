"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { EventsFilters } from "@/components/dashboard/events/events-filters";
import { EventsPipelineBoard } from "@/components/dashboard/events/events-pipeline-board";
import { useWriteParams } from "@/components/dashboard/_shared/use-write-params";
import { type EventWithClient } from "@/lib/db/events";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import { KindBadge } from "@/components/dashboard/_shared/kind-badge";
import { fmtDate } from "@/lib/dashboard/format";
import type { CampaignPhase } from "@/lib/wizard/phase";

export type EventsView = "list" | "pipeline";

/**
 * Prop-driven list. Server route fetches the filtered rows and passes
 * them in; this component owns the page chrome + filter strip + view
 * toggle. The router import stays for the "New event" header action.
 *
 * `view` is URL-driven (`?view=list|pipeline`) so a deep link survives
 * a refresh and the toggle round-trips cleanly through the existing
 * filter contract.
 */
export function EventsList({
  events,
  filtersActive,
  view,
  phaseByEventId,
  linkedCountByEventId,
}: {
  events: EventWithClient[];
  /** True when any of ?client/?status/?q/?pendingAction is set. */
  filtersActive: boolean;
  /** Current view (default `list`). */
  view: EventsView;
  /**
   * Phase lookup keyed by event id. Computed server-side so we don't
   * need to ship `derivePhase` to the browser. Always present, but
   * may be empty in the list view path where the parent skipped the
   * phase computation.
   */
  phaseByEventId: Record<string, CampaignPhase>;
  /**
   * Per-event linked draft count (any status). Drives the small
   * "linked" badge on pipeline cards. Empty record when the parent
   * couldn't load the join (logged + degraded by the parent).
   */
  linkedCountByEventId: Record<string, number>;
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

  const setView = (next: EventsView) =>
    writeParams((p) => {
      if (next === "list") p.delete("view");
      else p.set("view", next);
    });

  return (
    <>
      <PageHeader
        title="Events"
        description="All upcoming and historical shows across clients."
        actions={
          <>
            <ViewToggle view={view} onChange={setView} />
            <Button onClick={() => router.push("/events/new")}>
              <Plus className="h-4 w-4" />
              New event
            </Button>
          </>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div
          className={
            view === "pipeline"
              ? "mx-auto max-w-[1600px] space-y-4 px-2"
              : "mx-auto max-w-6xl space-y-4"
          }
        >
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
          ) : view === "pipeline" ? (
            <EventsPipelineBoard
              events={events}
              phaseOf={(eventId) => phaseByEventId[eventId] ?? "Campaign"}
              linkedCountOf={(eventId) => linkedCountByEventId[eventId] ?? 0}
            />
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

/**
 * Two-button segmented control. Sits in the page header next to the
 * "New event" CTA and writes `?view=pipeline|<absent>` to the URL so
 * deep-links round-trip cleanly.
 */
function ViewToggle({
  view,
  onChange,
}: {
  view: EventsView;
  onChange: (next: EventsView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Switch events view"
      className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5"
    >
      <ToggleButton
        active={view === "list"}
        onClick={() => onChange("list")}
        aria-label="List view"
      >
        <List className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">List</span>
      </ToggleButton>
      <ToggleButton
        active={view === "pipeline"}
        onClick={() => onChange("pipeline")}
        aria-label="Pipeline view"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Pipeline</span>
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
  ...rest
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      ].join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}
