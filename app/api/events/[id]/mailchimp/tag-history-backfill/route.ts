import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient, createClient } from "@/lib/supabase/server";
import { getMailchimpCredentials } from "@/lib/mailchimp/credentials";
import {
  getAudienceSegments,
  getAllSegmentMemberIds,
  getMemberTagDateAdded,
} from "@/lib/mailchimp/client";

/**
 * Allow up to 15 minutes on Vercel Pro — backfilling ~7k members at 10/sec
 * takes roughly 11 minutes for IRWOHD "Website Sign Up".
 */
export const maxDuration = 900;

/**
 * POST /api/events/[id]/mailchimp/tag-history-backfill
 *
 * Builds true per-contact historical cumulative data for the event's Mailchimp
 * tag by iterating every segment member and reading their per-member
 * `date_added` from `GET /lists/{listId}/members/{hash}/tags`.
 *
 * This replaces any existing weighted-ramp / linear-ramp rows in
 * `mailchimp_tag_snapshots` for the backfilled date range with genuine,
 * API-sourced data.
 *
 * Auth: Bearer CRON_SECRET or authenticated session (own event only).
 *
 * Estimated runtime:
 *   - IRWOHD ~6,830 members → ~12 min
 *   - Camelphat ~2,400 members → ~4 min
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;

  // ── Dual auth ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const isCronAuthed =
    cronSecret.length > 0 &&
    authHeader.toLowerCase().startsWith("bearer ") &&
    authHeader.slice(7).trim() === cronSecret.trim();

  let authUserId: string | null = null;
  if (!isCronAuthed) {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }
    authUserId = user.id;
  }

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  // ── Load event ─────────────────────────────────────────────────────────────
  const { data: eventRow, error: evErr } = await sb
    .from("events")
    .select(
      "id, user_id, client_id, mailchimp_audience_id, mailchimp_tag, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (evErr) {
    return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });
  }
  if (!eventRow) {
    return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = eventRow as any;

  if (!isCronAuthed && ev.user_id !== authUserId) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const tagName: string | null = ev.mailchimp_tag ?? null;
  if (!tagName) {
    return NextResponse.json(
      { ok: false, error: "Event has no mailchimp_tag set" },
      { status: 400 },
    );
  }

  const clientRow = Array.isArray(ev.client) ? ev.client[0] : ev.client;
  const listId: string | null =
    ev.mailchimp_audience_id ?? clientRow?.mailchimp_audience_id ?? null;
  if (!listId) {
    return NextResponse.json(
      { ok: false, error: "Event has no mailchimp_audience_id" },
      { status: 400 },
    );
  }

  const accountId: string | null = clientRow?.mailchimp_account_id ?? null;
  if (!accountId) {
    return NextResponse.json(
      { ok: false, error: "Event has no mailchimp_account_id on client" },
      { status: 400 },
    );
  }

  // ── Resolve credentials ────────────────────────────────────────────────────
  let dc: string;
  let apiKey: string;
  try {
    const creds = await getMailchimpCredentials(supabase, accountId);
    if (!creds) throw new Error("No credentials found");
    dc = creds.dc;
    apiKey = creds.apiKey;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Mailchimp credentials: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  // ── Step 1: Find the segment ID for this tag ───────────────────────────────
  let segmentId: number;
  try {
    const segmentsResp = await getAudienceSegments(dc, listId, apiKey, {
      type: "static",
      count: 1000,
    });
    const match = (segmentsResp.segments ?? []).find((s) => s.name === tagName);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: `Tag "${tagName}" not found as a static segment in list ${listId}` },
        { status: 404 },
      );
    }
    segmentId = match.id;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Segment lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  console.error(
    `[tag-history-backfill] event=${eventId} tag="${tagName}" list=${listId} segment=${segmentId} starting`,
  );

  // ── Step 2: Fetch all member hashes ───────────────────────────────────────
  let members: { id: string }[];
  try {
    members = await getAllSegmentMemberIds(dc, listId, segmentId, apiKey);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Member list fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  console.error(
    `[tag-history-backfill] event=${eventId} fetched ${members.length} member hashes`,
  );

  // ── Step 3: Per-member tag date_added ─────────────────────────────────────
  // Rate-limit: 100ms between calls → ~10 calls/sec (Mailchimp soft limit).
  const RATE_LIMIT_MS = 100;
  const MAX_ERRORS = 50;

  const dailyAdditions = new Map<string, number>();
  const errors: Array<{ memberHash: string; error: string }> = [];

  for (const member of members) {
    try {
      const dateAdded = await getMemberTagDateAdded(dc, listId, member.id, tagName, apiKey);
      if (dateAdded) {
        const day = new Date(dateAdded).toISOString().slice(0, 10);
        dailyAdditions.set(day, (dailyAdditions.get(day) ?? 0) + 1);
      }
    } catch (err) {
      errors.push({
        memberHash: member.id,
        error: err instanceof Error ? err.message : String(err),
      });
      if (errors.length >= MAX_ERRORS) {
        console.error(
          `[tag-history-backfill] event=${eventId} aborting after ${MAX_ERRORS} errors`,
        );
        break;
      }
    }
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  const tagDatesResolved = [...dailyAdditions.values()].reduce((a, b) => a + b, 0);
  console.error(
    `[tag-history-backfill] event=${eventId} resolved ${tagDatesResolved} tag dates across ${dailyAdditions.size} days (${errors.length} errors)`,
  );

  if (dailyAdditions.size === 0) {
    return NextResponse.json(
      { ok: false, error: "No member tag dates resolved", errorCount: errors.length, errors },
      { status: 500 },
    );
  }

  // ── Step 4: Build daily cumulative series ─────────────────────────────────
  const sortedDays = [...dailyAdditions.keys()].sort();
  const firstDay = sortedDays[0]!;
  const lastDay = sortedDays[sortedDays.length - 1]!;

  const dailyCumulative: Array<{ day: string; cumulative: number }> = [];
  let running = 0;
  const startMs = new Date(`${firstDay}T00:00:00Z`).getTime();
  const endMs = new Date(`${lastDay}T00:00:00Z`).getTime();
  for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
    const day = new Date(ms).toISOString().slice(0, 10);
    running += dailyAdditions.get(day) ?? 0;
    dailyCumulative.push({ day, cumulative: running });
  }

  // ── Step 5: Delete existing rows in the backfilled range, then insert ─────
  // Keeps any rows outside the backfill window (e.g. today's live snapshot
  // at a future date) intact.
  const { error: deleteErr } = await sb
    .from("mailchimp_tag_snapshots")
    .delete()
    .eq("event_id", eventId)
    .gte("snapshot_at", `${firstDay}T00:00:00Z`)
    .lte("snapshot_at", `${lastDay}T23:59:59Z`);

  if (deleteErr) {
    return NextResponse.json(
      { ok: false, error: `Delete failed: ${deleteErr.message}` },
      { status: 500 },
    );
  }

  const rows = dailyCumulative.map(({ day, cumulative }) => ({
    user_id: ev.user_id,
    event_id: eventId,
    client_id: ev.client_id ?? null,
    mailchimp_audience_id: listId,
    mailchimp_tag: tagName,
    total_contacts: cumulative,
    email_subscribers: cumulative,
    snapshot_at: `${day}T12:00:00Z`,
    raw_json: {
      source: "mailchimp_per_member_tag_history",
      method: "per_member_tag_date_backfill",
      segment_id: segmentId,
      member_count_total: members.length,
      member_count_with_tag_date: tagDatesResolved,
      backfill_run_at: new Date().toISOString(),
    },
  }));

  const { error: insertErr } = await sb.from("mailchimp_tag_snapshots").insert(rows);
  if (insertErr) {
    return NextResponse.json(
      { ok: false, error: `Insert failed: ${insertErr.message}` },
      { status: 500 },
    );
  }

  console.error(
    `[tag-history-backfill] event=${eventId} wrote ${rows.length} rows from ${firstDay} to ${lastDay}`,
  );

  return NextResponse.json({
    ok: true,
    summary: {
      eventId,
      tagName,
      segmentId,
      membersFetched: members.length,
      tagDatesResolved,
      daysWritten: rows.length,
      firstDay,
      lastDay,
      errorCount: errors.length,
    },
  });
}
