import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getClientScopeShare,
  mintClientShare,
  setShareEnabled,
} from "@/lib/db/report-shares";

interface PatchBody {
  token?: unknown;
  enabled?: unknown;
}

function isToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{12,32}$/.test(v);
}

/**
 * Authenticated POST — mint (or resurface) a client-scoped share token.
 *
 * Mirror of the per-event POST in `/api/share/report/route.ts`, but for
 * `scope='client'` shares that drive the public ticket-input portal.
 *
 * Idempotency: if a share already exists for the client we return it
 * instead of minting a duplicate. Disabled shares are flipped back on
 * so the dashboard "Generate link" button is forgiving.
 *
 * `url` is built from NEXT_PUBLIC_APP_URL when configured; otherwise we
 * fall back to the request origin so localhost/dev keeps working without
 * extra env wiring.
 */

interface PostBody {
  client_id?: unknown;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function buildShareUrl(req: NextRequest, token: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = configured && configured.length > 0 ? configured : req.nextUrl.origin;
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/share/client/${token}`;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }
  if (!isUuid(body.client_id)) {
    return NextResponse.json(
      { ok: false, error: "client_id must be a uuid" },
      { status: 400 },
    );
  }
  const clientId = body.client_id;

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

  const existing = await getClientScopeShare(clientId);
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
    const share = await mintClientShare({ clientId, userId: user.id });
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
 * Authenticated PATCH — toggle a client share on/off.
 *
 * Body: { token: string, enabled: boolean }
 *
 * Owner check happens via RLS: the cookie-bound client cannot read
 * (and therefore cannot update) a row that doesn't belong to the
 * caller, so a missing pre-read collapses to a 404 either way.
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
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
    .select("token, scope, client_id")
    .eq("token", body.token)
    .eq("scope", "client")
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
