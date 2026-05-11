import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/lib/db/database.types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ClientRow = Tables<"clients">;
export type ClientInsert = TablesInsert<"clients">;
export type ClientUpdate = TablesUpdate<"clients">;

export type ClientType = "promoter" | "venue" | "brand" | "artist" | "festival";
export type ClientStatus = "active" | "paused" | "archived";

export const CLIENT_TYPES: ClientType[] = [
  "promoter",
  "venue",
  "brand",
  "artist",
  "festival",
];

export const CLIENT_STATUSES: ClientStatus[] = ["active", "paused", "archived"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Lowercase, kebab-case, strips non-alnum. Matches the DB slug uniqueness
 * constraint (user_id, slug) — the caller is still responsible for detecting
 * collisions (duplicate key error) and reacting.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function listClients(
  userId: string,
  options?: { status?: ClientStatus },
): Promise<ClientRow[]> {
  const supabase = createClient();
  let query = supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("Supabase listClients error:", error.message);
    return [];
  }
  return (data ?? []) as ClientRow[];
}

// ─── Get one ─────────────────────────────────────────────────────────────────

export async function getClientById(id: string): Promise<ClientRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getClientById error:", error.message);
    return null;
  }
  return (data as ClientRow | null) ?? null;
}

export async function getClientBySlug(
  userId: string,
  slug: string,
): Promise<ClientRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getClientBySlug error:", error.message);
    return null;
  }
  return (data as ClientRow | null) ?? null;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export type CreateClientInput = Omit<
  ClientInsert,
  "id" | "created_at" | "updated_at"
>;

export async function createClientRow(
  input: CreateClientInput,
): Promise<ClientRow | null> {
  const supabase = createClient();
  const payload: ClientInsert = {
    ...input,
    slug: input.slug || slugify(input.name),
  };

  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.warn("Supabase createClient error:", error.message);
    throw error;
  }
  return (data as ClientRow) ?? null;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateClientRow(
  id: string,
  patch: ClientUpdate,
): Promise<ClientRow | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("clients")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.warn("Supabase updateClient error:", error.message);
    throw error;
  }
  return (data as ClientRow) ?? null;
}

export async function setClientStatus(
  id: string,
  status: ClientStatus,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("clients")
    .update({ status })
    .eq("id", id);
  if (error) {
    console.warn("Supabase setClientStatus error:", error.message);
    throw error;
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Hard delete. Will be blocked by Postgres (on delete restrict from events)
 * if any events still belong to this client — the caller should archive
 * instead, or delete events first.
 */
export async function deleteClientRow(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) {
    console.warn("Supabase deleteClient error:", error.message);
    throw error;
  }
}

// ─── Server-only lookup helpers ──────────────────────────────────────────────

/**
 * Resolves the owning client for a Meta `act_…` ad account id. Used by
 * code paths that only know the ad account (e.g. audience-write
 * receives `audience.metaAdAccountId`, not `audience.clientId`) but
 * still need to resolve the per-client System User token via
 * `lib/meta/system-user-token.ts#resolveSystemUserToken`.
 *
 * Takes a `SupabaseClient` so server route handlers and library code
 * can pass either the cookie-bound client (RLS) or the service-role
 * client (rollup-sync cron). Returns `null` instead of throwing when
 * the lookup fails — callers fall back to the personal-OAuth path.
 *
 * `meta_ad_account_id` is the same column that `app/api/meta/*` reads
 * surface as the "linked ad account" for a client (see migration
 * 009). It is unique enough in practice — one ad account belongs to
 * one Meta Business Manager which we onboard one client per — that
 * `.maybeSingle()` is safe; if a duplicate ever lands the warning log
 * lets us spot it.
 */
export async function findClientByMetaAdAccountId(
  supabase: SupabaseClient<Database>,
  adAccountId: string,
): Promise<{ id: string; userId: string } | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("meta_ad_account_id", adAccountId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(
      `[findClientByMetaAdAccountId] lookup failed ad_account_id=${adAccountId} msg=${error.message}`,
    );
    return null;
  }
  if (!data) return null;
  return { id: data.id, userId: data.user_id };
}
