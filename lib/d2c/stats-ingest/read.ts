/**
 * lib/d2c/stats-ingest/read.ts
 *
 * Read helpers for HE3's panel (no UI here). Service-role reads of
 * d2c_broadcast_stats (migration 246 has no authenticated read).
 *
 *   getEventD2CStats(db, eventId)   the show's own sends
 *   getClientD2CStats(db, clientId) every send under the client: its
 *                                   shows' sends plus whole-list sends
 *
 * Every read pages with `.range()` ordered by the primary key
 * (lib/db/paged-read.ts). Archived clients read as empty.
 *
 * Relative imports only (node --test).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../../db/paged-read.ts";
import { loadArchivedClientIds } from "../../db/client-status.ts";
import { summariseD2CStats, type D2CStatsSummary, type MessageRate, type StoredStatsRow } from "./summary.ts";

type Db = Pick<SupabaseClient, "from">;

export const STATS_COLUMNS =
  "id, provider, account_id, external_id, channel, client_id, event_id, attribution, audience_kind, name, sent_at, list_id, sent, delivered, read, clicked, opens_unique_raw, opens_unique_filtered, open_rate_filtered, fetched_at";

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** PostgREST returns numeric columns as strings; normalise them. */
export function normaliseStatsRow(raw: Record<string, unknown>): StoredStatsRow {
  return {
    ...(raw as unknown as StoredStatsRow),
    sent: toNumber(raw.sent),
    delivered: toNumber(raw.delivered),
    read: toNumber(raw.read),
    clicked: toNumber(raw.clicked),
    opens_unique_raw: toNumber(raw.opens_unique_raw),
    opens_unique_filtered: toNumber(raw.opens_unique_filtered),
    open_rate_filtered: toNumber(raw.open_rate_filtered),
  };
}

export async function loadStatsRows(
  db: Db,
  filter: { clientId?: string; eventId?: string },
): Promise<StoredStatsRow[]> {
  const rows = await loadAllPaged<Record<string, unknown>>(db, "d2c_broadcast_stats", STATS_COLUMNS, ["id"], (q) => {
    let query = q;
    if (filter.clientId) query = query.eq("client_id", filter.clientId);
    if (filter.eventId) query = query.eq("event_id", filter.eventId);
    return query;
  });
  return rows.map(normaliseStatsRow);
}

/** The client's WhatsApp per-message rate (null until Matas sets it). */
export async function loadMessageRate(db: Db, clientId: string): Promise<MessageRate> {
  const { data, error } = await db
    .from("clients")
    .select("whatsapp_message_rate, whatsapp_message_rate_currency")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`clients rate: ${error.message}`);
  const row = (data ?? {}) as { whatsapp_message_rate?: unknown; whatsapp_message_rate_currency?: unknown };
  const currency =
    typeof row.whatsapp_message_rate_currency === "string" && row.whatsapp_message_rate_currency
      ? row.whatsapp_message_rate_currency
      : "GBP";
  return { rate: toNumber(row.whatsapp_message_rate), currency };
}

function empty(rate: MessageRate): D2CStatsSummary {
  return summariseD2CStats([], rate);
}

export async function getClientD2CStats(db: Db, clientId: string): Promise<D2CStatsSummary> {
  const archived = await loadArchivedClientIds(db);
  const rate = await loadMessageRate(db, clientId);
  if (archived.has(clientId)) return empty(rate);
  const rows = await loadStatsRows(db, { clientId });
  return summariseD2CStats(rows, rate);
}

/** A client's show, as HE3's venue rule (PI6) needs it. */
export interface D2CShowVenue {
  id: string;
  venue_key: string | null;
  mailchimp_audience_id: string | null;
}

/** Everything HE3's panel needs for every scope of one client, read once. */
export interface ClientD2CInput {
  rows: StoredStatsRow[];
  rate: MessageRate;
  shows: D2CShowVenue[];
  /** PI6: sends on an account this client uses that couldn't be tied to a client (internal review line only). */
  unattributed: number;
}

/**
 * Unattributed sends (client_id null) on the accounts this client's own
 * sends were read from: a shared account such as GMC and Throwback's Bird
 * workspace.
 */
export async function loadUnattributedCount(db: Db, accountIds: readonly string[]): Promise<number> {
  const ids = [...new Set(accountIds)];
  if (!ids.length) return 0;
  const rows = await loadAllPaged<{ id: string }>(db, "d2c_broadcast_stats", "id", ["id"], (q) =>
    q.eq("attribution", "unattributed").in("account_id", ids),
  );
  return rows.length;
}

export async function loadClientD2CInput(db: Db, clientId: string): Promise<ClientD2CInput> {
  const archived = await loadArchivedClientIds(db);
  const rate = await loadMessageRate(db, clientId);
  if (archived.has(clientId)) return { rows: [], rate, shows: [], unattributed: 0 };
  const [rows, shows] = await Promise.all([
    loadStatsRows(db, { clientId }),
    loadAllPaged<D2CShowVenue>(db, "events", "id,venue_key,mailchimp_audience_id", ["id"], (q) => q.eq("client_id", clientId)),
  ]);
  const unattributed = await loadUnattributedCount(db, rows.map((r) => r.account_id));
  return { rows, rate, shows, unattributed };
}

/**
 * The show's sends only (whole-list sends stay under the client). The
 * "est." open ratio is the client's own, over all its email sends.
 */
export async function getEventD2CStats(db: Db, eventId: string): Promise<D2CStatsSummary> {
  const { data, error } = await db.from("events").select("id, client_id").eq("id", eventId).maybeSingle();
  if (error) throw new Error(`events: ${error.message}`);
  const clientId = (data as { client_id?: string | null } | null)?.client_id ?? null;
  if (!clientId) return empty({ rate: null, currency: "GBP" });
  const archived = await loadArchivedClientIds(db);
  const rate = await loadMessageRate(db, clientId);
  if (archived.has(clientId)) return empty(rate);
  const clientRows = await loadStatsRows(db, { clientId });
  const showRows = clientRows.filter((r) => r.event_id === eventId);
  return summariseD2CStats(showRows, rate, clientRows);
}
