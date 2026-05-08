import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getTicketingTokenKey } from "@/lib/ticketing/secrets";
import { ticketTierCapacity } from "@/lib/ticketing/tier-capacity";
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
  /**
   * Per-link 4TheFans API base URL override (migration 083). When set, the
   * sync uses this base URL instead of the provider default so a single
   * bearer token can serve multiple WordPress booking sites. NULL = use
   * provider default.
   */
  externalApiBase?: string | null;
  manualLock?: boolean;
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
        external_api_base: input.externalApiBase ?? null,
        manual_lock: input.manualLock ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "event_id,connection_id,external_event_id" },
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
  /** Scoped to one external listing when the event has multiple links. */
  externalEventId?: string | null;
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
      external_event_id: input.externalEventId ?? null,
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
    await refreshAggregatedTicketsSoldFromSnapshots(supabase, {
      eventId: input.eventId,
      userId: input.userId,
    });
  }
  return snapshot;
}

/**
 * Sets `events.tickets_sold` to the sum of the latest snapshot lifetime total
 * per ticketing link (each external listing has its own snapshot stream).
 */
export async function refreshAggregatedTicketsSoldFromSnapshots(
  supabase: AnySupabaseClient,
  args: { eventId: string; userId: string },
): Promise<void> {
  const links = await listLinksForEvent(supabase, args.eventId);
  let total = 0;
  for (const link of links) {
    const snap = await getLatestSnapshotForListing(supabase, {
      eventId: args.eventId,
      connectionId: link.connection_id,
      externalEventId: link.external_event_id,
    });
    if (snap) {
      total += Math.max(0, Math.round(snap.tickets_sold));
    }
  }
  const sb = asAnyTable(supabase);
  const { error } = await sb
    .from("events")
    .update({ tickets_sold: total })
    .eq("id", args.eventId)
    .eq("user_id", args.userId);
  if (error) {
    console.warn(
      "[ticketing refreshAggregatedTicketsSoldFromSnapshots]",
      error.message,
    );
  }
}

export async function getLatestSnapshotForListing(
  supabase: AnySupabaseClient,
  args: {
    eventId: string;
    connectionId: string;
    externalEventId: string;
  },
): Promise<TicketSalesSnapshot | null> {
  const sb = asAnyTable(supabase);
  const { data: explicit, error: e1 } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", args.eventId)
    .eq("connection_id", args.connectionId)
    .eq("external_event_id", args.externalEventId)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) {
    console.warn("[ticketing getLatestSnapshotForListing explicit]", e1.message);
  }
  if (explicit) {
    return explicit as unknown as TicketSalesSnapshot;
  }

  const { count, error: cErr } = await sb
    .from("event_ticketing_links")
    .select("*", { count: "exact", head: true })
    .eq("event_id", args.eventId)
    .eq("connection_id", args.connectionId);
  if (cErr) {
    console.warn("[ticketing getLatestSnapshotForListing count]", cErr.message);
  }
  if ((count ?? 0) > 1) {
    return null;
  }

  const { data: legacy, error: e2 } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", args.eventId)
    .eq("connection_id", args.connectionId)
    .is("external_event_id", null)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) {
    console.warn("[ticketing getLatestSnapshotForListing legacy]", e2.message);
  }
  return (legacy as unknown as TicketSalesSnapshot) ?? null;
}

export async function getLatestSnapshotForLinkBeforeDate(
  supabase: AnySupabaseClient,
  args: {
    eventId: string;
    connectionId: string;
    externalEventId: string;
    beforeDate: string;
  },
): Promise<TicketSalesSnapshot | null> {
  const beforeIso = `${args.beforeDate}T00:00:00.000Z`;
  const sb = asAnyTable(supabase);
  const { data: explicit, error: e1 } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", args.eventId)
    .eq("connection_id", args.connectionId)
    .eq("external_event_id", args.externalEventId)
    .lt("snapshot_at", beforeIso)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) {
    console.warn(
      "[ticketing getLatestSnapshotForLinkBeforeDate explicit]",
      e1.message,
    );
  }
  if (explicit) {
    return explicit as unknown as TicketSalesSnapshot;
  }

  const { count, error: cErr } = await sb
    .from("event_ticketing_links")
    .select("*", { count: "exact", head: true })
    .eq("event_id", args.eventId)
    .eq("connection_id", args.connectionId);
  if (cErr) {
    console.warn(
      "[ticketing getLatestSnapshotForLinkBeforeDate count]",
      cErr.message,
    );
  }
  if ((count ?? 0) > 1) {
    return null;
  }

  const { data: legacy, error: e2 } = await sb
    .from("ticket_sales_snapshots")
    .select("*")
    .eq("event_id", args.eventId)
    .eq("connection_id", args.connectionId)
    .is("external_event_id", null)
    .lt("snapshot_at", beforeIso)
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) {
    console.warn(
      "[ticketing getLatestSnapshotForLinkBeforeDate legacy]",
      e2.message,
    );
  }
  return (legacy as unknown as TicketSalesSnapshot) ?? null;
}

/** Sum of latest gross revenue per linked external event (for dashboard header). */
export async function sumLatestSnapshotRevenueForEvent(
  supabase: AnySupabaseClient,
  eventId: string,
  links: EventTicketingLink[],
): Promise<{ totalCents: number; currency: string | null }> {
  let totalCents = 0;
  let currency: string | null = null;
  for (const link of links) {
    const snap = await getLatestSnapshotForListing(supabase, {
      eventId,
      connectionId: link.connection_id,
      externalEventId: link.external_event_id,
    });
    if (
      snap?.gross_revenue_cents != null &&
      Number.isFinite(Number(snap.gross_revenue_cents))
    ) {
      totalCents += Number(snap.gross_revenue_cents);
    }
    if (!currency && snap?.currency) {
      currency = snap.currency;
    }
  }
  return { totalCents, currency };
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
  additional_quantity_sold?: number;
  api_quantity_sold?: number;
  snapshot_at: string;
  created_at?: string;
  updated_at?: string;
  /**
   * Per-channel breakdown attached server-side from
   * `tier_channel_allocations` + `tier_channel_sales` (migrations
   * 076–077). Empty when no channel rows exist for this tier yet.
   * The 4TF entry, when present, mirrors `quantity_sold`/`price`
   * via the read-time fallback in `buildTierChannelBreakdownMap`
   * — so the existing 4thefans rollup-sync continues to drive the
   * automatic channel without dual-writing.
   */
  channel_breakdowns?: import("./tier-channels").TierChannelBreakdown[];
}

export async function replaceEventTicketTiers(
  supabase: AnySupabaseClient,
  args: {
    eventId: string;
    tiers: TicketTierBreakdown[];
    snapshotAt?: string;
  },
): Promise<number> {
  // event_ticket_tiers has RLS that rejects the user-scoped session client.
  // Ownership of event_id has already been verified by the calling route
  // (rollup-sync or /api/ticketing/sync) before reaching here, so a
  // service-role write is safe.  Fall back to the passed-in client if the
  // service-role key is not configured (e.g. local dev without the key) so
  // the function stays usable in all environments.
  let writeClient: AnySupabaseClient = supabase;
  try {
    writeClient = createServiceRoleClient();
  } catch {
    console.warn(
      "[ticketing replaceEventTicketTiers] SUPABASE_SERVICE_ROLE_KEY not configured — falling back to session client (writes may fail RLS)",
    );
  }
  const sb = asAnyTable(writeClient);
  const snapshotAt = args.snapshotAt ?? new Date().toISOString();
  const rowsByName = new Map<
    string,
    {
      event_id: string;
      tier_name: string;
      price: number | null;
      quantity_sold: number;
      quantity_available: number | null;
      snapshot_at: string;
      updated_at: string;
    }
  >();
  for (const tier of args.tiers) {
    const tierName = tier.tierName.trim();
    if (!tierName) continue;
    const quantitySold = Math.max(0, Math.trunc(tier.quantitySold));
    const quantityAvailable =
      tier.quantityAvailable == null
        ? null
        : Math.max(0, Math.trunc(tier.quantitySold + tier.quantityAvailable));
    const existing = rowsByName.get(tierName);
    if (existing) {
      existing.quantity_sold += quantitySold;
      existing.quantity_available =
        existing.quantity_available == null || quantityAvailable == null
          ? null
          : existing.quantity_available + quantityAvailable;
      continue;
    }
    rowsByName.set(tierName, {
      event_id: args.eventId,
      tier_name: tierName,
      price: tier.price,
      quantity_sold: quantitySold,
      quantity_available: quantityAvailable,
      snapshot_at: snapshotAt,
      updated_at: snapshotAt,
    });
  }
  const rows = Array.from(rowsByName.values());

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
    // Throw so callers surface this as a sync failure rather than silently
    // writing zero tier rows while returning ok:true.
    throw new Error(
      `[ticketing replaceEventTicketTiers upsert] ${error.message}`,
    );
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

export async function upsertProviderTierChannelSales(
  supabase: AnySupabaseClient,
  args: {
    eventId: string;
    clientId: string;
    provider: TicketingProviderName;
    tiers: TicketTierBreakdown[];
    snapshotAt?: string;
  },
): Promise<number> {
  if (args.provider !== "fourthefans") return 0;

  const writeClient = createServiceRoleClient();
  const sb = asAnyTable(writeClient);
  const { data: channel, error: channelError } = await sb
    .from("tier_channels")
    .select("id")
    .eq("client_id", args.clientId)
    .eq("channel_name", "4TF")
    .eq("is_automatic", true)
    .maybeSingle();

  if (channelError) {
    throw new Error(
      `[ticketing upsertProviderTierChannelSales channel] ${channelError.message}`,
    );
  }
  if (!channel?.id) {
    throw new Error(
      "[ticketing upsertProviderTierChannelSales channel] 4TF automatic channel is not configured",
    );
  }

  const snapshotAt = args.snapshotAt ?? new Date().toISOString();
  const rowsByName = new Map<
    string,
    {
      event_id: string;
      tier_name: string;
      channel_id: string;
      tickets_sold: number;
      revenue_amount: number;
      revenue_overridden: boolean;
      notes: string | null;
      snapshot_at: string;
      updated_at: string;
    }
  >();

  for (const tier of args.tiers) {
    const tierName = tier.tierName.trim();
    if (!tierName) continue;
    const quantitySold = Math.max(0, Math.trunc(tier.quantitySold));
    const price = tier.price == null ? null : Number(tier.price);
    const revenue =
      price != null && Number.isFinite(price) ? price * quantitySold : 0;
    const existing = rowsByName.get(tierName);
    if (existing) {
      existing.tickets_sold += quantitySold;
      existing.revenue_amount += revenue;
      continue;
    }
    rowsByName.set(tierName, {
      event_id: args.eventId,
      tier_name: tierName,
      channel_id: channel.id as string,
      tickets_sold: quantitySold,
      revenue_amount: revenue,
      revenue_overridden: false,
      notes: "Automatic fourthefans sync",
      snapshot_at: snapshotAt,
      updated_at: snapshotAt,
    });
  }

  const rows = Array.from(rowsByName.values());
  if (rows.length === 0) return 0;

  const { error } = await sb
    .from("tier_channel_sales")
    .upsert(rows, { onConflict: "event_id,tier_name,channel_id" });
  if (error) {
    throw new Error(
      `[ticketing upsertProviderTierChannelSales upsert] ${error.message}`,
    );
  }
  return rows.length;
}

export async function updateEventCapacityFromTicketTiers(
  supabase: AnySupabaseClient,
  args: {
    eventId: string;
    userId?: string;
    tiers: TicketTierBreakdown[];
    source?: string;
  },
): Promise<{
  computedCapacity: number;
  currentCapacity: number | null;
  updated: boolean;
  skippedReason: string | null;
}> {
  const computedCapacity = ticketTierCapacity(args.tiers);
  if (computedCapacity <= 0) {
    return {
      computedCapacity,
      currentCapacity: null,
      updated: false,
      skippedReason: "no_tier_capacity",
    };
  }

  const sb = asAnyTable(supabase);
  let query = sb.from("events").select("id, capacity").eq("id", args.eventId);
  if (args.userId) query = query.eq("user_id", args.userId);
  const { data: event, error: readError } = await query.maybeSingle();
  if (readError || !event) {
    console.warn(
      `[ticketing updateEventCapacityFromTicketTiers] read failed event_id=${args.eventId}: ${
        readError?.message ?? "Event not found"
      }`,
    );
    return {
      computedCapacity,
      currentCapacity: null,
      updated: false,
      skippedReason: "read_failed",
    };
  }

  const currentCapacity =
    typeof event.capacity === "number" && Number.isFinite(event.capacity)
      ? event.capacity
      : null;
  console.log("[capacity-update]", {
    eventId: args.eventId,
    oldCapacity: currentCapacity,
    newCapacity: computedCapacity,
    tierCount: args.tiers.length,
    source: args.source ?? "fourthefans",
  });

  let update = sb
    .from("events")
    .update({ capacity: computedCapacity })
    .eq("id", args.eventId);
  if (args.userId) update = update.eq("user_id", args.userId);
  const { error: updateError } = await update;
  if (updateError) {
    console.warn(
      `[ticketing updateEventCapacityFromTicketTiers] update failed event_id=${args.eventId}: ${updateError.message}`,
    );
    return {
      computedCapacity,
      currentCapacity,
      updated: false,
      skippedReason: "update_failed",
    };
  }

  return {
    computedCapacity,
    currentCapacity,
    updated: true,
    skippedReason: null,
  };
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
