import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { diagnoseMailchimpForEvent } from "@/lib/mailchimp/diagnose";

/**
 * GET /api/events/[id]/mailchimp/diagnose
 *
 * Returns Mailchimp connection status for a brand_campaign event without
 * leaking credentials. Used by operators to debug zero-row sync failures.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data: eventRow, error: eventError } = await supabase
    .from("events")
    .select(
      "id, user_id, kind, mailchimp_audience_id, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    return NextResponse.json({ ok: false, error: eventError.message }, { status: 500 });
  }
  if (!eventRow) {
    return NextResponse.json({ ok: false, error: "Event not found." }, { status: 404 });
  }

  const event = eventRow as {
    id: string;
    user_id: string;
    kind: string | null;
    mailchimp_audience_id: string | null;
    client:
      | { mailchimp_account_id: string | null; mailchimp_audience_id: string | null }
      | { mailchimp_account_id: string | null; mailchimp_audience_id: string | null }[]
      | null;
  };

  if (event.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const diagnosis = await diagnoseMailchimpForEvent(supabase, event);

  return NextResponse.json({
    mailchimpReachable: diagnosis.apiPingOk,
    mailchimpRowsWritten: diagnosis.snapshotRowCount,
    mailchimpError: diagnosis.error ?? null,
    ...diagnosis,
  });
}
