import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * lib/db/d2c-shares.ts
 *
 * Service-role CRUD for `d2c_event_shares` (migration 141). Every function
 * here takes a service-role client: the operator dashboard crosses user_id
 * ownership (approver acting on another operator's event) and the public
 * share route has no session at all.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export interface D2CEventShare {
  id: string;
  user_id: string;
  event_id: string;
  token: string;
  created_at: string;
  revoked_at: string | null;
  accessed_count: number;
  last_accessed_at: string | null;
}

const COLUMNS =
  "id, user_id, event_id, token, created_at, revoked_at, accessed_count, last_accessed_at";

function mapShare(raw: Record<string, unknown>): D2CEventShare {
  return {
    id: raw.id as string,
    user_id: raw.user_id as string,
    event_id: raw.event_id as string,
    token: raw.token as string,
    created_at: raw.created_at as string,
    revoked_at: (raw.revoked_at as string | null) ?? null,
    accessed_count: Number(raw.accessed_count ?? 0),
    last_accessed_at: (raw.last_accessed_at as string | null) ?? null,
  };
}

/** The most recent ACTIVE (non-revoked) share for an event, if any. */
export async function getActiveShareForEvent(
  admin: AnySupabaseClient,
  eventId: string,
): Promise<D2CEventShare | null> {
  const { data, error } = await admin
    .from("d2c_event_shares")
    .select(COLUMNS)
    .eq("event_id", eventId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[d2c-shares getActive]", error.message);
    return null;
  }
  return data ? mapShare(data as Record<string, unknown>) : null;
}

/** Resolve a share by its public token. Returns null when missing OR revoked. */
export async function resolveActiveShareByToken(
  admin: AnySupabaseClient,
  token: string,
): Promise<D2CEventShare | null> {
  const { data, error } = await admin
    .from("d2c_event_shares")
    .select(COLUMNS)
    .eq("token", token)
    .maybeSingle();
  if (error) {
    console.warn("[d2c-shares resolveByToken]", error.message);
    return null;
  }
  if (!data) return null;
  const share = mapShare(data as Record<string, unknown>);
  if (share.revoked_at) return null;
  return share;
}

export async function insertShare(
  admin: AnySupabaseClient,
  input: { userId: string; eventId: string; token: string },
): Promise<D2CEventShare | null> {
  const { data, error } = await admin
    .from("d2c_event_shares")
    .insert({
      user_id: input.userId,
      event_id: input.eventId,
      token: input.token,
    })
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    console.warn("[d2c-shares insert]", error.message);
    return null;
  }
  return data ? mapShare(data as Record<string, unknown>) : null;
}

export async function revokeShare(
  admin: AnySupabaseClient,
  shareId: string,
): Promise<boolean> {
  const { error } = await admin
    .from("d2c_event_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId)
    .is("revoked_at", null);
  if (error) {
    console.warn("[d2c-shares revoke]", error.message);
    return false;
  }
  return true;
}

/** Fire-and-forget access counter bump for the public route. */
export async function bumpShareAccess(
  admin: AnySupabaseClient,
  share: Pick<D2CEventShare, "id" | "accessed_count">,
): Promise<void> {
  const { error } = await admin
    .from("d2c_event_shares")
    .update({
      accessed_count: share.accessed_count + 1,
      last_accessed_at: new Date().toISOString(),
    })
    .eq("id", share.id);
  if (error) console.warn("[d2c-shares bumpAccess]", error.message);
}
