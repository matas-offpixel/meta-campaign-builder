import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getConnectionWithDecryptedCredentials,
  insertSnapshot,
  recordConnectionSync,
  replaceEventTicketTiers,
  updateEventCapacityFromTicketTiers,
} from "@/lib/db/ticketing";
import { getProvider } from "@/lib/ticketing/registry";
import {
  TicketingProviderDisabledError,
  type EventTicketingLink,
  type TicketingConnection,
} from "@/lib/ticketing/types";

/**
 * GET /api/cron/sync-ticketing
 *
 * Vercel Cron entry point. Walks every active
 * `client_ticketing_connections` row, finds its `event_ticketing_links`,
 * fetches sales via the provider, and writes one
 * `ticket_sales_snapshots` row per link. Per-link errors are isolated —
 * one bad event must never stop the batch — and the per-connection
 * `last_synced_at` / `last_error` columns are updated so the dashboard's
 * health panel can surface stale connections.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`. Vercel Cron
 * sends `Authorization: Bearer $CRON_SECRET` automatically when the env
 * var is set (also via `vercel.json`). Returns 401 on mismatch so a
 * leaked URL alone isn't enough to trigger.
 *
 * The route uses the service-role Supabase client deliberately: there is
 * no human session, and we need to read every active connection across
 * every user to feed the cron. RLS still gates write paths to
 * `tickets_sales_snapshots` via `user_id` columns derived from the
 * connection row — we never trust caller-supplied IDs.
 */

const CRON_TIMEOUT_MS = 8000;

interface ConnectionSyncResult {
  connectionId: string;
  provider: string;
  linksProcessed: number;
  snapshotsWritten: number;
  errors: { linkId: string; message: string }[];
}

interface SyncResponse {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  connectionsConsidered: number;
  connectionsProcessed: number;
  totalSnapshotsWritten: number;
  results: ConnectionSyncResult[];
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  // Vercel Cron historically forwards as `Authorization: <secret>` too.
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  // Pull all active connections in one round-trip; we expect this to
  // stay small (tens, not thousands) for the foreseeable future.
  const { data: rawConnections, error: connErr } = await supabase
    .from("client_ticketing_connections")
    .select("*")
    .eq("status", "active");
  if (connErr) {
    return NextResponse.json(
      { ok: false, error: connErr.message },
      { status: 500 },
    );
  }
  const connections = (rawConnections ?? []) as unknown as TicketingConnection[];

  if (connections.length === 0) {
    const finishedAt = new Date().toISOString();
    const empty: SyncResponse = {
      ok: true,
      startedAt,
      finishedAt,
      connectionsConsidered: 0,
      connectionsProcessed: 0,
      totalSnapshotsWritten: 0,
      results: [],
    };
    return NextResponse.json(empty);
  }

  const results: ConnectionSyncResult[] = [];
  let totalSnapshotsWritten = 0;

  for (const connection of connections) {
    const { data: rawLinks, error: linkErr } = await supabase
      .from("event_ticketing_links")
      .select("*")
      .eq("connection_id", connection.id);
    if (linkErr) {
      await recordConnectionSync(supabase, connection.id, {
        ok: false,
        error: `Failed to load links: ${linkErr.message}`,
      });
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        linksProcessed: 0,
        snapshotsWritten: 0,
        errors: [{ linkId: "(none)", message: linkErr.message }],
      });
      continue;
    }
    const links = (rawLinks ?? []) as unknown as EventTicketingLink[];
    if (links.length === 0) {
      // Connection exists but isn't linked to any event yet — still count
      // the touch so stale connections don't look worse than they are.
      await recordConnectionSync(supabase, connection.id, { ok: true });
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        linksProcessed: 0,
        snapshotsWritten: 0,
        errors: [],
      });
      continue;
    }

    let provider: ReturnType<typeof getProvider>;
    try {
      provider = getProvider(connection.provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await recordConnectionSync(supabase, connection.id, {
        ok: false,
        error: message,
      });
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        linksProcessed: 0,
        snapshotsWritten: 0,
        errors: links.map((l) => ({ linkId: l.id, message })),
      });
      continue;
    }

    // Decrypt credentials once per connection — every link below shares
    // the same token. Service role bypasses RLS so the RPC call inside
    // the helper still resolves; missing-key / decrypt-error states
    // surface as a per-connection failure rather than crashing the cron.
    let decryptedConnection: TicketingConnection | null;
    try {
      decryptedConnection = await getConnectionWithDecryptedCredentials(
        supabase,
        connection.id,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await recordConnectionSync(supabase, connection.id, {
        ok: false,
        error: message,
      });
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        linksProcessed: 0,
        snapshotsWritten: 0,
        errors: links.map((l) => ({ linkId: l.id, message })),
      });
      continue;
    }
    if (!decryptedConnection) {
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        linksProcessed: 0,
        snapshotsWritten: 0,
        errors: links.map((l) => ({
          linkId: l.id,
          message: "Connection vanished mid-cron",
        })),
      });
      continue;
    }
    const connectionForProvider = decryptedConnection;

    const errors: { linkId: string; message: string }[] = [];
    let snapshotsWritten = 0;
    let lastError: string | null = null;
    for (const link of links) {
      try {
        const fetched = await Promise.race([
          provider.getEventSales(
            connectionForProvider,
            link.external_event_id,
          ),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("getEventSales timed out")),
              CRON_TIMEOUT_MS,
            ),
          ),
        ]);
        const sales = fetched as Awaited<
          ReturnType<typeof provider.getEventSales>
        >;
        const snapshot = await insertSnapshot(supabase, {
          userId: connection.user_id,
          eventId: link.event_id,
          connectionId: connection.id,
          ticketsSold: sales.ticketsSold,
          ticketsAvailable: sales.ticketsAvailable,
          grossRevenueCents: sales.grossRevenueCents,
          currency: sales.currency,
          source:
            connection.provider === "fourthefans" ? "fourthefans" : "eventbrite",
          rawPayload: sales.rawPayload,
        });
        if (snapshot) {
          snapshotsWritten += 1;
          totalSnapshotsWritten += 1;
        } else {
          errors.push({
            linkId: link.id,
            message: "Snapshot insert returned no row",
          });
          lastError = "Snapshot insert returned no row";
        }
        if (connection.provider === "fourthefans") {
          await replaceEventTicketTiers(supabase, {
            eventId: link.event_id,
            tiers: sales.ticketTiers ?? [],
            snapshotAt: snapshot?.snapshot_at,
          });
          await updateEventCapacityFromTicketTiers(supabase, {
            eventId: link.event_id,
            userId: connection.user_id,
            tiers: sales.ticketTiers ?? [],
          });
        }
      } catch (err) {
        const isDisabled = err instanceof TicketingProviderDisabledError;
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({
          linkId: link.id,
          message: isDisabled ? `Provider disabled: ${message}` : message,
        });
        lastError = message;
      }
    }

    // Treat the connection as healthy whenever any link succeeded; a
    // single dead link shouldn't paint the whole connection red.
    if (snapshotsWritten > 0 && errors.length === 0) {
      await recordConnectionSync(supabase, connection.id, { ok: true });
    } else if (snapshotsWritten > 0) {
      await recordConnectionSync(supabase, connection.id, {
        ok: false,
        error: `Partial sync: ${errors.length} of ${links.length} link(s) failed. Last: ${lastError ?? "unknown"}`,
      });
    } else {
      await recordConnectionSync(supabase, connection.id, {
        ok: false,
        error: lastError ?? "All links failed",
      });
    }

    results.push({
      connectionId: connection.id,
      provider: connection.provider,
      linksProcessed: links.length,
      snapshotsWritten,
      errors,
    });
  }

  const finishedAt = new Date().toISOString();
  const allOk = results.every((r) => r.errors.length === 0);
  const response: SyncResponse = {
    ok: allOk,
    startedAt,
    finishedAt,
    connectionsConsidered: connections.length,
    connectionsProcessed: results.length,
    totalSnapshotsWritten,
    results,
  };
  return NextResponse.json(response, { status: allOk ? 200 : 207 });
}
