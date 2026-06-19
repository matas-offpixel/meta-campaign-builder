import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  syncMailchimpAudienceForEvent,
  syncMailchimpTagForEvent,
  syncMailchimpTagDailyHistory,
  type MailchimpSyncEventRow,
  type MailchimpTagSyncEventRow,
} from "@/lib/mailchimp/sync";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

/**
 * GET /api/cron/sync-mailchimp-audiences
 *
 * Daily cron (06:00 UTC). Three passes:
 *
 * Pass 1 — Audience-level (existing):
 *   For every active brand_campaign event with a resolved mailchimp_audience_id,
 *   upserts one row into mailchimp_audience_snapshots.
 *
 * Pass 2 — Tag-level point-in-time (new in PR #605):
 *   For every event (any kind) that has mailchimp_tag set, calls the Mailchimp
 *   segments API to find the matching static segment and upserts one row into
 *   mailchimp_tag_snapshots. This scopes the registration count to the specific
 *   per-event tag, fixing CPR for multi-event shared-audience clients like
 *   Ironworks.
 *
 * Pass 3 — Tag daily-history backfill (new in PR #617):
 *   For every tagged event whose oldest tag snapshot is < HISTORY_THRESHOLD_DAYS
 *   old (i.e. history is sparse), reconstructs per-day cumulative counts from
 *   each segment member's tag date_added field and writes historical rows into
 *   mailchimp_tag_snapshots. Idempotent — deletes the reconstructed window
 *   before re-inserting. Once a full history window is in place, this pass
 *   skips the event.
 *
 * Service-role only. All passes are idempotent.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  const supabase = createServiceRoleClient();

  // ── Pass 1: audience-level snapshots (brand_campaign events) ─────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  const { data: audienceData, error: audienceError } = await sb
    .from("events")
    .select(
      "id, user_id, kind, mailchimp_audience_id, client_id, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("kind", "brand_campaign");

  if (audienceError) {
    return NextResponse.json({ ok: false, error: audienceError.message }, { status: 500 });
  }

  const audienceEvents = (audienceData ?? []) as (MailchimpSyncEventRow & { client_id?: string | null })[];

  const audienceResults: Array<{
    eventId: string;
    ok: boolean;
    snapshotId?: string;
    error?: string;
  }> = [];

  for (const event of audienceEvents) {
    const result = await syncMailchimpAudienceForEvent(supabase, event);
    audienceResults.push(result);
  }

  const audienceSynced = audienceResults.filter((r) => r.ok).length;
  const audienceSkipped = audienceResults.filter((r) => !r.ok && (r.error === "no_audience_id" || r.error === "no_account_id")).length;
  const audienceFailed = audienceResults.filter((r) => !r.ok && r.error !== "no_audience_id" && r.error !== "no_account_id").length;

  console.log(
    `[sync-mailchimp-audiences] audience: synced=${audienceSynced} skipped=${audienceSkipped} failed=${audienceFailed} total=${audienceResults.length}`,
  );

  // ── Pass 2: tag-level snapshots (any kind of event with mailchimp_tag) ────

  const { data: tagData, error: tagError } = await sb
    .from("events")
    .select(
      "id, user_id, kind, mailchimp_audience_id, mailchimp_tag, client_id, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
    )
    .not("mailchimp_tag", "is", null);

  if (tagError) {
    console.error("[sync-mailchimp-audiences] tag query error:", tagError.message);
    // Don't fail the whole cron — return audience results + partial error.
    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      audienceEventsProcessed: audienceResults.length,
      audienceSynced,
      audienceSkipped,
      audienceFailed,
      audienceResults,
      tagError: tagError.message,
    });
  }

  const tagEvents = (tagData ?? []) as (MailchimpTagSyncEventRow & { client_id?: string | null })[];

  const tagResults: Array<{
    eventId: string;
    ok: boolean;
    snapshotId?: string;
    memberCount?: number;
    error?: string;
  }> = [];

  for (const event of tagEvents) {
    const result = await syncMailchimpTagForEvent(supabase, event);
    tagResults.push(result);
  }

  const tagSynced = tagResults.filter((r) => r.ok).length;
  const tagSkipped = tagResults.filter((r) => !r.ok && (r.error === "no_audience_id" || r.error === "no_account_id")).length;
  const tagFailed = tagResults.filter((r) => !r.ok && r.error !== "no_audience_id" && r.error !== "no_account_id" && !r.error?.startsWith("tag_not_found")).length;

  console.log(
    `[sync-mailchimp-audiences] tag: synced=${tagSynced} skipped=${tagSkipped} failed=${tagFailed} total=${tagResults.length}`,
  );

  // ── Pass 3: tag daily-history backfill ────────────────────────────────────
  // Run history reconstruction for events whose tag snapshot history is sparse
  // (oldest snapshot is < HISTORY_THRESHOLD_DAYS old, or no snapshots exist).
  // Once a full history is in place the per-event check short-circuits cheaply.

  const HISTORY_THRESHOLD_DAYS = 14;
  const thresholdDate = new Date(Date.now() - HISTORY_THRESHOLD_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // Fetch the earliest snapshot date for each tagged event in one query.
  const tagEventIds = tagEvents.map((e) => e.id);

  const historyResults: Array<{
    eventId: string;
    ok: boolean;
    rowsWritten?: number;
    firstDate?: string;
    lastDate?: string;
    skipped?: boolean;
    error?: string;
  }> = [];

  if (tagEventIds.length > 0) {
    const { data: oldestSnaps, error: oldestError } = await sb
      .from("mailchimp_tag_snapshots")
      .select("event_id, snapshot_at")
      .in("event_id", tagEventIds)
      .order("snapshot_at", { ascending: true });

    if (oldestError) {
      console.error(
        "[sync-mailchimp-audiences] history oldest-snap query error:",
        oldestError.message,
      );
    } else {
      // Build a map: event_id → earliest snapshot date.
      const oldestByEvent = new Map<string, string>();
      for (const row of (oldestSnaps ?? [])) {
        const eventId = (row as { event_id: string; snapshot_at: string }).event_id;
        const day = (row as { event_id: string; snapshot_at: string }).snapshot_at.slice(0, 10);
        if (!oldestByEvent.has(eventId) || day < oldestByEvent.get(eventId)!) {
          oldestByEvent.set(eventId, day);
        }
      }

      for (const event of tagEvents) {
        const oldest = oldestByEvent.get(event.id);
        // Needs backfill if: no history yet OR oldest snapshot is within the threshold window.
        const needsBackfill = !oldest || oldest >= thresholdDate;

        if (!needsBackfill) {
          historyResults.push({ eventId: event.id, ok: true, skipped: true });
          continue;
        }

        console.log(
          `[sync-mailchimp-audiences] history backfill: event=${event.id} oldest=${oldest ?? "none"}`,
        );

        const result = await syncMailchimpTagDailyHistory(supabase, event);
        historyResults.push({ eventId: event.id, ...result });
      }
    }
  }

  const historyBackfilled = historyResults.filter((r) => r.ok && !r.skipped && (r.rowsWritten ?? 0) > 0).length;
  const historySkipped = historyResults.filter((r) => r.skipped).length;
  const historyFailed = historyResults.filter((r) => !r.ok).length;

  console.log(
    `[sync-mailchimp-audiences] history: backfilled=${historyBackfilled} skipped=${historySkipped} failed=${historyFailed} total=${historyResults.length}`,
  );

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    audienceEventsProcessed: audienceResults.length,
    audienceSynced,
    audienceSkipped,
    audienceFailed,
    audienceResults,
    tagEventsProcessed: tagResults.length,
    tagSynced,
    tagSkipped,
    tagFailed,
    tagResults,
    historyEventsProcessed: historyResults.length,
    historyBackfilled,
    historySkipped,
    historyFailed,
    historyResults,
  });
}
