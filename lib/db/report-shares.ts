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
  /**
   * When false, the share URL is view-only (no additional spend CRUD etc.).
   * Defaults true so client-facing event links match PR #104/#108 intent.
   */
  canEdit?: boolean;
}): Promise<ReportShareRow> {
  const supabase = await createClient();
  const token = generateShareToken();
  const canEdit = input.canEdit !== false;

  const { data, error } = await supabase
    .from("report_shares")
    .insert({
      token,
      event_id: input.eventId,
      user_id: input.userId,
      enabled: true,
      expires_at: input.expiresAt ?? null,
      can_edit: canEdit,
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
 * Fetch the venue-scoped share row for a (client_id, event_code) pair
 * owned by the current user. Returns null when no share exists yet —
 * the "Share venue" CTA on the internal venue report mints one on
 * first click.
 *
 * Mirror of `getShareForEvent` / `getShareForClient` for the third
 * scope introduced by migration 052.
 */
export async function getShareForVenue(
  clientId: string,
  eventCode: string,
): Promise<ReportShareRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("report_shares")
    .select("*")
    .eq("scope", "venue")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[report-shares getShareForVenue] error:", error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Mint a fresh venue-scoped share row. Defaults to can_edit=true so
 * the public venue URL inherits the same "client-editable" posture
 * as the per-event + client-wide shares — PR 4 builds on top of this
 * to gate additional-spend mutations behind the flag.
 */
export async function mintVenueShare(input: {
  clientId: string;
  eventCode: string;
  userId: string;
  expiresAt?: string | null;
  canEdit?: boolean;
}): Promise<ReportShareRow> {
  const supabase = await createClient();
  const token = generateShareToken();
  const canEdit = input.canEdit !== false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = supabase as any;
  const { data, error } = await admin
    .from("report_shares")
    .insert({
      token,
      scope: "venue",
      client_id: input.clientId,
      event_id: null,
      event_code: input.eventCode,
      can_edit: canEdit,
      user_id: input.userId,
      enabled: true,
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.warn("[report-shares mintVenueShare] error:", error.message);
    throw error;
  }
  return data as ReportShareRow;
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
 * Toggle whether the share token allows mutating event-scoped data from
 * the public URL (additional spend, etc.). Viewing the report stays
 * allowed when `can_edit` is false.
 */
export async function setShareCanEdit(
  token: string,
  canEdit: boolean,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("report_shares")
    .update({ can_edit: canEdit })
    .eq("token", token);
  if (error) {
    console.warn("[report-shares setShareCanEdit] error:", error.message);
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
  const { data: prior, error: readErr } = await supabase
    .from("report_shares")
    .select("can_edit")
    .eq("token", input.oldToken)
    .maybeSingle();
  if (readErr) {
    console.warn(
      "[report-shares regenerateShareToken] read error:",
      readErr.message,
    );
    throw readErr;
  }
  if (!prior) {
    throw new Error("Share row not found for regenerate");
  }
  const preserveCanEdit = prior.can_edit !== false;

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
    canEdit: preserveCanEdit,
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

/**
 * Common fields shared by every successfully resolved share row. Split
 * from the discriminator-bearing variants so additions to the row schema
 * land in one place.
 */
type ResolvedShareBase = {
  token: string;
  /** True when the token grants edit operations (e.g. tickets-sold capture). */
  can_edit: boolean;
  user_id: string;
  enabled: boolean;
  expires_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

/**
 * Event-scoped share row, validated to carry a non-null `event_id`. This
 * is the shape the public event report page + the creatives route operate
 * on. Code that has narrowed via `share.scope === "event"` (or via
 * `isEventScopedShare`) can read `event_id` as `string` without further
 * null-guarding.
 */
export type EventScopedShare = ResolvedShareBase & {
  scope: "event";
  event_id: string;
  client_id: string | null;
};

/**
 * Client-scoped share row (introduced by migration 014). Carries a
 * `client_id` and explicitly null `event_id` — the client portal renders
 * an aggregate of all events under the client, not a single event.
 */
export type ClientScopedShare = ResolvedShareBase & {
  scope: "client";
  event_id: null;
  client_id: string;
};

/**
 * Venue-scoped share row (introduced by migration 052). Carries a
 * `client_id` + `event_code` pair; resolves at render time to every
 * event under `(client_id, event_code)`. Distinct from
 * `scope='event'` (which targets one event) and `scope='client'`
 * (which targets the whole client roll-up).
 *
 * The venue share page filters the underlying `client-portal-server`
 * payload by `event_code`, so the arithmetic is identical to the
 * expanded venue card on the client dashboard — same WoW deltas,
 * same allocator columns, same creatives strip.
 */
export type VenueScopedShare = ResolvedShareBase & {
  scope: "venue";
  event_id: null;
  client_id: string;
  event_code: string;
};

/**
 * Discriminated union of every valid resolved share. Switch on
 * `share.scope` (or use the `isEventScopedShare` / `isClientScopedShare`
 * / `isVenueScopedShare` guards) to narrow to the right variant.
 * Replaces the previous loose shape that had `event_id: string | null`
 * regardless of scope, which required every call site to manually
 * re-check for null.
 */
export type ResolvedShare =
  | EventScopedShare
  | ClientScopedShare
  | VenueScopedShare;

/**
 * Type guard for the event-scope variant. Use when a call site wants to
 * fail fast on a client-scope share rather than handle both.
 */
export function isEventScopedShare(
  share: ResolvedShare,
): share is EventScopedShare {
  return share.scope === "event";
}

/**
 * Type guard for the client-scope variant. Mirror of
 * `isEventScopedShare` for portal/tickets endpoints that only accept
 * client-scope tokens.
 */
export function isClientScopedShare(
  share: ResolvedShare,
): share is ClientScopedShare {
  return share.scope === "client";
}

/**
 * Type guard for the venue-scope variant. Used by
 * `/share/venue/[token]` + its associated API routes to reject
 * tokens that resolve to a non-venue scope.
 */
export function isVenueScopedShare(
  share: ResolvedShare,
): share is VenueScopedShare {
  return share.scope === "venue";
}

/**
 * Reason codes for a failed `resolveShareByToken` call.
 *
 * - `missing`: token did not match a row.
 * - `disabled`: row exists but `enabled=false` (owner soft-killed it).
 * - `expired`: row past `expires_at`.
 * - `malformed`: row exists but its `(scope, event_id, client_id)` tuple
 *   is structurally inconsistent (e.g. scope='event' with null event_id,
 *   or scope='client' with null client_id). Indicates corrupted data —
 *   should be treated as a 404 by the public surface but logged on the
 *   server so the row can be cleaned up.
 * - `error`: Supabase call itself failed.
 */
export type ResolveShareFailReason =
  | "missing"
  | "disabled"
  | "expired"
  | "malformed"
  | "error";

export type ResolveShareResult =
  | { ok: true; share: ResolvedShare }
  | { ok: false; reason: ResolveShareFailReason };

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
      // `event_code` is populated only for scope='venue'; we still
      // select it unconditionally so the discriminated union can be
      // assembled without a second round-trip.
      "token, event_id, client_id, event_code, scope, can_edit, user_id, enabled, expires_at, view_count, last_viewed_at, created_at",
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

  // Structural validation rather than an unchecked `as ResolvedShare`
  // cast. Migration 014 made `event_id` nullable for client-scope shares,
  // which means any site that read `share.event_id as string` post-cast
  // would crash on the first client-scope token through the door. Build
  // the discriminated union explicitly so callers narrow safely.
  const base = {
    token: data.token,
    can_edit: data.can_edit,
    user_id: data.user_id,
    enabled: data.enabled,
    expires_at: data.expires_at,
    view_count: data.view_count,
    last_viewed_at: data.last_viewed_at,
    created_at: data.created_at,
  };

  if (data.scope === "event") {
    if (!data.event_id) {
      console.warn(
        `[report-shares resolveShareByToken] malformed event-scope share (token=${token}): event_id is null`,
      );
      return { ok: false, reason: "malformed" };
    }
    const share: EventScopedShare = {
      ...base,
      scope: "event",
      event_id: data.event_id,
      client_id: data.client_id,
    };
    return { ok: true, share };
  }

  if (data.scope === "client") {
    if (!data.client_id) {
      console.warn(
        `[report-shares resolveShareByToken] malformed client-scope share (token=${token}): client_id is null`,
      );
      return { ok: false, reason: "malformed" };
    }
    const share: ClientScopedShare = {
      ...base,
      scope: "client",
      event_id: null,
      client_id: data.client_id,
    };
    return { ok: true, share };
  }

  if (data.scope === "venue") {
    // `event_code` could be null if migration 052 didn't run or a
    // manual SQL edit slipped a malformed row in; the DB's check
    // constraint normally prevents this, but the guard is cheap.
    const anyData = data as unknown as { event_code?: string | null };
    const eventCode = anyData.event_code ?? null;
    if (!data.client_id || !eventCode) {
      console.warn(
        `[report-shares resolveShareByToken] malformed venue-scope share (token=${token}): client_id=${data.client_id} event_code=${eventCode}`,
      );
      return { ok: false, reason: "malformed" };
    }
    const share: VenueScopedShare = {
      ...base,
      scope: "venue",
      event_id: null,
      client_id: data.client_id,
      event_code: eventCode,
    };
    return { ok: true, share };
  }

  // Unknown scope value — schema check on the table normally prevents
  // this, but a forgotten `alter table` could land us here. Surface it.
  console.warn(
    `[report-shares resolveShareByToken] unknown scope (token=${token}): ${String(data.scope)}`,
  );
  return { ok: false, reason: "malformed" };
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
