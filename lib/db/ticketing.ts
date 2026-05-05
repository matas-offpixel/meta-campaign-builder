import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getTicketingTokenKey } from "@/lib/ticketing/secrets";
import type {
  EventTicketingLink,
  TicketTierBreakdown,
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

/**
 * Same as `getConnectionById` but populates `credentials` with the
 * decrypted JSON pulled from `credentials_encrypted` via the
 * `get_ticketing_credentials` RPC (migration 038).
 *
 * Three precedence rules:
 *   1. If `credentials_encrypted` exists, decrypt it and use that.
 *   2. Otherwise (legacy row pre-migration 038) fall back to the
 *      plaintext `credentials` jsonb column. Any in-place re-save will
 *      flip the row over to the encrypted path.
 *   3. If both are empty, return the row with `credentials: {}`. The
 *      provider's `validateCredentials` / `getEventSales` will then
 *      throw a clear "missing personal_token" error.
 *
 * Throws `MissingTokenKeyError` when the provider-specific encryption key
 * is unset. Without the key we have no way to decrypt this connection,
 * and we'd rather surface that as a 500 than as an opaque provider error.
 */
export async function getConnectionWithDecryptedCredentials(
  supabase: AnySupabaseClient,
  id: string,
): Promise<TicketingConnection | null> {
  const sb = asAnyTable(supabase);
  const row = await getConnectionById(supabase, id);
  if (!row) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRow = row as unknown as Record<string, any>;
  const hasEncryptedBlob = rawRow.credentials_encrypted != null;

  if (hasEncryptedBlob) {
    const key = getTicketingTokenKey(row.provider);
    const { data, error } = await sb.rpc("get_ticketing_credentials", {
      p_connection_id: id,
      p_key: key,
    });
    if (error) {
      console.warn(
        "[ticketing getConnectionWithDecryptedCredentials] decrypt failed:",
        error.message,
      );
      throw new Error(
        "Could not decrypt the saved ticketing credentials. Re-save the connection on the client's Ticketing tab.",
      );
    }
    if (typeof data === "string" && data.length > 0) {
      let parsed: Record<string, unknown> = {};
      try {
        const obj = JSON.parse(data);
        if (obj && typeof obj === "object") {
          parsed = obj as Record<string, unknown>;
        }
      } catch {
        // Should not happen — `set_ticketing_credentials` always
        // stores JSON-stringified objects. Leave parsed = {} so the
        // provider surfaces "missing personal_token" rather than
        // crashing the caller.
      }
      return { ...row, credentials: parsed };
    }
  }

  // Legacy path: row pre-dates migration 038 and still has plaintext
  // credentials in the jsonb column. Pass through unchanged.
  return row;
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
 *
 * Two-step write so we never persist plaintext credentials in the
 * legacy `credentials jsonb` column:
 *
 *   1. Upsert the row with `credentials = '{}'::jsonb`. This sets
 *      everything except the secret and gives us back the row id.
 *   2. Call `set_ticketing_credentials(id, json, key)` (migration 038)
 *      which `pgp_sym_encrypt`s the JSON-stringified credentials into
 *      `credentials_encrypted` and re-asserts the empty jsonb in the
 *      same statement.
 *
 * Callers must have the provider-specific encryption key set; we throw
 * via `MissingTokenKeyError` otherwise so the API route can surface a
 * clear 500 rather than silently storing a row that nothing can ever
 * decrypt.
 */
export async function upsertConnection(
  supabase: AnySupabaseClient,
  input: UpsertConnectionInput,
): Promise<TicketingConnection | null> {
  const sb = asAnyTable(supabase);
  // Read the key BEFORE any write so a misconfigured environment fails
  // fast instead of leaving a half-saved row behind.
  const key = getTicketingTokenKey(input.provider);

  const { data, error } = await sb
    .from("client_ticketing_connections")
    .upsert(
      {
        user_id: input.userId,
        client_id: input.clientId,
        provider: input.provider,
        // Plaintext column is permanently `{}` for new writes; the
        // real secret lives in `credentials_encrypted`, populated by
        // the RPC below.
        credentials: {},
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
  if (!data) return null;
  const row = data as unknown as TicketingConnection;

  // Encrypt + persist the credentials blob. JSON.stringify keeps the
  // payload shape opaque to pgcrypto so we don't have to teach the
  // SQL layer anything about provider-specific fields.
  const plaintext = JSON.stringify(input.credentials ?? {});
  const { error: rpcError } = await sb.rpc("set_ticketing_credentials", {
    p_connection_id: row.id,
    p_plaintext: plaintext,
    p_key: key,
  });
  if (rpcError) {
    console.warn(
      "[ticketing upsertConnection] set_ticketing_credentials failed:",
      rpcError.message,
    );
    return null;
  }

  return row;
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
  console.info(
    `[ticketing upsertEventLink] attempt event_id=${input.eventId} connection_id=${input.connectionId} external_event_id=${input.externalEventId}`,
  );
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
    console.warn(
      `[ticketing upsertEventLink] failed event_id=${input.eventId} connection_id=${input.connectionId} external_event_id=${input.externalEventId}: ${error.message}`,
    );
    return null;
  }
  const link = (data as unknown as EventTicketingLink) ?? null;
  if (link) {
    console.info(
      `[ticketing upsertEventLink] ok link_id=${link.id} event_id=${link.event_id} connection_id=${link.connection_id} external_event_id=${link.external_event_id}`,
    );
  }
  return link;
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
  source?:
    | "eventbrite"
    | "fourthefans"
    | "manual"
    | "xlsx_import"
    | "foursomething";
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
      source: input.source ?? "eventbrite",
      raw_payload: input.rawPayload,
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.warn("[ticketing insertSnapshot]", error.message);
    return null;
  }
  const snapshot = (data as unknown as TicketSalesSnapshot) ?? null;
  if (snapshot) {
    await mirrorEventTicketsSold(supabase, {
      eventId: input.eventId,
      userId: input.userId,
      ticketsSold: input.ticketsSold,
    });
  }
  return snapshot;
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

export async function getLatestSnapshotForEventBeforeDate(
  supabase: AnySupabaseClient,
  args: { eventId: string; beforeDate: string },
): Promise<TicketSalesSnapshot | null> {
  const sb = asAnyTable(supabase);
  const beforeIso = `${args.beforeDate}T00:00:00.000Z`;
  const { data, error } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", args.eventId)
    .lt("snapshot_at", beforeIso)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[ticketing getLatestSnapshotForEventBeforeDate]", error.message);
    return null;
  }
  return (data as unknown as TicketSalesSnapshot) ?? null;
}

export async function getEarliestSnapshotForEventSource(
  supabase: AnySupabaseClient,
  args: { eventId: string; source: TicketSalesSnapshot["source"] },
): Promise<TicketSalesSnapshot | null> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", args.eventId)
    .eq("source", args.source)
    .order("snapshot_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[ticketing getEarliestSnapshotForEventSource]", error.message);
    return null;
  }
  return (data as unknown as TicketSalesSnapshot) ?? null;
}

export interface EventTicketTierRow {
  id: string;
  event_id: string;
  tier_name: string;
  price: number | null;
  quantity_sold: number;
  quantity_available: number | null;
  snapshot_at: string;
  created_at?: string;
  updated_at?: string;
}

export async function replaceEventTicketTiers(
  supabase: AnySupabaseClient,
  args: {
    eventId: string;
    tiers: TicketTierBreakdown[];
    snapshotAt?: string;
  },
): Promise<number> {
  const sb = asAnyTable(supabase);
  const snapshotAt = args.snapshotAt ?? new Date().toISOString();
  const rows = args.tiers
    .map((tier) => ({
      event_id: args.eventId,
      tier_name: tier.tierName.trim(),
      price: tier.price,
      quantity_sold: Math.max(0, Math.trunc(tier.quantitySold)),
      quantity_available:
        tier.quantityAvailable == null
          ? null
          : Math.max(0, Math.trunc(tier.quantityAvailable)),
      snapshot_at: snapshotAt,
      updated_at: snapshotAt,
    }))
    .filter((tier) => tier.tier_name.length > 0);

  if (rows.length === 0) {
    const { error } = await sb
      .from("event_ticket_tiers")
      .delete()
      .eq("event_id", args.eventId);
    if (error) {
      console.warn("[ticketing replaceEventTicketTiers delete]", error.message);
    }
    return 0;
  }

  const { error } = await sb
    .from("event_ticket_tiers")
    .upsert(rows, { onConflict: "event_id,tier_name" });
  if (error) {
    console.warn("[ticketing replaceEventTicketTiers upsert]", error.message);
    return 0;
  }

  const tierNames = rows.map((tier) => tier.tier_name);
  const { error: staleError } = await sb
    .from("event_ticket_tiers")
    .delete()
    .eq("event_id", args.eventId)
    .not("tier_name", "in", `(${tierNames.map(quotePostgrestValue).join(",")})`);
  if (staleError) {
    console.warn(
      "[ticketing replaceEventTicketTiers stale delete]",
      staleError.message,
    );
  }

  return rows.length;
}

export async function listEventTicketTiers(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<EventTicketTierRow[]> {
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("event_ticket_tiers")
    .select("*")
    .eq("event_id", eventId)
    .order("price", { ascending: true, nullsFirst: false })
    .order("tier_name", { ascending: true });
  if (error) {
    console.warn("[ticketing listEventTicketTiers]", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventTicketTierRow[];
}

export async function listEventTicketTiersForEvents(
  supabase: AnySupabaseClient,
  eventIds: string[],
): Promise<EventTicketTierRow[]> {
  if (eventIds.length === 0) return [];
  const sb = asAnyTable(supabase);
  const { data, error } = await sb
    .from("event_ticket_tiers")
    .select("*")
    .in("event_id", eventIds)
    .order("event_id", { ascending: true })
    .order("price", { ascending: true, nullsFirst: false })
    .order("tier_name", { ascending: true });
  if (error) {
    console.warn("[ticketing listEventTicketTiersForEvents]", error.message);
    return [];
  }
  return (data ?? []) as unknown as EventTicketTierRow[];
}

function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function mirrorEventTicketsSold(
  supabase: AnySupabaseClient,
  input: { eventId: string; userId: string; ticketsSold: number },
): Promise<void> {
  const sb = asAnyTable(supabase);
  const { error } = await sb
    .from("events")
    .update({ tickets_sold: input.ticketsSold })
    .eq("id", input.eventId)
    .eq("user_id", input.userId);
  if (error) {
    console.warn("[ticketing mirrorEventTicketsSold]", error.message);
  }
}
