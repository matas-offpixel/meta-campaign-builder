import "server-only";

/**
 * lib/dashboard/client-pacing-alerts-server.ts
 *
 * Server-side assembler for the Today dashboard's "Client Pacing Alerts"
 * section (Workstream B). Lists the operator's active clients, loads each
 * client's portal ONCE via the existing `loadClientPortalByClientId`
 * (no new query), derives per-venue pacing rows for active venues, and
 * rolls them up into one alert card per client.
 *
 * Runs entirely in the SSR pass — the Today page Suspense-wraps this so
 * the alerts stream in without a client-side fetch.
 */

import { createClient } from "@/lib/supabase/server";
import { listClientsServer } from "@/lib/db/clients-server";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import { buildClientVenuePacingRows } from "./client-venue-pacing-rows";
import {
  buildClientPacingAlert,
  type ClientPacingAlert,
} from "./venue-pacing-summary";

function venueHref(clientId: string, eventCode: string): string {
  return `/clients/${clientId}/venues/${encodeURIComponent(eventCode)}?tab=pacing`;
}

export async function loadClientPacingAlerts(): Promise<ClientPacingAlert[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const clients = await listClientsServer(user.id, { status: "active" });
  if (clients.length === 0) return [];

  const alerts = await Promise.all(
    clients.map(async (client): Promise<ClientPacingAlert | null> => {
      const portal = await loadClientPortalByClientId(client.id);
      if (!portal.ok) return null;
      const rows = buildClientVenuePacingRows({
        events: portal.events,
        dailyRollups: portal.dailyRollups,
        lifetimeMetaByEventCode: portal.lifetimeMetaByEventCode,
        hrefForVenue: (code) => venueHref(client.id, code),
        activeOnly: true,
      });
      // No active venues → no card (client not actionable today).
      if (rows.length === 0) return null;
      return buildClientPacingAlert({
        clientId: client.id,
        clientName: client.name,
        href: `/clients/${client.id}/dashboard`,
        rows,
      });
    }),
  );

  const present = alerts.filter((a): a is ClientPacingAlert => a != null);

  // Sort: red clients first, then amber, then ok; stable by name within.
  const rank: Record<ClientPacingAlert["severity"], number> = {
    red: 0,
    amber: 1,
    ok: 2,
  };
  present.sort((a, b) => {
    const r = rank[a.severity] - rank[b.severity];
    return r !== 0 ? r : a.clientName.localeCompare(b.clientName);
  });
  return present;
}
