/**
 * GET /api/cron/ticket-history-sync
 *
 * Vercel Cron (schedule: 30 6,12,18,22 * * *) — four times daily, offset from
 * sync-ticketing (0 6,10,14,18,22) to avoid double-taxing the ticketing APIs.
 *
 * Walks every active `client_ticketing_connections` row (eventbrite +
 * fourthefans), finds its `event_ticketing_links`, and calls the per-attendee
 * helper for the last 7 days, upserting into `event_daily_ticket_history`.
 *
 * Sources:
 *   - eventbrite  → fetchDailyOrdersForEvent (orders expand=attendees, grouped
 *                   by order.created in the event timezone). Pulls all orders
 *                   then filters client-side to the 7-day window.
 *   - fourthefans → fetchFourthefansHistory (daily deltas from /events/{id}/sales,
 *                   passing from/to directly so the API only returns recent rows).
 *
 * Anti-drift guarantees:
 *   - Does NOT modify ticket_sales_snapshots.
 *   - Does NOT write to event_daily_rollups.
 *   - All writes go exclusively to event_daily_ticket_history via upsert
 *     (idempotent keyed on event_id, date, source).
 *
 * Auth: Bearer $CRON_SECRET (same pattern as sync-ticketing). Returns 401 on
 * mismatch.
 *
 * Timeout design:
 *   - maxDuration=300 (5 min Vercel limit).
 *   - BUDGET_MS=270 000 — loop breaks 30 s before maxDuration.
 *   - Per-link timeout of 20 s with one retry on timeout.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getConnectionWithDecryptedCredentials } from "@/lib/db/ticketing";
import {
  upsertDailyTicketHistoryBatch,
  type UpsertDailyTicketHistoryInput,
} from "@/lib/db/ticket-history";
import { fetchDailyOrdersForEvent } from "@/lib/ticketing/eventbrite/orders";
import {
  fetchFourthefansHistory,
  type FourthefansHistoryDay,
} from "@/lib/ticketing/fourthefans/history";
import { DEFAULT_API_BASE } from "@/lib/ticketing/fourthefans/client";
import type { EventTicketingLink, TicketingConnection } from "@/lib/ticketing/types";

export const maxDuration = 300;

const LINK_TIMEOUT_MS = 20_000;
const BUDGET_MS = 270_000; // 30 s headroom before maxDuration
const HISTORY_DAYS = 7;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function nDaysAgoYmd(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function resolveApiBaseForLink(link: EventTicketingLink): string {
  const trimmed = link.external_api_base?.trim();
  if (trimmed) return trimmed.replace(/\/+$/, "");
  const env = process.env.FOURTHEFANS_API_BASE?.trim();
  if (env) return env.replace(/\/+$/, "");
  return DEFAULT_API_BASE.replace(/\/+$/, "");
}

function externalIdToNumber(externalEventId: string): number {
  const n = Number.parseInt(externalEventId, 10);
  if (!Number.isFinite(n)) {
    throw new Error(
      `4TheFans history API expects a numeric external_event_id; got "${externalEventId}"`,
    );
  }
  return n;
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

async function fetchWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("history fetch timed out")), timeoutMs),
    ),
  ]);
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retries = 1,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1500 * attempt);
    try {
      return await fetchWithTimeout(fn, timeoutMs);
    } catch (err) {
      lastErr = err;
      const isTimeout = err instanceof Error && err.message.includes("timed out");
      if (!isTimeout) throw err;
    }
  }
  throw lastErr;
}

interface LinkSyncResult {
  linkId: string;
  eventId: string;
  provider: string;
  rowsUpserted: number;
  error?: string;
}

interface SyncResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  window: { from: string; to: string };
  linksConsidered: number;
  linksProcessed: number;
  totalRowsUpserted: number;
  budget_exceeded?: boolean;
  results: LinkSyncResult[];
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const startEpoch = Date.now();
  const from = nDaysAgoYmd(HISTORY_DAYS);
  const to = todayYmd();

  const supabase = createServiceRoleClient();

  // Fetch all active connections (eventbrite + fourthefans).
  const { data: rawConnections, error: connErr } = await supabase
    .from("client_ticketing_connections")
    .select("*")
    .eq("status", "active")
    .in("provider", ["eventbrite", "fourthefans"]);

  if (connErr) {
    return NextResponse.json({ ok: false, error: connErr.message }, { status: 500 });
  }

  const connections = (rawConnections ?? []) as unknown as TicketingConnection[];

  if (connections.length === 0) {
    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      window: { from, to },
      linksConsidered: 0,
      linksProcessed: 0,
      totalRowsUpserted: 0,
      results: [],
    } satisfies SyncResult);
  }

  const results: LinkSyncResult[] = [];
  let totalRowsUpserted = 0;
  let budgetExceeded = false;

  for (const connection of connections) {
    if (Date.now() - startEpoch > BUDGET_MS) {
      budgetExceeded = true;
      break;
    }

    // Decrypt credentials once per connection.
    let decryptedConnection: TicketingConnection | null = null;
    try {
      decryptedConnection = await getConnectionWithDecryptedCredentials(
        supabase,
        connection.id,
      );
    } catch (err) {
      results.push({
        linkId: "(none)",
        eventId: "(none)",
        provider: connection.provider,
        rowsUpserted: 0,
        error: `Credential decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!decryptedConnection) continue;

    // Load all links for this connection.
    const { data: rawLinks, error: linkErr } = await supabase
      .from("event_ticketing_links")
      .select("*, events!inner(id, event_timezone, user_id)")
      .eq("connection_id", connection.id);

    if (linkErr) {
      results.push({
        linkId: "(none)",
        eventId: "(none)",
        provider: connection.provider,
        rowsUpserted: 0,
        error: `Links load failed: ${linkErr.message}`,
      });
      continue;
    }

    const links = (rawLinks ?? []) as unknown as Array<
      EventTicketingLink & {
        events: { id: string; event_timezone: string | null; user_id: string } | null;
      }
    >;

    for (const link of links) {
      if (Date.now() - startEpoch > BUDGET_MS) {
        budgetExceeded = true;
        break;
      }

      const eventId = link.event_id;
      const eventTimezone = link.events?.event_timezone ?? null;
      const userId = link.events?.user_id ?? connection.user_id;

      try {
        const rows: UpsertDailyTicketHistoryInput[] = [];

        if (connection.provider === "eventbrite") {
          const result = await callWithRetry(
            () =>
              fetchDailyOrdersForEvent({
                connection: decryptedConnection!,
                externalEventId: link.external_event_id,
                eventTimezone,
              }),
            LINK_TIMEOUT_MS,
          );
          // Filter to the last HISTORY_DAYS window.
          for (const r of result.rows) {
            if (r.date >= from && r.date <= to) {
              rows.push({
                userId,
                eventId,
                date: r.date,
                source: "eventbrite_orders",
                ticketsSold: r.ticketsSold,
                revenueMajor: r.revenue,
                currency: result.currency,
              });
            }
          }
        } else if (connection.provider === "fourthefans") {
          const baseUrl = resolveApiBaseForLink(link);
          const token =
            typeof decryptedConnection.credentials?.["access_token"] === "string"
              ? decryptedConnection.credentials["access_token"]
              : "";
          if (!token) throw new Error("Missing access_token");

          const deltas: FourthefansHistoryDay[] = await callWithRetry(
            () =>
              fetchFourthefansHistory({
                eventId: externalIdToNumber(link.external_event_id),
                from,
                to,
                baseUrl,
                token,
              }),
            LINK_TIMEOUT_MS,
          );
          for (const d of deltas) {
            rows.push({
              userId,
              eventId,
              date: d.date,
              source: "fourthefans_history",
              ticketsSold: d.tickets_sold,
              revenueMajor: d.revenue,
              currency: null,
            });
          }
        }

        if (rows.length > 0) {
          await upsertDailyTicketHistoryBatch(supabase, rows);
        }

        results.push({
          linkId: link.id,
          eventId,
          provider: connection.provider,
          rowsUpserted: rows.length,
        });
        totalRowsUpserted += rows.length;
      } catch (err) {
        results.push({
          linkId: link.id,
          eventId,
          provider: connection.provider,
          rowsUpserted: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (budgetExceeded) break;
  }

  const finishedAt = new Date().toISOString();
  const errorCount = results.filter((r) => r.error).length;
  const response: SyncResult = {
    ok: !budgetExceeded && errorCount === 0,
    startedAt,
    finishedAt,
    window: { from, to },
    linksConsidered: results.length,
    linksProcessed: results.filter((r) => !r.error).length,
    totalRowsUpserted,
    ...(budgetExceeded && { budget_exceeded: true }),
    results,
  };

  return NextResponse.json(response, { status: response.ok ? 200 : 207 });
}
