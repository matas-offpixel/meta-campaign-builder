import { Suspense } from "react";
import { redirect } from "next/navigation";
import { EventsList } from "@/components/dashboard/events/events-list";
import { listEventsServer } from "@/lib/db/events-server";
import { createClient } from "@/lib/supabase/server";
import {
  parseEventStatus,
  parsePendingAction,
  parseQuery,
  parseUuid,
} from "@/lib/dashboard/format";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Server-side filtered events list. URL contract:
 *   ?client=<uuid>            filter by client_id (validated, drop on bad)
 *   ?status=<event-status>    filter by events.status (whitelisted)
 *   ?q=<text>                 case-insensitive substring on name/venue
 *   ?pendingAction=1          imminent milestone + no draft + active
 *
 * Filter strip lives in <EventsList /> as a Suspense-wrapped client
 * child so the route stays statically prerenderable.
 */
export default async function EventsPage({ searchParams }: Props) {
  const sp = await searchParams;

  const clientId = parseUuid(sp.client) ?? undefined;
  const status = parseEventStatus(sp.status) ?? undefined;
  const q = parseQuery(sp.q) ?? undefined;
  const pendingAction = parsePendingAction(sp.pendingAction);

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

  return (
    <Suspense fallback={null}>
      <EventsList events={events} filtersActive={filtersActive} />
    </Suspense>
  );
}
