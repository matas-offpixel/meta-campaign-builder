import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";
import {
  getAudienceSegments,
  getSegmentMemberIdsPage,
  getMemberTagDateAdded,
} from "@/lib/mailchimp/client";
import {
  daySnapshotAt,
  isCronAuthorized,
  resolveAppBaseUrl,
} from "@/lib/mailchimp/tag-tracking";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Members processed per tick. ~CHUNK_SIZE * RATE_LIMIT_MS must stay well under
 * maxDuration. 200 * 100ms = 20s. */
const CHUNK_SIZE = 200;
const RATE_LIMIT_MS = 100;

/**
 * POST /api/cron/mailchimp-backfill-tick
 *
 * Processes the next chunk of the oldest pending/running backfill job. Each
 * tick:
 *   1. Picks the oldest pending/running job (one at a time).
 *   2. Reads CHUNK_SIZE member hashes from the segment at the cursor offset.
 *   3. Fetches each member's tag date_added and accumulates per-day additions
 *      into the job's summary.daily_additions map.
 *   4. Atomically advances the cursor + persists the accumulator.
 *   5. On the final chunk, materialises the true daily cumulative series into
 *      mailchimp_tag_snapshots (DELETE range + INSERT) and marks the job done.
 *
 * Driven by a per-minute Vercel cron (resilient to deploys/timeouts) and a
 * best-effort self-fire to chain chunks back-to-back when the runtime allows.
 *
 * Idempotent across restarts: the accumulator and cursor advance in one UPDATE,
 * so a chunk that fails before committing is simply re-read at the same offset.
 */
export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const { data: job } = await sb
    .from("mailchimp_tag_backfill_jobs")
    .select("*")
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ ok: true, message: "No pending jobs" });
  }

  if (job.status === "pending") {
    await sb.from("mailchimp_tag_backfill_jobs").update({ status: "running" }).eq("id", job.id);
  }

  try {
    // Resolve credentials + segment.
    const { data: event } = await sb
      .from("events")
      .select("client_id, user_id, client:clients ( mailchimp_account_id )")
      .eq("id", job.event_id)
      .maybeSingle();
    const clientRow = Array.isArray(event?.client) ? event.client[0] : event?.client;
    const accountId = clientRow?.mailchimp_account_id ?? null;
    if (!accountId) throw new Error("event client has no mailchimp_account_id");

    const creds = await getMailchimpCredentials(supabase, accountId);
    if (!creds) throw new Error("no Mailchimp credentials");

    const segmentsResp = await getAudienceSegments(creds.dc, job.mailchimp_audience_id, creds.apiKey, {
      type: "static",
      count: 1000,
    });
    const segment = (segmentsResp.segments ?? []).find((s) => s.name === job.mailchimp_tag);
    if (!segment) throw new Error(`segment "${job.mailchimp_tag}" not found`);

    // Establish total_members on first run.
    let totalMembers: number | null = job.total_members;
    if (totalMembers == null) {
      totalMembers = segment.member_count ?? 0;
      await sb
        .from("mailchimp_tag_backfill_jobs")
        .update({ total_members: totalMembers })
        .eq("id", job.id);
    }

    // Fetch this chunk of member hashes.
    const members = await getSegmentMemberIdsPage(creds.dc, job.mailchimp_audience_id, segment.id, creds.apiKey, {
      offset: job.members_processed,
      count: CHUNK_SIZE,
    });

    // Existing accumulator (per-day additions) from the job summary.
    const dailyAdditions: Record<string, number> = {
      ...((job.summary?.daily_additions as Record<string, number> | undefined) ?? {}),
    };

    if (members.length === 0) {
      // No more members — finalise.
      await finalizeJob(sb, job, dailyAdditions, totalMembers);
      return NextResponse.json({ ok: true, jobId: job.id, status: "completed" });
    }

    let chunkErrors = 0;
    let lastError: string | null = null;
    for (const member of members) {
      try {
        const dateAdded = await getMemberTagDateAdded(
          creds.dc,
          job.mailchimp_audience_id,
          member.id,
          job.mailchimp_tag,
          creds.apiKey,
        );
        if (dateAdded) {
          const day = new Date(dateAdded).toISOString().slice(0, 10);
          dailyAdditions[day] = (dailyAdditions[day] ?? 0) + 1;
        }
      } catch (err) {
        chunkErrors += 1;
        lastError = err instanceof Error ? err.message : String(err);
      }
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    const newProcessed = job.members_processed + members.length;
    const done = newProcessed >= (totalMembers ?? newProcessed) || members.length < CHUNK_SIZE;

    // Atomic: advance cursor + persist accumulator together.
    await sb
      .from("mailchimp_tag_backfill_jobs")
      .update({
        members_processed: newProcessed,
        last_processed_member_hash: members[members.length - 1]?.id ?? job.last_processed_member_hash,
        error_count: (job.error_count ?? 0) + chunkErrors,
        last_error: lastError ?? job.last_error,
        last_progress_at: new Date().toISOString(),
        summary: { ...(job.summary ?? {}), daily_additions: dailyAdditions },
      })
      .eq("id", job.id);

    if (done) {
      await finalizeJob(sb, { ...job, members_processed: newProcessed }, dailyAdditions, totalMembers);
      return NextResponse.json({
        ok: true,
        jobId: job.id,
        status: "completed",
        progress: { processed: newProcessed, total: totalMembers },
      });
    }

    // Best-effort self-fire to chain the next chunk; per-minute cron backstops.
    selfFireNextTick();

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: "running",
      progress: { processed: newProcessed, total: totalMembers },
    });
  } catch (err) {
    await sb
      .from("mailchimp_tag_backfill_jobs")
      .update({
        status: "failed",
        last_error: err instanceof Error ? err.message : String(err),
        last_progress_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return NextResponse.json(
      { ok: false, jobId: job.id, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Materialises the accumulated per-day additions into a true daily cumulative
 * series and replaces existing snapshots in the covered range.
 */
async function finalizeJob(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: any,
  dailyAdditions: Record<string, number>,
  totalMembers: number | null,
): Promise<void> {
  const days = Object.keys(dailyAdditions).sort();
  if (days.length === 0) {
    await sb
      .from("mailchimp_tag_backfill_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        summary: { ...(job.summary ?? {}), daily_additions: dailyAdditions, days_written: 0 },
      })
      .eq("id", job.id);
    return;
  }

  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;

  // Fetch event metadata for snapshot rows.
  const { data: event } = await sb
    .from("events")
    .select("user_id, client_id, mailchimp_audience_id, mailchimp_tag")
    .eq("id", job.event_id)
    .maybeSingle();
  if (!event) throw new Error("event vanished during finalize");

  // Build a full daily cumulative series (fill gap days).
  const rows: Array<Record<string, unknown>> = [];
  let running = 0;
  const startMs = new Date(`${firstDay}T00:00:00Z`).getTime();
  const endMs = new Date(`${lastDay}T00:00:00Z`).getTime();
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    running += dailyAdditions[day] ?? 0;
    rows.push({
      user_id: event.user_id,
      event_id: job.event_id,
      client_id: event.client_id,
      mailchimp_audience_id: event.mailchimp_audience_id,
      mailchimp_tag: event.mailchimp_tag,
      total_contacts: running,
      email_subscribers: running,
      snapshot_at: daySnapshotAt(day),
      raw_json: {
        source: "mailchimp_per_member_tag_history",
        method: "per_member_tag_date_backfill",
        job_id: job.id,
      },
    });
  }

  // Replace the covered range, then insert the true series.
  await sb
    .from("mailchimp_tag_snapshots")
    .delete()
    .eq("event_id", job.event_id)
    .gte("snapshot_at", `${firstDay}T00:00:00Z`)
    .lte("snapshot_at", `${lastDay}T23:59:59Z`);

  await sb.from("mailchimp_tag_snapshots").insert(rows);

  await sb
    .from("mailchimp_tag_backfill_jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      summary: {
        ...(job.summary ?? {}),
        daily_additions: dailyAdditions,
        days_written: rows.length,
        first_day: firstDay,
        last_day: lastDay,
        tag_dates_resolved: Object.values(dailyAdditions).reduce((a, b) => a + b, 0),
        total_members: totalMembers,
      },
    })
    .eq("id", job.id);

  console.error(
    `[mailchimp-backfill-tick] finalised job=${job.id} event=${job.event_id} rows=${rows.length} ${firstDay}..${lastDay}`,
  );
}

/** Fire-and-forget POST to chain the next tick. No-op if base URL unknown. */
function selfFireNextTick(): void {
  const base = resolveAppBaseUrl();
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  void fetch(`${base}/api/cron/mailchimp-backfill-tick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {
    /* per-minute cron backstops */
  });
}
