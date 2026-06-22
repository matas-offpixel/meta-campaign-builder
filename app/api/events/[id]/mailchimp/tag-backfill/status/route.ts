import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient, createClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/mailchimp/tag-tracking";

export const dynamic = "force-dynamic";

/**
 * GET /api/events/[id]/mailchimp/tag-backfill/status
 *
 * Returns the most recent backfill job for the event with its progress.
 *
 * Auth: Bearer CRON_SECRET or authenticated session (own event only).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: job, error } = await sb
    .from("mailchimp_tag_backfill_jobs")
    .select(
      "id, event_id, user_id, status, total_members, members_processed, error_count, last_error, started_at, last_progress_at, completed_at, summary",
    )
    .eq("event_id", eventId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ ok: true, job: null });

  if (!isCronAuthed && job.user_id !== authUserId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const pct =
    job.total_members && job.total_members > 0
      ? Math.round((job.members_processed / job.total_members) * 100)
      : null;

  return NextResponse.json({
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      totalMembers: job.total_members,
      membersProcessed: job.members_processed,
      percentComplete: pct,
      errorCount: job.error_count,
      lastError: job.last_error,
      startedAt: job.started_at,
      lastProgressAt: job.last_progress_at,
      completedAt: job.completed_at,
      summary: job.summary,
    },
  });
}
