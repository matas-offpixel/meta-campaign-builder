import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveAppBaseUrl } from "@/lib/mailchimp/tag-tracking";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/[id]/mailchimp/webhook-url
 *
 * Returns the exact webhook URL + auth credentials + Customer Journey body
 * template for this event's tag, to copy-paste into the Mailchimp UI. Surfaces
 * MAILCHIMP_WEBHOOK_SECRET to the authenticated owner — internal ops/onboarding
 * convenience. Session auth only (no Bearer path; we never echo the secret to
 * cron callers).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const { data: event, error } = await supabase
    .from("events")
    .select("id, user_id, client_id, mailchimp_audience_id, mailchimp_tag, client:clients ( mailchimp_audience_id )")
    .eq("id", eventId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!event) return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  if (event.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const tag = event.mailchimp_tag;
  if (!tag) {
    return NextResponse.json(
      { ok: false, error: "Event has no mailchimp_tag set" },
      { status: 400 },
    );
  }

  const clientRow = Array.isArray(event.client) ? event.client[0] : event.client;
  const audienceId = event.mailchimp_audience_id ?? clientRow?.mailchimp_audience_id ?? null;
  if (!audienceId) {
    return NextResponse.json(
      { ok: false, error: "Event has no mailchimp_audience_id" },
      { status: 400 },
    );
  }

  const secret = process.env.MAILCHIMP_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "MAILCHIMP_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  const base = resolveAppBaseUrl() ?? "https://app.offpixel.co.uk";
  const webhookUrl = `${base}/api/webhooks/mailchimp/${event.client_id}/${audienceId}`;

  return NextResponse.json({
    ok: true,
    tag,
    webhook_url: webhookUrl,
    webhook_url_with_secret: `${webhookUrl}?secret=${secret}`,
    auth_header: `Bearer ${secret}`,
    instructions:
      `Mailchimp → Audience → Settings → Webhooks → add the URL with ?secret ` +
      `(webhook_url_with_secret above) and enable "Profile updates" + ` +
      `"Email changed". Our handler re-fetches the member's tags on each fire ` +
      `and reconciles tag "${tag}" against the event log. Customer Journeys are ` +
      `NOT recommended — they under-report tag adds.`,
  });
}
