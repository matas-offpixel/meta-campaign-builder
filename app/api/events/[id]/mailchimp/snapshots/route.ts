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
 * For `kind="brand_campaign"` events with `mailchimp_tag` set, the rows are
 * a **composed** view: `mailchimp_audience_snapshots` rows that predate the
 * earliest tag snapshot are prepended so the chart shows uninterrupted growth
 * from campaign launch. Without this, IRWOHD's May/Jun audience history is
 * invisible once tag-scoped sync began on 19 Jun (PR #605 regression fix).
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

  // Load event to find kind + mailchimp_tag so we can fetch raw snapshot rows.
  const { data: eventRow } = await supabase
    .from("events")
    .select("kind, mailchimp_tag, mailchimp_audience_id, client:clients ( mailchimp_audience_id )")
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
      kind: string | null;
      mailchimp_tag: string | null;
      mailchimp_audience_id: string | null;
      client: { mailchimp_audience_id: string | null } | { mailchimp_audience_id: string | null }[] | null;
    };
    const mailchimpTag = ev.mailchimp_tag;
    const isBrandCampaign = ev.kind === "brand_campaign";
    const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
    const audienceId = ev.mailchimp_audience_id ?? clientRow?.mailchimp_audience_id ?? null;

    if (mailchimpTag) {
      const { data: tagRows } = await supabase
        .from("mailchimp_tag_snapshots")
        .select("email_subscribers, snapshot_at, raw_json")
        .eq("event_id", id)
        .order("snapshot_at", { ascending: true });
      const typedTagRows = (tagRows ?? []) as MailchimpSnapshotRow[];

      // For brand_campaign events with a tag, compose audience snapshots that
      // predate the earliest tag snapshot so the chart shows continuous growth
      // from campaign launch (not just from when tag-scoped sync started).
      // kind="event" events (e.g. Camelphat) use tag_snapshots only — their
      // tag didn't exist in audience snapshots before tag-sync began.
      if (isBrandCampaign && audienceId && typedTagRows.length > 0) {
        const earliestTagAt = typedTagRows[0]!.snapshot_at;
        const { data: audRows } = await supabase
          .from("mailchimp_audience_snapshots")
          .select("email_subscribers, snapshot_at")
          .eq("event_id", id)
          .eq("mailchimp_audience_id", audienceId)
          .lt("snapshot_at", earliestTagAt)
          .order("snapshot_at", { ascending: true });
        const shaped: MailchimpSnapshotRow[] = (audRows ?? []).map((r) => ({
          email_subscribers: r.email_subscribers,
          snapshot_at: r.snapshot_at,
          raw_json: { source: "mailchimp_audience_snapshot", composed_for_brand_campaign: true },
        }));
        rows = [...shaped, ...typedTagRows];
      } else {
        rows = typedTagRows;
      }
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
