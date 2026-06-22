import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { handleProfileUpdate, md5Email, recomputeDaySnapshot } from "@/lib/mailchimp/tag-tracking";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ clientId: string; audienceId: string }>;
}

interface NormalizedTagEvent {
  action: "added" | "removed";
  email: string;
  tag: string;
  firedAt: string;
}

/**
 * Verifies the inbound webhook is trusted. Three timing-safe mechanisms, any of
 * which passes:
 *   1. `?secret=` query param (classic webhook + legacy URL-secret approach).
 *   2. `Authorization: Bearer <secret>` header (Customer Journey "Make API call"
 *      supports custom headers — the cleanest setup).
 *   3. `x-mailchimp-signature` HMAC-SHA256 of the raw body (future-proofing).
 */
function isTrusted(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.MAILCHIMP_WEBHOOK_SECRET ?? "";
  if (!secret) return false;

  const querySecret = req.nextUrl.searchParams.get("secret");
  if (querySecret && timingSafeEqualStr(querySecret, secret)) return true;

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    if (timingSafeEqualStr(authHeader.slice(7).trim(), secret)) return true;
  }

  const headerSig = req.headers.get("x-mailchimp-signature");
  if (headerSig) {
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    if (timingSafeEqualStr(headerSig, computed)) return true;
  }
  return false;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * GET — Mailchimp probes the URL during webhook/journey setup. We confirm the
 * URL only if it points to a known client + audience, so we don't validate
 * arbitrary endpoints.
 */
export async function GET(_req: NextRequest, { params }: Context) {
  const { clientId, audienceId } = await params;
  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: match } = await sb
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .eq("mailchimp_audience_id", audienceId)
    .limit(1)
    .maybeSingle();
  if (!match) {
    return NextResponse.json({ ok: false, verified: false }, { status: 404 });
  }
  return NextResponse.json({ ok: true, verified: true, clientId, audienceId });
}

/**
 * POST /api/webhooks/mailchimp/[clientId]/[audienceId]
 *
 * Real-time receiver for Mailchimp tag changes. Accepts two payload shapes:
 *   - JSON (Customer Journey "Make API call"): `{ email, tag, action, fired_at }`
 *   - form-encoded (classic webhook): `type=tag_added|tag_removed` with
 *     `data[email]` / `data[tag]`, OR a profile-update event
 *     (`profile`/`upemail`/`cleaned`) which triggers a tag re-fetch + diff.
 *
 * Tag events are logged to mailchimp_tag_event_log (deduped) and the affected
 * events' deterministic per-day snapshots are recomputed.
 */
export async function POST(req: NextRequest, { params }: Context) {
  const { clientId, audienceId } = await params;
  const rawBody = await req.text();

  if (!isTrusted(req, rawBody)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const contentType = req.headers.get("content-type") ?? "";

  let normalized: NormalizedTagEvent | null = null;

  if (contentType.includes("application/json")) {
    // Customer Journey "Make API call" body.
    let json: Record<string, unknown>;
    try {
      json = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
    const email = typeof json.email === "string" ? json.email : "";
    const tag = typeof json.tag === "string" ? json.tag : "";
    if (!email || !tag) {
      return NextResponse.json({ ok: false, error: "Missing email or tag" }, { status: 400 });
    }
    normalized = {
      action: json.action === "removed" ? "removed" : "added",
      email,
      tag,
      firedAt: typeof json.fired_at === "string" ? json.fired_at : new Date().toISOString(),
    };
  } else {
    // Classic form-encoded webhook.
    const body = new URLSearchParams(rawBody);
    const type = body.get("type");
    const listId = body.get("data[list_id]");
    if (listId && listId !== audienceId) {
      return NextResponse.json({ ok: false, error: "list_id mismatch" }, { status: 400 });
    }

    if (type === "tag_added" || type === "tag_removed") {
      const email = body.get("data[email]") ?? "";
      const tag = body.get("data[tag]") ?? "";
      if (!email || !tag) {
        return NextResponse.json({ ok: false, error: "Missing email or tag" }, { status: 400 });
      }
      normalized = {
        action: type === "tag_removed" ? "removed" : "added",
        email,
        tag,
        firedAt: body.get("fired_at") ?? new Date().toISOString(),
      };
    } else if (type === "profile" || type === "upemail" || type === "cleaned") {
      // Profile-update fallback — re-fetch member tags and reconcile.
      const email = body.get("data[new_email]") || body.get("data[email]") || "";
      if (!email) {
        return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
      }
      const result = await handleProfileUpdate(supabase, clientId, audienceId, email);
      return NextResponse.json({ mode: "profile_update", ...result });
    } else {
      return NextResponse.json({ ok: true, ignored: true, reason: `type=${type ?? "none"}` });
    }
  }

  return processTagEvent(supabase, clientId, audienceId, normalized);
}

/** Logs a single normalized tag add/remove and recomputes the day snapshot. */
async function processTagEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  clientId: string,
  audienceId: string,
  evt: NormalizedTagEvent,
): Promise<NextResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const memberEmailHash = md5Email(evt.email);

  const { data: events } = await sb
    .from("events")
    .select("id, user_id, client_id")
    .eq("client_id", clientId)
    .eq("mailchimp_audience_id", audienceId)
    .eq("mailchimp_tag", evt.tag);

  if (!events || events.length === 0) {
    console.error(
      `[mailchimp-webhook] no event for tag="${evt.tag}" client=${clientId} audience=${audienceId}`,
    );
    return NextResponse.json({ ok: true, ignored: true, reason: "no_matching_event" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logRows = (events as any[]).map((event) => ({
    event_id: event.id,
    user_id: event.user_id,
    client_id: event.client_id,
    mailchimp_audience_id: audienceId,
    mailchimp_tag: evt.tag,
    member_email_hash: memberEmailHash,
    member_email_address: evt.email,
    action: evt.action,
    event_timestamp: evt.firedAt,
    raw_webhook_body: { source: "webhook", action: evt.action, fired_at: evt.firedAt },
  }));

  const { error: logErr } = await sb
    .from("mailchimp_tag_event_log")
    .upsert(logRows, {
      onConflict: "event_id,member_email_hash,action,event_timestamp",
      ignoreDuplicates: true,
    });

  if (logErr) {
    console.error(`[mailchimp-webhook] log insert failed: ${logErr.message}`);
    return NextResponse.json({ ok: false, error: logErr.message }, { status: 500 });
  }

  const eventDay = evt.firedAt.slice(0, 10);
  for (const event of events) {
    await recomputeDaySnapshot(sb, event.id, eventDay);
  }

  return NextResponse.json({ ok: true, eventsAffected: events.length, action: evt.action });
}
