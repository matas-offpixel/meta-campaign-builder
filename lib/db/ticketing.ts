import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EventTicketingLink,
  TicketingConnection,
  TicketingConnectionStatus,
  TicketingProviderName,
  TicketSalesSnapshot,
} from "@/lib/ticketing/types";

/**
 * lib/db/ticketing.ts
 *
 * Server-side CRUD for the three ticketing tables introduced in
 * migration 029:
 *   - client_ticketing_connections
 *   - event_ticketing_links
 *   - ticket_sales_snapshots
 *
 * The Supabase generated types in `lib/db/database.types.ts` won't
 * include these tables until Matas runs `supabase gen types` after
 * applying migration 029 locally. Until then, every query goes through
 * a typed cast (`asAnyTable`) so the rest of the codebase compiles
 * without depending on the regenerated union.
 *
 * After regen, drop the casts and switch to
 *   supabase.from("client_ticketing_connections")
 * directly. The runtime behaviour does not change.
 *
 * Auth model: every helper takes the cookie-bound `SupabaseClient`
 * (`createClient` from `lib/supabase/server.ts`). RLS does the per-user
 * scoping; we don't double-check user_id here.
 */

// Accept any concrete SupabaseClient instantiation. Callers are passing
// the cookie-bound `SupabaseClient<Database, ...>` from
// `lib/supabase/server.ts`; using `unknown`-then-cast keeps this lib
// independent of the Database generic so it compiles before / after the
// regen for migration 029.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

function asAnyTable(supabase: AnySupabaseClient): AnySupabaseClient {
  return supabase;
}

// ─── client_ticketing_connections ─────────────────────────────────────────

export async function listConnectionsForUser(
  supabase: AnySupabaseClient,
  options?: { clientId?: string | null },
): Promise<TicketingConnection[]> {
  const sb = asAnyTable(supabase);
  let query = sb
    .from("client_ticketing_connections")
    .select("*")
    .order("created_at", { ascending: false });
  if (options?.clientId) {
    query = query.eq("client_id", options.clientId);
  }
  const { data, error } = await query;
  if (error) {
    console.warn("[ticketing listConnectionsForUser]", error.message);
    return [];
  }
  return (data ?? []) as unknown as TicketingConnection[];
}

export async function getConnectionById(
  supabase: AnySupabaseClient,
  id: string,
): Promise<TicketingConnection | null> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("client_ticketing_connections")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[ticketing getConnectionById]", error.message);
    return null;
  }
  return (data as unknown as TicketingConnection) ?? null;
}

export interface UpsertConnectionInput {
  userId: string;
  clientId: string;
  provider: TicketingProviderName;
  credentials: Record<string, unknown>;
  externalAccountId: string | null;
  status?: TicketingConnectionStatus;
}

/**
 * Upsert by (user_id, client_id, provider). The unique index on the
 * table backs the conflict target. Re-saving an existing connection
 * overwrites credentials + external_account_id and resets status to
 * 'active', clearing any prior `last_error`.
 */
export async function upsertConnection(
  supabase: AnySupabaseClient,
  input: UpsertConnectionInput,
): Promise<TicketingConnection | null> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("client_ticketing_connections")
    .upsert(
      {
        user_id: input.userId,
        client_id: input.clientId,
        provider: input.provider,
        credentials: input.credentials,
        external_account_id: input.externalAccountId,
        status: input.status ?? "active",
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,client_id,provider" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[ticketing upsertConnection]", error.message);
    return null;
  }
  return (data as unknown as TicketingConnection) ?? null;
}

export async function setConnectionStatus(
  supabase: AnySupabaseClient,
  id: string,
  status: TicketingConnectionStatus,
  lastError?: string | null,
): Promise<void> {
  const sb = asAnyTable(supabase);
  const patch: Record<string, unknown> = { status };
  if (lastError !== undefined) patch.last_error = lastError;
  const { error } = await sb
    .from("client_ticketing_connections")
    .update(patch)
    .eq("id", id);
  if (error) {
    console.warn("[ticketing setConnectionStatus]", error.message);
  }
}

export async function recordConnectionSync(
  supabase: AnySupabaseClient,
  id: string,
  result: { ok: boolean; error?: string | null },
): Promise<void> {
  const sb = asAnyTable(supabase);
  const { error } = await sb
    .from("client_ticketing_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: result.ok ? null : (result.error ?? "Unknown error"),
      status: result.ok ? "active" : "error",
    })
    .eq("id", id);
  if (error) {
    console.warn("[ticketing recordConnectionSync]", error.message);
  }
}

export async function deleteConnection(
  supabase: AnySupabaseClient,
  id: string,
): Promise<void> {
  const sb = asAnyTable(supabase);
  const { error } = await sb
    .from("client_ticketing_connections")
    .delete()
    .eq("id", id);
  if (error) {
    console.warn("[ticketing deleteConnection]", error.message);
  }
}

// ─── event_ticketing_links ───────────────────────────────────────────────

export interface UpsertLinkInput {
  userId: string;
  eventId: string;
  connectionId: string;
  externalEventId: string;
  externalEventUrl?: string | null;
}

export async function upsertEventLink(
  supabase: AnySupabaseClient,
  input: UpsertLinkInput,
): Promise<EventTicketingLink | null> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("event_ticketing_links")
    .upsert(
      {
        user_id: input.userId,
        event_id: input.eventId,
        connection_id: input.connectionId,
        external_event_id: input.externalEventId,
        external_event_url: input.externalEventUrl ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,connection_id" },
    )
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[ticketing upsertEventLink]", error.message);
    return null;
  }
  return (data as unknown as EventTicketingLink) ?? null;
}

export async function listLinksForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<EventTicketingLink[]> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("event_ticketing_links")
    .select("*")
    .eq("event_id", eventId);
  if (error) {
    console.warn("[ticketing listLinksForEvent]", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventTicketingLink[];
}

export async function listLinksForConnection(
  supabase: AnySupabaseClient,
  connectionId: string,
): Promise<EventTicketingLink[]> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("event_ticketing_links")
    .select("*")
    .eq("connection_id", connectionId);
  if (error) {
    console.warn("[ticketing listLinksForConnection]", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventTicketingLink[];
}

export async function listAllActiveLinks(
  supabase: AnySupabaseClient,
): Promise<EventTicketingLink[]> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("event_ticketing_links")
    .select("*");
  if (error) {
    console.warn("[ticketing listAllActiveLinks]", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventTicketingLink[];
}

// ─── ticket_sales_snapshots ──────────────────────────────────────────────

export interface InsertSnapshotInput {
  userId: string;
  eventId: string;
  connectionId: string;
  ticketsSold: number;
  ticketsAvailable: number | null;
  grossRevenueCents: number | null;
  currency: string | null;
  rawPayload: unknown;
}

export async function insertSnapshot(
  supabase: AnySupabaseClient,
  input: InsertSnapshotInput,
): Promise<TicketSalesSnapshot | null> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("ticket_sales_snapshots")
    .insert({
      user_id: input.userId,
      event_id: input.eventId,
      connection_id: input.connectionId,
      tickets_sold: input.ticketsSold,
      tickets_available: input.ticketsAvailable,
      gross_revenue_cents: input.grossRevenueCents,
      currency: input.currency,
      raw_payload: input.rawPayload,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[ticketing insertSnapshot]", error.message);
    return null;
  }
  return (data as unknown as TicketSalesSnapshot) ?? null;
}

export async function listRecentSnapshotsForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
  limit = 60,
): Promise<TicketSalesSnapshot[]> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", eventId)
    .order("snapshot_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.warn("[ticketing listRecentSnapshotsForEvent]", error.message);
    return [];
  }
  return (data ?? []) as unknown as TicketSalesSnapshot[];
}

export async function getLatestSnapshotForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<TicketSalesSnapshot | null> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", eventId)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[ticketing getLatestSnapshotForEvent]", error.message);
    return null;
  }
  return (data as unknown as TicketSalesSnapshot) ?? null;
}
