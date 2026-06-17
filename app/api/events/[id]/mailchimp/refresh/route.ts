import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import {
  syncMailchimpAudienceForEvent,
  syncMailchimpTagForEvent,
  type MailchimpSyncEventRow,
  type MailchimpTagSyncEventRow,
} from "@/lib/mailchimp/sync";

/**
 * POST /api/events/[id]/mailchimp/refresh
 *
 * Auth-gated manual trigger. Syncs the Mailchimp snapshot for one event:
 *   - If events.mailchimp_tag is set → writes a tag-scoped row to
 *     mailchimp_tag_snapshots (per-event shared-audience fix).
 *   - Otherwise → writes an audience-level row to mailchimp_audience_snapshots
 *     (brand_campaign always-on, existing behaviour).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const supabase = createServiceRoleClient();

  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select(
      "id, user_id, kind, mailchimp_audience_id, mailchimp_tag, client_id, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    return NextResponse.json(
      { ok: false, error: eventError.message },
      { status: 500 },
    );
  }
  if (!eventRow) {
    return NextResponse.json(
      { ok: false, error: "Event not found." },
      { status: 404 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = eventRow as unknown as any;

  if (ev.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const mailchimpTag: string | null = ev.mailchimp_tag ?? null;

  if (mailchimpTag) {
    // Tag-scoped refresh — write to mailchimp_tag_snapshots.
    const tagEvent: MailchimpTagSyncEventRow = {
      ...(ev as MailchimpSyncEventRow),
      mailchimp_tag: mailchimpTag,
      client_id: ev.client_id ?? null,
    };

    const result = await syncMailchimpTagForEvent(supabase, tagEvent);

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 422 },
      );
    }

    const { data: snapshot } = await sb
      .from("mailchimp_tag_snapshots")
      .select("*")
      .eq("id", result.snapshotId)
      .maybeSingle();

    return NextResponse.json({ ok: true, snapshot });
  }

  // Audience-level refresh — existing behaviour.
  const event = ev as unknown as MailchimpSyncEventRow & { client_id?: string | null };
  const result = await syncMailchimpAudienceForEvent(supabase, event);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 422 },
    );
  }

  const { data: snapshot } = await sb
    .from("mailchimp_audience_snapshots")
    .select("*")
    .eq("id", result.snapshotId)
    .maybeSingle();

  return NextResponse.json({ ok: true, snapshot });
}
