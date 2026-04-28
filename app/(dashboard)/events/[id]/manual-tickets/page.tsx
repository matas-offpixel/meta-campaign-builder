import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ManualTicketsGrid } from "@/components/dashboard/events/manual-tickets-grid";
import { createClient } from "@/lib/supabase/server";
import { getEventByIdServer } from "@/lib/db/events-server";
import { getSnapshotsForEvent } from "@/lib/db/ticket-snapshots";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Bulk catch-up page for events with `provider='manual'` (PR 3 of
 * the overnight bundle). Renders a 30-row grid of (date, tickets
 * sold) cells that the operator can paste into from a spreadsheet
 * or type directly. On save, every row posts to
 * `/api/events/[id]/manual-tickets/bulk` which upserts against the
 * unique (event_id, snapshot_at, source='manual') index.
 *
 * We don't gate the page on the connection already existing — the
 * bulk route will create a manual connection on the fly if the
 * client doesn't have one yet. That keeps "switch to manual" a
 * single-step action from the operator's POV.
 */
export default async function EventManualTicketsPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const event = await getEventByIdServer(id);
  if (!event) notFound();

  // Pre-populate the grid with whatever manual / xlsx snapshots we
  // already hold for this event so the operator sees previously
  // entered data as starting values rather than a blank grid.
  const existingSnapshots = await getSnapshotsForEvent(id, { sinceDays: 60 });

  return (
    <>
      <PageHeader
        title={`${event.name} — manual tickets`}
        description="Bulk-enter cumulative ticket counts for events without an upstream ticketing API."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <Link
            href={`/events/${id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to event
          </Link>
          <ManualTicketsGrid
            eventId={id}
            initialSnapshots={existingSnapshots.map((s) => ({
              snapshotAt: s.snapshot_at.slice(0, 10),
              ticketsSold: s.tickets_sold ?? 0,
            }))}
          />
        </div>
      </main>
    </>
  );
}
