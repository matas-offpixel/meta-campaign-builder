import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadEventRegistrations } from "@/lib/mailchimp/registrations-loader";
import type { MailchimpSnapshotRow } from "@/lib/mailchimp/compute-registrations";

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/events/:id/mailchimp/snapshots
 *
 * Returns computed Mailchimp registration data for the event so the
 * internal `InternalEventReport` client component can display the
 * REGISTRATIONS card without full server-component wiring.
 *
 * Also returns `rows: MailchimpSnapshotRow[]` (the raw ordered snapshots)
 * so the per-event Daily Trend chart can render Registrations + CPR series.
 *
 * Requires an authenticated session — same guard as all event-scoped
 * routes in this tree.
 */
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Load event to find mailchimp_tag so we can fetch raw snapshot rows.
  const { data: eventRow } = await supabase
    .from("events")
    .select("mailchimp_tag, mailchimp_audience_id, client:clients ( mailchimp_audience_id )")
    .eq("id", id)
    .maybeSingle();

  const data = await loadEventRegistrations(supabase, id);
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Failed to load registrations" },
      { status: 500 },
    );
  }

  // Also fetch raw ordered snapshot rows for the chart.
  let rows: MailchimpSnapshotRow[] = [];
  if (eventRow) {
    const ev = eventRow as {
      mailchimp_tag: string | null;
      mailchimp_audience_id: string | null;
      client: { mailchimp_audience_id: string | null } | { mailchimp_audience_id: string | null }[] | null;
    };
    const mailchimpTag = ev.mailchimp_tag;
    const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
    const audienceId = ev.mailchimp_audience_id ?? clientRow?.mailchimp_audience_id ?? null;

    if (mailchimpTag) {
      const { data: tagRows } = await supabase
        .from("mailchimp_tag_snapshots")
        .select("email_subscribers, snapshot_at")
        .eq("event_id", id)
        .order("snapshot_at", { ascending: true });
      rows = (tagRows ?? []) as MailchimpSnapshotRow[];
    } else if (audienceId) {
      const { data: audRows } = await supabase
        .from("mailchimp_audience_snapshots")
        .select("email_subscribers, snapshot_at")
        .eq("event_id", id)
        .eq("mailchimp_audience_id", audienceId)
        .order("snapshot_at", { ascending: true });
      rows = (audRows ?? []) as MailchimpSnapshotRow[];
    }
  }

  return NextResponse.json({ ok: true, data, rows });
}
