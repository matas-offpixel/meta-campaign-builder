import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  syncMailchimpAudienceForEvent,
  syncMailchimpTagForEvent,
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
 * Daily cron (06:00 UTC). Two passes:
 *
 * Pass 1 — Audience-level (existing):
 *   For every active brand_campaign event with a resolved mailchimp_audience_id,
 *   upserts one row into mailchimp_audience_snapshots.
 *
 * Pass 2 — Tag-level (new):
 *   For every event (any kind) that has mailchimp_tag set, calls the Mailchimp
 *   segments API to find the matching static segment and upserts one row into
 *   mailchimp_tag_snapshots. This scopes the registration count to the specific
 *   per-event tag, fixing CPR for multi-event shared-audience clients like
 *   Ironworks.
 *
 * Service-role only. Both passes are idempotent on (event_id, snapshot_at::date).
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
  });
}
