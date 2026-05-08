import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getConnectionById,
  getConnectionWithDecryptedCredentials,
  insertSnapshot,
  listLinksForEvent,
  recordConnectionSync,
  replaceEventTicketTiers,
  updateEventCapacityFromTicketTiers,
} from "@/lib/db/ticketing";
import { getProvider } from "@/lib/ticketing/registry";
import {
  TicketingProviderDisabledError,
  type TicketTierBreakdown,
} from "@/lib/ticketing/types";

/**
 * POST /api/ticketing/sync?eventId=X
 *
 * Force-syncs ticket sales for a single internal event. Iterates every
 * `event_ticketing_links` row for the event, calls `getEventSales` on
 * the matching provider, writes one `ticket_sales_snapshots` row per
 * link, and records the success / error on the connection.
 *
 * One bad link does not stop the batch — every link's outcome is
 * captured in the response so the dashboard can surface partial-failure
 * states cleanly.
 */

interface LinkSyncResult {
  linkId: string;
  connectionId: string;
  provider: string;
  ok: boolean;
  ticketsSold?: number;
  error?: string;
  disabled?: boolean;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const links = await listLinksForEvent(supabase, eventId);
  if (links.length === 0) {
    return NextResponse.json({
      ok: true,
      results: [] as LinkSyncResult[],
      note: "No ticketing links — connect a provider on the client first.",
    });
  }

  const results: LinkSyncResult[] = [];
  const tierBatches: TicketTierBreakdown[][] = [];
  let capacitySource: string | undefined;

  for (const link of links) {
    // Decrypt credentials on demand — the row in `event_ticketing_links`
    // only carries the connection id, so we re-resolve here. Provider
    // calls below MUST use the decrypted variant; the registry-side
    // providers expect a populated `credentials.personal_token`.
    let connection;
    try {
      connection = await getConnectionWithDecryptedCredentials(
        supabase,
        link.connection_id,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      // Best-effort: also flip the connection row to `error` so the
      // dashboard pill surfaces the same message instead of staying
      // green. Use the cheaper non-decrypting helper for the lookup
      // so a missing key here doesn't recurse.
      const fallback = await getConnectionById(supabase, link.connection_id);
      if (fallback) {
        await recordConnectionSync(supabase, fallback.id, {
          ok: false,
          error: message,
        });
      }
      results.push({
        linkId: link.id,
        connectionId: link.connection_id,
        provider: fallback?.provider ?? "(unknown)",
        ok: false,
        error: message,
      });
      continue;
    }
    if (!connection) {
      results.push({
        linkId: link.id,
        connectionId: link.connection_id,
        provider: "(unknown)",
        ok: false,
        error: "Connection vanished — re-create the link.",
      });
      continue;
    }
    try {
      const provider = getProvider(connection.provider);
      const fetched = await provider.getEventSales(
        connection,
        link.external_event_id,
        { apiBase: link.external_api_base ?? null },
      );
      await insertSnapshot(supabase, {
        userId: user.id,
        eventId,
        connectionId: connection.id,
        externalEventId: link.external_event_id,
        ticketsSold: fetched.ticketsSold,
        ticketsAvailable: fetched.ticketsAvailable,
        grossRevenueCents: fetched.grossRevenueCents,
        currency: fetched.currency,
        source:
          connection.provider === "fourthefans" ? "fourthefans" : "eventbrite",
        rawPayload: fetched.rawPayload,
      });
      if (fetched.ticketTiers?.length) {
        tierBatches.push(fetched.ticketTiers);
        capacitySource = connection.provider;
      }
      await recordConnectionSync(supabase, connection.id, { ok: true });
      results.push({
        linkId: link.id,
        connectionId: connection.id,
        provider: connection.provider,
        ok: true,
        ticketsSold: fetched.ticketsSold,
      });
    } catch (err) {
      const isDisabled = err instanceof TicketingProviderDisabledError;
      const message = err instanceof Error ? err.message : "Unknown error";
      await recordConnectionSync(supabase, connection.id, {
        ok: false,
        error: message,
      });
      results.push({
        linkId: link.id,
        connectionId: connection.id,
        provider: connection.provider,
        ok: false,
        error: message,
        disabled: isDisabled,
      });
    }
  }

  let tierWriteError: string | null = null;
  if (tierBatches.length > 0) {
    const mergedTiers = tierBatches.flat();
    try {
      await replaceEventTicketTiers(supabase, {
        eventId,
        tiers: mergedTiers,
        snapshotAt: new Date().toISOString(),
      });
      await updateEventCapacityFromTicketTiers(supabase, {
        eventId,
        userId: user.id,
        tiers: mergedTiers,
        source: capacitySource ?? "fourthefans",
      });
    } catch (err) {
      tierWriteError = err instanceof Error ? err.message : "Tier write failed";
      console.error(`[ticketing/sync] tier upsert failed event_id=${eventId}: ${tierWriteError}`);
    }
  }

  const allOk = results.every((r) => r.ok) && tierWriteError === null;
  return NextResponse.json(
    { ok: allOk, results, tierWriteError },
    { status: allOk ? 200 : 207 },
  );
}
