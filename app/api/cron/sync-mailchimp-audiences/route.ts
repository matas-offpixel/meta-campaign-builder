import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  syncMailchimpAudienceForEvent,
  type MailchimpSyncEventRow,
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
 * Daily cron (06:00 UTC). For every active brand_campaign event that has a
 * resolved mailchimp_audience_id (event override > client default), calls
 * the Mailchimp Marketing API and upserts one row into
 * mailchimp_audience_snapshots.
 *
 * Service-role only. Idempotent on (event_id, snapshot_at::date).
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

  // Load all brand_campaign events. We filter to events that have either a
  // direct mailchimp_audience_id or a client with one — the sync helper
  // resolves the effective id.
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, user_id, kind, mailchimp_audience_id, client_id, client:clients ( mailchimp_account_id, mailchimp_audience_id )",
    )
    .eq("kind", "brand_campaign");

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const events = (data ?? []) as unknown as (MailchimpSyncEventRow & { client_id?: string | null })[];

  const results: Array<{
    eventId: string;
    ok: boolean;
    snapshotId?: string;
    error?: string;
  }> = [];

  for (const event of events) {
    const result = await syncMailchimpAudienceForEvent(supabase, event);
    results.push(result);
  }

  const synced = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => !r.ok && (r.error === "no_audience_id" || r.error === "no_account_id")).length;
  const failed = results.filter((r) => !r.ok && r.error !== "no_audience_id" && r.error !== "no_account_id").length;

  console.log(
    `[sync-mailchimp-audiences] synced=${synced} skipped=${skipped} failed=${failed} total=${results.length}`,
  );

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    eventsProcessed: results.length,
    synced,
    skipped,
    failed,
    results,
  });
}
