import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveComputedTikTokWindow } from "@/lib/share/tiktok-window";
import {
  fetchTikTokAdsForShare,
  type TikTokShareAdRow,
} from "@/lib/tiktok/share-render";
import { writeActiveTikTokCreativesSnapshot } from "@/lib/tiktok/snapshots";
import { cacheThumbnailsForAccounts } from "@/lib/tiktok/thumbnail-cache-run";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

interface EventToRefresh {
  id: string;
  user_id: string;
  event_code: string | null;
  event_date: string | null;
  event_start_at: string | null;
  campaign_end_at: string | null;
  tiktok_account_id: string | null;
  client: { tiktok_account_id: string | null } | { tiktok_account_id: string | null }[] | null;
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = new Date().toISOString();
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, user_id, event_code, event_date, event_start_at, campaign_end_at, tiktok_account_id, client:clients ( tiktok_account_id )",
    )
    .not("event_code", "is", null);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const events = ((data ?? []) as unknown as EventToRefresh[]).filter((event) =>
    Boolean(resolveTikTokAccountId(event) && event.event_code),
  );

  const results: Array<{
    eventId: string;
    ok: boolean;
    rows: number;
    wroteSnapshot: boolean;
    error?: string;
  }> = [];
  const thumbRowsByAccount = new Map<string, TikTokShareAdRow[]>();

  for (const event of events) {
    const accountId = resolveTikTokAccountId(event);
    const window = await resolveComputedTikTokWindow(supabase, {
      id: event.id,
      kind: eventKind(event),
      event_date: event.event_date,
      event_start_at: event.event_start_at,
      campaign_end_at: event.campaign_end_at,
    });
    if (!accountId || !event.event_code || !window) continue;
    try {
      const rows = await fetchTikTokAdsForShare({
        supabase,
        tiktokAccountId: accountId,
        eventCode: event.event_code,
        since: window.since,
        until: window.until,
      });
      const wroteSnapshot = await writeActiveTikTokCreativesSnapshot(
        supabase,
        { eventId: event.id, userId: event.user_id, window },
        { kind: "ok", rows, fetchedAt: new Date().toISOString() },
      );
      if (wroteSnapshot) {
        thumbRowsByAccount.set(accountId, [
          ...(thumbRowsByAccount.get(accountId) ?? []),
          ...rows,
        ]);
      }
      results.push({
        eventId: event.id,
        ok: true,
        rows: rows.length,
        wroteSnapshot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await writeActiveTikTokCreativesSnapshot(
        supabase,
        { eventId: event.id, userId: event.user_id, window },
        { kind: "error", message },
      );
      results.push({
        eventId: event.id,
        ok: false,
        rows: 0,
        wroteSnapshot: false,
        error: message,
      });
    }
  }

  const thumbnails = await cacheThumbnailsForAccounts({
    supabase,
    rowsByAccount: thumbRowsByAccount,
  });
  console.log(
    `[tiktok-active-creatives] tiktok_thumb_calls=${thumbnails.calls} tiktok_thumb_cached=${thumbnails.cached} tiktok_thumb_stored=${thumbnails.stored} tiktok_thumb_missing=${thumbnails.missing} tiktok_thumb_rows_without_ids=${thumbnails.rowsWithoutIds} tiktok_spark_pages=${thumbnails.sparkPages} tiktok_spark_identities_skipped=${thumbnails.sparkIdentitiesSkipped}`,
  );

  return NextResponse.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    eventsConsidered: events.length,
    eventsProcessed: results.length,
    snapshotsWritten: results.filter((result) => result.wroteSnapshot).length,
    thumbnails: {
      calls: thumbnails.calls,
      cached: thumbnails.cached,
      stored: thumbnails.stored,
      missing: thumbnails.missing,
      rowsWithoutIds: thumbnails.rowsWithoutIds,
      sparkPages: thumbnails.sparkPages,
      sparkIdentitiesSkipped: thumbnails.sparkIdentitiesSkipped,
    },
    results,
  });
}

function resolveTikTokAccountId(event: EventToRefresh): string | null {
  if (event.tiktok_account_id) return event.tiktok_account_id;
  const client = Array.isArray(event.client) ? event.client[0] : event.client;
  return client?.tiktok_account_id ?? null;
}

function eventKind(event: EventToRefresh): string {
  return event.event_date ? "event" : "brand_campaign";
}
