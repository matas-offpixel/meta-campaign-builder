import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { md5Email, recomputeDaySnapshot } from "@/lib/mailchimp/tag-tracking";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<{ clientId: string; audienceId: string }>;
}

/**
 * Verifies the inbound webhook is trusted. Mailchimp classic webhooks do not
 * send an HMAC header, so we support two mechanisms (either passes):
 *   1. `?secret=` query param equals MAILCHIMP_WEBHOOK_SECRET (Mailchimp's
 *      real-world URL-secret approach — append it to the configured URL).
 *   2. `x-mailchimp-signature` HMAC-SHA256 of the raw body keyed by the secret
 *      (forward-compatible / proxy setups that add a signature).
 */
function isTrusted(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.MAILCHIMP_WEBHOOK_SECRET ?? "";
  if (!secret) return false;

  const querySecret = req.nextUrl.searchParams.get("secret");
  if (querySecret && timingSafeEqualStr(querySecret, secret)) return true;

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
 * GET — Mailchimp sends a GET to validate the endpoint when a webhook is first
 * added. Respond 200 so the URL can be saved.
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/webhooks/mailchimp/[clientId]/[audienceId]
 *
 * Real-time receiver for Mailchimp tag add/remove events. Logs each event to
 * mailchimp_tag_event_log (deduped) and recomputes the affected events'
 * deterministic per-day snapshot. Path-scoped so each audience has a distinct,
 * secret-bearing URL.
 */
export async function POST(req: NextRequest, { params }: Context) {
  const { clientId, audienceId } = await params;
  const rawBody = await req.text();

  if (!isTrusted(req, rawBody)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  const body = new URLSearchParams(rawBody);
  const type = body.get("type"); // e.g. "tag_added" | "tag_removed"
  const firedAt = body.get("fired_at") ?? new Date().toISOString();
  const listId = body.get("data[list_id]");
  const email = body.get("data[email]");
  const tagName = body.get("data[tag]");

  if (listId && listId !== audienceId) {
    return NextResponse.json({ ok: false, error: "list_id mismatch" }, { status: 400 });
  }
  if (!type?.startsWith("tag_")) {
    return NextResponse.json({ ok: true, ignored: true, reason: "non_tag_event" });
  }
  if (!email || !tagName) {
    return NextResponse.json({ ok: false, error: "Missing email or tag" }, { status: 400 });
  }

  const action = type === "tag_added" ? "added" : "removed";
  const memberEmailHash = md5Email(email);

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  // Find every event tracking this audience + tag for this client.
  const { data: events } = await sb
    .from("events")
    .select("id, user_id, client_id")
    .eq("client_id", clientId)
    .eq("mailchimp_audience_id", audienceId)
    .eq("mailchimp_tag", tagName);

  if (!events || events.length === 0) {
    console.error(
      `[mailchimp-webhook] no event for tag="${tagName}" client=${clientId} audience=${audienceId}`,
    );
    return NextResponse.json({ ok: true, ignored: true, reason: "no_matching_event" });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logRows = (events as any[]).map((event) => ({
    event_id: event.id,
    user_id: event.user_id,
    client_id: event.client_id,
    mailchimp_audience_id: audienceId,
    mailchimp_tag: tagName,
    member_email_hash: memberEmailHash,
    member_email_address: email,
    action,
    event_timestamp: firedAt,
    raw_webhook_body: Object.fromEntries(body),
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

  // Recompute today's snapshot for each affected event from the event log.
  const eventDay = firedAt.slice(0, 10);
  for (const event of events) {
    await recomputeDaySnapshot(sb, event.id, eventDay);
  }

  return NextResponse.json({ ok: true, eventsAffected: events.length, action });
}
