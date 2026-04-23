import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables, TablesInsert } from "@/lib/db/database.types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type EventBriefRow = Tables<"event_briefs">;
export type ServiceTierRow = Tables<"service_tiers">;
export type BriefIntakeTokenRow = Tables<"brief_intake_tokens">;

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getBriefForEvent(
  supabase: SupabaseClient<Database>,
  eventId: string,
): Promise<EventBriefRow | null> {
  const { data, error } = await supabase
    .from("event_briefs")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) {
    console.warn("[event-briefs getBriefForEvent] error:", error.message);
    return null;
  }
  return data ?? null;
}

export async function listServiceTiers(
  supabase: SupabaseClient<Database>,
): Promise<ServiceTierRow[]> {
  const { data, error } = await supabase
    .from("service_tiers")
    .select("*")
    .order("key", { ascending: true });

  if (error) {
    console.warn("[event-briefs listServiceTiers] error:", error.message);
    throw error;
  }
  return (data as ServiceTierRow[]) ?? [];
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Create or update the brief for an event. `user_id` is always taken from the
 * owning `events` row so it stays aligned with RLS. Ignores any `user_id` /
 * `event_id` / `id` present on the patch to avoid cross-user writes.
 */
export async function upsertBrief(
  supabase: SupabaseClient<Database>,
  eventId: string,
  patch: Partial<TablesInsert<"event_briefs">>,
): Promise<EventBriefRow> {
  const { data: event, error: evError } = await supabase
    .from("events")
    .select("user_id")
    .eq("id", eventId)
    .maybeSingle();

  if (evError) {
    console.warn("[event-briefs upsertBrief] event load error:", evError.message);
    throw evError;
  }
  if (!event) {
    throw new Error("Event not found");
  }

  const { id, event_id, user_id, ...rest } = patch;
  void id;
  void event_id;
  void user_id;
  const row: TablesInsert<"event_briefs"> = {
    ...rest,
    event_id: eventId,
    user_id: event.user_id,
  };

  const { data, error } = await supabase
    .from("event_briefs")
    .upsert(row, { onConflict: "event_id" })
    .select("*")
    .single();

  if (error) {
    console.warn("[event-briefs upsertBrief] error:", error.message);
    throw error;
  }
  return data as EventBriefRow;
}

// ─── Intake tokens (owner: RLS; public resolve: service role) ───────────────

/**
 * Mint a 16-char base64url token and insert a `brief_intake_tokens` row for
 * the current session user. Follows the same entropy pattern as
 * `lib/db/report-shares`.
 */
export async function createBriefIntakeToken(
  supabase: SupabaseClient<Database>,
  eventId: string,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const token = randomBytes(12).toString("base64url");

  const { data, error } = await supabase
    .from("brief_intake_tokens")
    .insert({
      token,
      event_id: eventId,
      user_id: user.id,
      enabled: true,
    })
    .select("token")
    .single();

  if (error) {
    console.warn(
      "[event-briefs createBriefIntakeToken] error:",
      error.message,
    );
    throw error;
  }
  if (!data?.token) {
    throw new Error("Token insert returned no row");
  }
  return data.token;
}

/**
 * Resolve a public brief-intake link. Call with the service-role client. Returns
 * null when the row is missing, disabled, or past `expires_at`.
 */
export async function resolveBriefIntakeToken(
  serviceRoleSupabase: SupabaseClient<Database>,
  token: string,
): Promise<{ event_id: string; user_id: string } | null> {
  const { data, error } = await serviceRoleSupabase
    .from("brief_intake_tokens")
    .select("event_id, user_id, enabled, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.warn(
      "[event-briefs resolveBriefIntakeToken] error:",
      error.message,
    );
    return null;
  }
  if (!data) return null;
  if (!data.enabled) return null;
  if (data.expires_at) {
    const t = new Date(data.expires_at);
    if (t.getTime() < Date.now()) return null;
  }
  return { event_id: data.event_id, user_id: data.user_id };
}
