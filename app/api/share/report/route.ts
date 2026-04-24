import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  createShare,
  deleteShare,
  getShareForEvent,
  regenerateShareToken,
  setShareCanEdit,
  setShareEnabled,
  setShareExpiry,
} from "@/lib/db/report-shares";

/**
 * Authenticated CRUD for `report_shares`.
 *
 *   POST   { eventId, expiresAt? }              → create a share, returns row.
 *   PATCH  { token, action, … }                 → enable / disable /
 *                                                  set expiry / regenerate.
 *   DELETE ?token=…                             → hard delete.
 *
 * Public reads of share rows happen via the page route
 * (`app/share/report/[token]/page.tsx`) using the service-role client.
 * That keeps the public surface read-only; mutations require an
 * authenticated dashboard session.
 */

interface CreateBody {
  eventId?: unknown;
  expiresAt?: unknown;
}

interface PatchBody {
  token?: unknown;
  action?: unknown;
  enabled?: unknown;
  expiresAt?: unknown;
  eventId?: unknown;
  canEdit?: unknown;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function isToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{12,32}$/.test(v);
}

function isIsoOrNull(v: unknown): v is string | null {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  const ms = Date.parse(v);
  return Number.isFinite(ms);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isUuid(body.eventId)) {
    return NextResponse.json(
      { error: "eventId must be a uuid" },
      { status: 400 },
    );
  }
  const expiresAt =
    body.expiresAt === undefined
      ? null
      : isIsoOrNull(body.expiresAt)
        ? body.expiresAt
        : (() => {
            throw new Error("expiresAt must be ISO timestamp or null");
          })();

  // RLS will enforce that the event belongs to this user (insert with-check
  // policy uses auth.uid() = user_id), but we double-check ownership here
  // so the failure surfaces as a 403 rather than a swallowed RLS error.
  const { data: ownedEvent, error: ownErr } = await supabase
    .from("events")
    .select("id")
    .eq("id", body.eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownErr || !ownedEvent) {
    return NextResponse.json(
      { error: "Event not found or not yours" },
      { status: 403 },
    );
  }

  // Idempotency: if a share already exists for this event, return it
  // instead of creating a duplicate. Matches the dashboard UX where
  // toggling the switch back on should re-surface the existing token.
  const existing = await getShareForEvent(body.eventId);
  if (existing) {
    if (!existing.enabled) {
      await setShareEnabled(existing.token, true);
      return NextResponse.json({ share: { ...existing, enabled: true } });
    }
    return NextResponse.json({ share: existing });
  }

  try {
    const share = await createShare({
      eventId: body.eventId,
      userId: user.id,
      expiresAt,
    });
    return NextResponse.json({ share }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create share";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isToken(body.token)) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }
  const token = body.token;

  // Owner check via RLS: the cookie-bound client cannot read a row that
  // doesn't belong to the user, so a missing select is "not yours OR
  // not found" — same outward 404 either way to avoid token enumeration.
  const { data: row, error: readErr } = await supabase
    .from("report_shares")
    .select("token, event_id, user_id, expires_at, can_edit")
    .eq("token", token)
    .maybeSingle();
  if (readErr || !row) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  try {
    switch (body.action) {
      case "enable":
        await setShareEnabled(token, true);
        return NextResponse.json({ ok: true });
      case "disable":
        await setShareEnabled(token, false);
        return NextResponse.json({ ok: true });
      case "set_expiry": {
        if (!isIsoOrNull(body.expiresAt)) {
          return NextResponse.json(
            { error: "expiresAt must be ISO timestamp or null" },
            { status: 400 },
          );
        }
        await setShareExpiry(token, body.expiresAt);
        return NextResponse.json({ ok: true });
      }
      case "regenerate": {
        if (!row.event_id) {
          return NextResponse.json(
            { error: "Cannot regenerate a client-scope share from this route" },
            { status: 400 },
          );
        }
        const fresh = await regenerateShareToken({
          oldToken: token,
          eventId: row.event_id,
          userId: user.id,
          expiresAt: row.expires_at,
        });
        return NextResponse.json({ share: fresh });
      }
      case "set_can_edit": {
        if (typeof body.canEdit !== "boolean") {
          return NextResponse.json(
            { error: "canEdit must be a boolean" },
            { status: 400 },
          );
        }
        await setShareCanEdit(token, body.canEdit);
        const { data: full, error: refetchErr } = await supabase
          .from("report_shares")
          .select("*")
          .eq("token", token)
          .maybeSingle();
        if (refetchErr || !full) {
          return NextResponse.json(
            { error: refetchErr?.message ?? "Share row missing after update" },
            { status: 500 },
          );
        }
        return NextResponse.json({ share: full });
      }
      default:
        return NextResponse.json(
          { error: "Unknown action" },
          { status: 400 },
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Patch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const token = req.nextUrl.searchParams.get("token");
  if (!isToken(token)) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  // RLS-scoped delete — a token belonging to a different user is silently
  // a no-op (zero rows affected), which matches the same outward 200.
  try {
    await deleteShare(token);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
