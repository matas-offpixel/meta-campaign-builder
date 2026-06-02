import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";
import {
  syncMailchimpAudienceForEvent,
  type MailchimpSyncEventRow,
} from "@/lib/mailchimp/sync";

/**
 * POST /api/events/[id]/mailchimp/refresh
 *
 * Auth-gated manual trigger. Syncs the Mailchimp audience snapshot for one
 * event and returns the new snapshot row. Used by the Refresh button on the
 * brand-awareness share report.
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
      "id, user_id, kind, mailchimp_audience_id, client_id, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
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

  const event = eventRow as unknown as MailchimpSyncEventRow & { client_id?: string | null };

  if (event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden." },
      { status: 403 },
    );
  }

  const result = await syncMailchimpAudienceForEvent(supabase, event);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 422 },
    );
  }

  // Return the freshly written snapshot.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data: snapshot } = await sb
    .from("mailchimp_audience_snapshots")
    .select("*")
    .eq("id", result.snapshotId)
    .maybeSingle();

  return NextResponse.json({ ok: true, snapshot });
}
