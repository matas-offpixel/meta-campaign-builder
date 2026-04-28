import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getShareForVenue,
  mintVenueShare,
  setShareEnabled,
} from "@/lib/db/report-shares";

/**
 * Authenticated POST — mint (or resurface) a venue-scoped share
 * token for (client_id, event_code).
 *
 * Mirror of `POST /api/share/client` for scope='venue' shares
 * introduced by migration 052. The public URL resolves the token
 * to every event under that (client_id, event_code), so one token
 * covers the whole venue group — a single match-day venue with 2
 * events, or a WC26 venue with 4+ events, both flow through the
 * same path.
 *
 * Idempotency: if a share already exists we return it instead of
 * minting a duplicate. Disabled shares are flipped back on so the
 * "Share venue" CTA stays forgiving (same contract as the client
 * + per-event share routes).
 */

interface PostBody {
  client_id?: unknown;
  event_code?: unknown;
}

interface PatchBody {
  token?: unknown;
  enabled?: unknown;
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

function isEventCode(v: unknown): v is string {
  // event_code is a free-text operator string (e.g. "WC26-BRIGHTON",
  // "FA-CUP-SF-LEEDS"). Cap at a reasonable length to bound the SQL
  // lookup and keep URLs short.
  return typeof v === "string" && v.trim().length > 0 && v.length <= 128;
}

function buildShareUrl(req: NextRequest, token: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = configured && configured.length > 0 ? configured : req.nextUrl.origin;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/share/venue/${token}`;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isUuid(body.client_id)) {
    return NextResponse.json(
      { ok: false, error: "client_id must be a uuid" },
      { status: 400 },
    );
  }
  if (!isEventCode(body.event_code)) {
    return NextResponse.json(
      { ok: false, error: "event_code required" },
      { status: 400 },
    );
  }
  const clientId = body.client_id;
  const eventCode = body.event_code.trim();

  // Ownership — the caller must own the parent client AND at least
  // one event under (client_id, event_code). The event check double-
  // protects against stray event_code strings that slipped through
  // `isEventCode` — we only want to mint shares for venue codes the
  // operator actually has events under.
  const { data: ownedClient, error: ownErr } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownErr || !ownedClient) {
    return NextResponse.json(
      { ok: false, error: "Client not found or not yours" },
      { status: 403 },
    );
  }
  const { data: anyEvent } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .limit(1)
    .maybeSingle();
  if (!anyEvent) {
    return NextResponse.json(
      { ok: false, error: "No events match (client_id, event_code)" },
      { status: 404 },
    );
  }

  const existing = await getShareForVenue(clientId, eventCode);
  if (existing) {
    if (!existing.enabled) {
      await setShareEnabled(existing.token, true);
    }
    return NextResponse.json({
      ok: true,
      token: existing.token,
      url: buildShareUrl(req, existing.token),
    });
  }

  try {
    const share = await mintVenueShare({
      clientId,
      eventCode,
      userId: user.id,
    });
    return NextResponse.json(
      {
        ok: true,
        token: share.token,
        url: buildShareUrl(req, share.token),
      },
      { status: 201 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to mint share";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Authenticated PATCH — toggle a venue share on/off. Mirrors the
 * `/api/share/client` PATCH semantics: RLS gates the update to the
 * share owner, and a missing pre-read collapses to 404.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isToken(body.token)) {
    return NextResponse.json(
      { ok: false, error: "token required" },
      { status: 400 },
    );
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "enabled must be boolean" },
      { status: 400 },
    );
  }

  const { data: row, error: readErr } = await supabase
    .from("report_shares")
    .select("token, scope, client_id, event_code")
    .eq("token", body.token)
    .eq("scope", "venue")
    .maybeSingle();
  if (readErr || !row) {
    return NextResponse.json(
      { ok: false, error: "Share not found" },
      { status: 404 },
    );
  }

  try {
    await setShareEnabled(body.token, body.enabled);
    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to update share";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
