/**
 * Core 4TheFans history backfill (no server-only) — injectable for tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_API_BASE } from "../ticketing/fourthefans/client.ts";
import {
  cumulativeFourthefansSnapshotsFromDeltas,
  fetchFourthefansHistory,
  mergeFourthefansDailyDeltas,
  type FourthefansHistoryDay,
} from "../ticketing/fourthefans/history.ts";
import type {
  EventTicketingLink,
  TicketingConnection,
} from "../ticketing/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export interface FourthefansHistoryBackfillAdapters {
  listLinksForEvent: (
    supabase: AnySupabaseClient,
    eventId: string,
  ) => Promise<EventTicketingLink[]>;
  getConnectionWithDecryptedCredentials: (
    supabase: AnySupabaseClient,
    connectionId: string,
  ) => Promise<TicketingConnection | null>;
  refreshAggregatedTicketsSoldFromSnapshots: (
    supabase: AnySupabaseClient,
    args: { eventId: string; userId: string },
  ) => Promise<void>;
  fetchHistory: typeof fetchFourthefansHistory;
}

export interface BackfillFourthefansHistoryResult {
  inserted: number;
  skipped: number;
  window: { from: string; to: string };
}

function utcYmdFromIso(iso: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim());
  return m ? m[1]! : null;
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function minYmd(a: string, b: string): string {
  return a.localeCompare(b) <= 0 ? a : b;
}

function resolveApiBaseForLink(link: EventTicketingLink): string {
  const trimmed = link.external_api_base?.trim();
  if (trimmed) return trimmed.replace(/\/+$/, "");
  const env = process.env.FOURTHEFANS_API_BASE?.trim();
  if (env) return env.replace(/\/+$/, "");
  return DEFAULT_API_BASE.replace(/\/+$/, "");
}

function externalEventIdToApiNumber(externalEventId: string): number {
  const n = Number.parseInt(externalEventId, 10);
  if (!Number.isFinite(n)) {
    throw new Error(
      `4TheFans history API expects a numeric external_event_id; got "${externalEventId}"`,
    );
  }
  return n;
}

async function resolveDefaultWindow(
  supabase: AnySupabaseClient,
  args: { eventId: string; presaleAt: string | null },
): Promise<{ from: string }> {
  const candidates: string[] = [];

  const { data: earliest } = await supabase
    .from("ticket_sales_snapshots")
    .select("snapshot_at")
    .eq("event_id", args.eventId)
    .order("snapshot_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const earliestDay =
    earliest &&
    typeof (earliest as { snapshot_at?: string }).snapshot_at === "string"
      ? utcYmdFromIso((earliest as { snapshot_at: string }).snapshot_at)
      : null;

  if (earliestDay) {
    candidates.push(addDaysToYmd(earliestDay, -60));
  }

  if (args.presaleAt) {
    const p = utcYmdFromIso(args.presaleAt);
    if (p) candidates.push(p);
  }

  if (candidates.length === 0) {
    candidates.push(addDaysToYmd(todayUtcYmd(), -60));
  }

  let from = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    from = minYmd(from, candidates[i]!);
  }

  return { from };
}

export async function executeFourthefansHistoryBackfill(
  supabase: AnySupabaseClient,
  eventId: string,
  options: { from?: string; to?: string; force?: boolean } | undefined,
  adapters: FourthefansHistoryBackfillAdapters,
): Promise<BackfillFourthefansHistoryResult> {
  const force = options?.force === true;
  const fetchHistory = adapters.fetchHistory;

  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, user_id, presale_at")
    .eq("id", eventId)
    .maybeSingle();

  if (evErr) throw new Error(evErr.message);
  if (!event) throw new Error("Event not found");

  const presaleAt =
    typeof (event as { presale_at?: string | null }).presale_at === "string"
      ? (event as { presale_at: string }).presale_at
      : null;

  let to = options?.to?.trim() || todayUtcYmd();
  let from = options?.from?.trim();
  if (!from) {
    const w = await resolveDefaultWindow(supabase, {
      eventId,
      presaleAt,
    });
    from = w.from;
  }

  if (from.localeCompare(to) > 0) {
    const tmp = from;
    from = to;
    to = tmp;
  }

  const links = await adapters.listLinksForEvent(supabase, eventId);
  const fourthefansLinks: Array<{
    link: EventTicketingLink;
    connection: TicketingConnection;
    token: string;
  }> = [];

  for (const link of links) {
    let decrypted: TicketingConnection | null;
    try {
      decrypted = await adapters.getConnectionWithDecryptedCredentials(
        supabase,
        link.connection_id,
      );
    } catch {
      decrypted = null;
    }
    if (!decrypted || decrypted.provider !== "fourthefans") continue;

    const creds = decrypted.credentials;
    const rawTok =
      typeof creds["access_token"] === "string"
        ? creds["access_token"]
        : typeof creds["api_key"] === "string"
          ? creds["api_key"]
          : "";
    const token = rawTok.trim();
    if (!token) continue;

    fourthefansLinks.push({ link, connection: decrypted, token });
  }

  if (fourthefansLinks.length === 0) {
    throw new Error(
      "No active 4TheFans ticketing link with decrypted credentials for this event.",
    );
  }

  const batches: FourthefansHistoryDay[][] = [];

  for (const { link, token } of fourthefansLinks) {
    const externalNum = externalEventIdToApiNumber(link.external_event_id);
    const baseUrl = resolveApiBaseForLink(link);
    const batch = await fetchHistory({
      eventId: externalNum,
      from,
      to,
      baseUrl,
      token,
    });
    batches.push(batch);
  }

  const merged = mergeFourthefansDailyDeltas(batches);
  const cumulativeRows = cumulativeFourthefansSnapshotsFromDeltas(merged);

  const userId = (event as { user_id: string }).user_id;
  const primaryConnectionId = fourthefansLinks[0]!.connection.id;
  const externalEventIdForRow =
    fourthefansLinks.length === 1
      ? fourthefansLinks[0]!.link.external_event_id
      : null;

  let inserted = 0;
  let skipped = 0;

  for (const row of cumulativeRows) {
    const snapshotAt = `${row.date}T12:00:00.000Z`;

    const { data: existing } = await supabase
      .from("ticket_sales_snapshots")
      .select("id")
      .eq("event_id", eventId)
      .eq("source", "fourthefans")
      .eq("snapshot_at", snapshotAt)
      .maybeSingle();

    const payload = {
      user_id: userId,
      event_id: eventId,
      connection_id: primaryConnectionId,
      external_event_id: externalEventIdForRow,
      snapshot_at: snapshotAt,
      tickets_sold: row.tickets_sold,
      tickets_available: null as number | null,
      gross_revenue_cents: row.gross_revenue_cents,
      currency: "GBP",
      source: "fourthefans" as const,
      raw_payload: {
        fourthefans_history_backfill: true,
        window: { from, to },
      },
    };

    if (existing && !force) {
      skipped += 1;
      continue;
    }

    if (existing && force) {
      const { error: upErr } = await supabase
        .from("ticket_sales_snapshots")
        .update({
          tickets_sold: row.tickets_sold,
          gross_revenue_cents: row.gross_revenue_cents,
          connection_id: primaryConnectionId,
          external_event_id: externalEventIdForRow,
          raw_payload: payload.raw_payload,
        })
        .eq("id", (existing as { id: string }).id);
      if (upErr) throw new Error(upErr.message);
      inserted += 1;
      continue;
    }

    const { error: insErr } = await supabase
      .from("ticket_sales_snapshots")
      .insert(payload);
    if (insErr) throw new Error(insErr.message);
    inserted += 1;
  }

  await adapters.refreshAggregatedTicketsSoldFromSnapshots(supabase, {
    eventId,
    userId,
  });

  return {
    inserted,
    skipped,
    window: { from, to },
  };
}
