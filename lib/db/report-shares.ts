import "server-only";

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { Database, Tables } from "@/lib/db/database.types";

/**
 * lib/db/report-shares.ts
 *
 * Server-only helpers for the public client-facing event report share
 * (Slice U). Two access patterns:
 *
 *   1. Owner CRUD via the cookie-bound supabase client (RLS scopes to
 *      auth.uid() = user_id). Used by the dashboard share controls and the
 *      authenticated `app/api/share/report/route.ts` handler.
 *
 *   2. Public token resolution via the service-role client (bypasses RLS).
 *      Used by `app/share/report/[token]/page.tsx` and the public creatives
 *      route to look up the row + bump view counters without an
 *      authenticated session.
 *
 * Tokens are 16 char base64url strings (96 bits entropy from
 * randomBytes(12)). Equivalent to nanoid(16) without adding a dependency.
 */

export type ReportShareRow = Tables<"report_shares">;

// ─── Token generation ──────────────────────────────────────────────────────

/**
 * Mint a new URL-safe token. 16 chars long, base64url alphabet, ~96 bits
 * entropy. Collision-resistant for the operational lifetime of this table.
 */
export function generateShareToken(): string {
  return randomBytes(12).toString("base64url");
}

// ─── Owner-side helpers (RLS) ──────────────────────────────────────────────

/**
 * Fetch the share row for a given event owned by the current user. Returns
 * null when no share exists yet (the dashboard renders a "create" CTA in
 * that case).
 */
export async function getShareForEvent(
  eventId: string,
): Promise<ReportShareRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_shares")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) {
    console.warn("[report-shares getShareForEvent] error:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Create a fresh share row for an event. Caller is responsible for ensuring
 * the event belongs to the current user (RLS enforces this on insert via
 * the with-check policy, but we surface a clearer error than a 401 on the
 * read path that follows).
 */
export async function createShare(input: {
  eventId: string;
  userId: string;
  expiresAt?: string | null;
}): Promise<ReportShareRow> {
  const supabase = await createClient();
  const token = generateShareToken();

  const { data, error } = await supabase
    .from("report_shares")
    .insert({
      token,
      event_id: input.eventId,
      user_id: input.userId,
      enabled: true,
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.warn("[report-shares createShare] error:", error.message);
    throw error;
  }
  return data as ReportShareRow;
}

/**
 * Fetch the client-scoped share row for a given client owned by the
 * current user. Returns null when no share exists yet.
 *
 * Mirror of `getShareForEvent` for `scope='client'` shares — the
 * client portal lives behind one of these tokens (event_id is null,
 * client_id is the FK pivot).
 */
export async function getShareForClient(
  clientId: string,
): Promise<ReportShareRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_shares")
    .select("*")
    .eq("scope", "client")
    .eq("client_id", clientId)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[report-shares getShareForClient] error:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Mint a fresh client-scoped share row. The token grants edit access
 * (can_edit=true) so the public portal can capture tickets-sold
 * snapshots back into client_report_weekly_snapshots.
 *
 * Idempotency is handled by the caller (POST /api/share/client) which
 * runs `getShareForClient` first; this helper unconditionally inserts.
 */
export async function mintClientShare(input: {
  clientId: string;
  userId: string;
  expiresAt?: string | null;
}): Promise<ReportShareRow> {
  const supabase = await createClient();
  const token = generateShareToken();

  const { data, error } = await supabase
    .from("report_shares")
    .insert({
      token,
      scope: "client",
      client_id: input.clientId,
      event_id: null,
      can_edit: true,
      user_id: input.userId,
      enabled: true,
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.warn("[report-shares mintClientShare] error:", error.message);
    throw error;
  }
  return data as ReportShareRow;
}

/**
 * Toggle a share on/off. Soft kill — preserves the row + view counters so
 * re-enabling the same link works without a token rotation.
 */
export async function setShareEnabled(
  token: string,
  enabled: boolean,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("report_shares")
    .update({ enabled })
    .eq("token", token);
  if (error) {
    console.warn("[report-shares setShareEnabled] error:", error.message);
    throw error;
  }
}

/**
 * Update the expiry on an existing share. `null` clears the expiry
 * (never expires).
 */
export async function setShareExpiry(
  token: string,
  expiresAt: string | null,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("report_shares")
    .update({ expires_at: expiresAt })
    .eq("token", token);
  if (error) {
    console.warn("[report-shares setShareExpiry] error:", error.message);
    throw error;
  }
}

/**
 * Rotate a share's token. Implemented as delete + create so the previous
 * token returns 404 immediately (the dashboard explicitly warns this
 * invalidates any link already in circulation).
 *
 * We deliberately drop view_count + last_viewed_at on rotation — the new
 * token is conceptually a new share, not a continuation.
 */
export async function regenerateShareToken(input: {
  oldToken: string;
  eventId: string;
  userId: string;
  expiresAt?: string | null;
}): Promise<ReportShareRow> {
  const supabase = await createClient();
  const { error: delErr } = await supabase
    .from("report_shares")
    .delete()
    .eq("token", input.oldToken);
  if (delErr) {
    console.warn(
      "[report-shares regenerateShareToken] delete error:",
      delErr.message,
    );
    throw delErr;
  }
  return createShare({
    eventId: input.eventId,
    userId: input.userId,
    expiresAt: input.expiresAt,
  });
}

/**
 * Hard delete a share. Used by the share controls "Disable & remove" path
 * (kept for completeness; the dashboard currently prefers `setShareEnabled`).
 */
export async function deleteShare(token: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("report_shares")
    .delete()
    .eq("token", token);
  if (error) {
    console.warn("[report-shares deleteShare] error:", error.message);
    throw error;
  }
}

// ─── Public-side helpers (service role) ────────────────────────────────────

export type ResolvedShare = {
  token: string;
  /**
   * Nullable since migration 014 — `scope='client'` shares carry a
   * `client_id` instead of an `event_id`. The current resolver only
   * returns rows looked up by token (with no scope filter), so callers
   * MUST guard against null before treating this as a string. The
   * existing public report page + creatives route both error out with
   * the appropriate "no_event_code" / 503 path when this is null.
   */
  event_id: string | null;
  /** Populated when scope='client'; null for legacy event-scoped shares. */
  client_id: string | null;
  scope: "event" | "client";
  /** True when the token grants edit operations (e.g. tickets-sold capture). */
  can_edit: boolean;
  user_id: string;
  enabled: boolean;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

export type ResolveShareResult =
  | { ok: true; share: ResolvedShare }
  | { ok: false; reason: "missing" | "disabled" | "expired" | "error" };

/**
 * Resolve a public share token via the service-role client. Used by
 * `app/share/report/[token]/page.tsx` and the creatives route.
 *
 * Returns a discriminated union so the caller can render distinct UI for
 * each failure mode without exposing whether the token ever existed
 * (`missing`, `disabled`, `expired` all collapse to the same 404 page in
 * the public route — the discriminator is for server-side logging only).
 */
export async function resolveShareByToken(
  token: string,
  client?: SupabaseClient<Database>,
): Promise<ResolveShareResult> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase
    .from("report_shares")
    .select(
      "token, event_id, client_id, scope, can_edit, user_id, enabled, expires_at, view_count, last_viewed_at, created_at",
    )
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error(
      "[report-shares resolveShareByToken] error:",
      error.message,
    );
    return { ok: false, reason: "error" };
  }
  if (!data) return { ok: false, reason: "missing" };
  if (!data.enabled) return { ok: false, reason: "disabled" };
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, share: data as ResolvedShare };
}

/**
 * Best-effort view counter bump. Failures are logged but never thrown —
 * a counter glitch must not block report rendering for a client.
 */
export async function bumpShareView(
  token: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  try {
    const supabase = client ?? createServiceRoleClient();
    // Read-modify-write rather than an SQL increment because we don't want
    // to add a new RPC for this slice. Race-condition risk is acceptable —
    // worst case we under-count by one when two viewers hit at the exact
    // same moment, which the dashboard footer copy ("Viewed ~N times")
    // already implies.
    const { data, error: readErr } = await supabase
      .from("report_shares")
      .select("view_count")
      .eq("token", token)
      .maybeSingle();
    if (readErr || !data) {
      console.warn(
        "[report-shares bumpShareView] read failed:",
        readErr?.message ?? "no row",
      );
      return;
    }
    const { error: writeErr } = await supabase
      .from("report_shares")
      .update({
        view_count: (data.view_count ?? 0) + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq("token", token);
    if (writeErr) {
      console.warn(
        "[report-shares bumpShareView] write failed:",
        writeErr.message,
      );
    }
  } catch (err) {
    console.warn("[report-shares bumpShareView] unexpected error:", err);
  }
}

/**
 * Fetch the long-lived Facebook OAuth token for the share owner via the
 * service-role client. Returns null when the row is missing or the token
 * is past its expiry — caller should render the "report temporarily
 * unavailable" state in that case.
 */
export async function getOwnerFacebookToken(
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<string | null> {
  const supabase = client ?? createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_facebook_tokens")
    .select("provider_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(
      "[report-shares getOwnerFacebookToken] error:",
      error.message,
    );
    return null;
  }
  if (!data?.provider_token) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    console.warn(
      "[report-shares getOwnerFacebookToken] token expired for user",
      userId,
    );
    return null;
  }
  return data.provider_token;
}
