import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EventsList, type EventsView } from "@/components/dashboard/events/events-list";
import { listEventsServer } from "@/lib/db/events-server";
import { createClient } from "@/lib/supabase/server";
import {
  parseEventStatus,
  parsePendingAction,
  parseQuery,
  parseUuid,
} from "@/lib/dashboard/format";
import { derivePhase, type CampaignPhase } from "@/lib/wizard/phase";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

function parseView(value: string | string[] | undefined): EventsView {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "pipeline" ? "pipeline" : "list";
}

/**
 * Server-side filtered events list. URL contract:
 *   ?client=<uuid>            filter by client_id (validated, drop on bad)
 *   ?status=<event-status>    filter by events.status (whitelisted)
 *   ?q=<text>                 case-insensitive substring on name/venue
 *   ?pendingAction=1          imminent milestone + no draft + active
 *   ?view=list|pipeline       rendering variant (default `list`)
 *
 * Filter strip lives in <EventsList /> as a Suspense-wrapped client
 * child so the route stays statically prerenderable. The pipeline
 * view also needs a {eventId → phase} map and a {eventId → linked
 * draft count} map; both are computed here so we never ship
 * `derivePhase` or a second supabase round-trip down to the browser.
 */
export default async function EventsPage({ searchParams }: Props) {
  const sp = await searchParams;

  const clientId = parseUuid(sp.client) ?? undefined;
  const status = parseEventStatus(sp.status) ?? undefined;
  const q = parseQuery(sp.q) ?? undefined;
  const pendingAction = parsePendingAction(sp.pendingAction);
  const view = parseView(sp.view);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const events = await listEventsServer(user.id, {
    clientId,
    status,
    q,
    pendingAction,
  });

  const filtersActive = Boolean(clientId || status || q || pendingAction);

  // Phase + linked-counts only matter for the pipeline view. Skip both
  // round-trips when the user is on the default list to keep that path
  // unchanged; if the supabase fetch fails we degrade to an empty map
  // (cards just hide the linked badge) rather than 500 the page.
  let phaseByEventId: Record<string, CampaignPhase> = {};
  let linkedCountByEventId: Record<string, number> = {};

  if (view === "pipeline" && events.length > 0) {
    const now = new Date();
    phaseByEventId = Object.fromEntries(
      events.map((ev) => [ev.id, derivePhase(ev, now)] as const),
    );

    const eventIds = events.map((e) => e.id);
    const { data: drafts, error: draftsErr } = await supabase
      .from("campaign_drafts")
      .select("event_id")
      .in("event_id", eventIds);
    if (draftsErr) {
      console.warn("[events-page] linked drafts fetch error:", draftsErr.message);
    } else {
      const counts: Record<string, number> = {};
      for (const row of (drafts ?? []) as { event_id: string | null }[]) {
        if (!row.event_id) continue;
        counts[row.event_id] = (counts[row.event_id] ?? 0) + 1;
      }
      linkedCountByEventId = counts;
    }
  }

  return (
    <Suspense fallback={null}>
      <EventsList
        events={events}
        filtersActive={filtersActive}
        view={view}
        phaseByEventId={phaseByEventId}
        linkedCountByEventId={linkedCountByEventId}
      />
    </Suspense>
  );
}
