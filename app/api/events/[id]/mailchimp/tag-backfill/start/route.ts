import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient, createClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/mailchimp/tag-tracking";

export const dynamic = "force-dynamic";

/**
 * POST /api/events/[id]/mailchimp/tag-backfill/start
 *
 * Creates a one-time resumable historical backfill job for the event's
 * Mailchimp tag and returns its job ID immediately. Actual work is performed in
 * chunks by /api/cron/mailchimp-backfill-tick. If a pending/running job already
 * exists for the event, returns it instead of creating a duplicate.
 *
 * Auth: Bearer CRON_SECRET or authenticated session (own event only).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const isCronAuthed = isCronAuthorized(req.headers.get("authorization"));
  let authUserId: string | null = null;
  if (!isCronAuthed) {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    authUserId = user.id;
  }

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const { data: eventRow, error: evErr } = await sb
    .from("events")
    .select(
      "id, user_id, mailchimp_audience_id, mailchimp_tag, client:clients ( mailchimp_audience_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });
  if (!eventRow) return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = eventRow as any;
  if (!isCronAuthed && ev.user_id !== authUserId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const tagName: string | null = ev.mailchimp_tag ?? null;
  const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
  const listId: string | null = ev.mailchimp_audience_id ?? clientRow?.mailchimp_audience_id ?? null;

  if (!tagName) {
    return NextResponse.json({ ok: false, error: "Event has no mailchimp_tag set" }, { status: 400 });
  }
  if (!listId) {
    return NextResponse.json({ ok: false, error: "Event has no mailchimp_audience_id" }, { status: 400 });
  }

  // Reuse an existing in-progress job rather than spawning a duplicate.
  const { data: existing } = await sb
    .from("mailchimp_tag_backfill_jobs")
    .select("id, status, members_processed, total_members")
    .eq("event_id", eventId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      ok: true,
      jobId: existing.id,
      status: existing.status,
      progress: { processed: existing.members_processed, total: existing.total_members },
      message: "Job already in progress",
    });
  }

  const { data: job, error: insertErr } = await sb
    .from("mailchimp_tag_backfill_jobs")
    .insert({
      event_id: eventId,
      user_id: ev.user_id,
      mailchimp_audience_id: listId,
      mailchimp_tag: tagName,
      status: "pending",
      summary: { daily_additions: {} },
    })
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, jobId: job.id, status: "pending" });
}
