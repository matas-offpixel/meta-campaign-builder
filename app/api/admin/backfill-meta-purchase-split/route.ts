import { type NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchEventDailyMetaMetrics } from "@/lib/insights/meta";
import {
  upsertMetaRollups,
  type MetaUpsertRow,
} from "@/lib/db/event-daily-rollups";

/**
 * app/api/admin/backfill-meta-purchase-split/route.ts
 *
 * Idempotent admin route that re-queries Meta /insights for every
 * event that already has any `meta_regs > 0` rollup row in the last
 * 90 days, and re-upserts via `upsertMetaRollups`. The upsert path
 * (post migration 093) writes the new `meta_purchases` and
 * `meta_leads` columns alongside the existing ones — so this single
 * pass populates both columns for the historical window without any
 * column-specific code.
 *
 * Auth: cron-secret-only. Same posture as `rollup-pre-pr395-backfill`.
 *
 * Idempotency: the upsert noop-skips rows whose values are unchanged
 * (`metaDataMatch` in `lib/db/event-daily-rollups.ts`). Re-running
 * the backfill is free.
 *
 * Rate-limit awareness: events are processed sequentially with a
 * small per-event sleep so a 200-event tenant doesn't pin the
 * Meta /insights endpoint. 4thefans + KOC together are well under
 * 200 events.
 *
 * Body:
 *   {
 *     "since"?: "YYYY-MM-DD",  // default = 90 days ago
 *     "until"?: "YYYY-MM-DD",  // default = today (UTC)
 *     "event_ids"?: string[],  // optional whitelist; empty = all
 *     "dry_run"?: boolean      // count without writing
 *   }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

interface RequestBody {
  since?: string;
  until?: string;
  event_ids?: string[];
  dry_run?: boolean;
}

interface PerEventOutcome {
  event_id: string;
  event_code: string;
  rows_attempted: number;
  rows_written: number;
  meta_regs_before: number;
  meta_purchases_before: number;
  meta_leads_before: number;
  meta_regs_after: number;
  meta_purchases_after: number;
  meta_leads_after: number;
  ok: boolean;
  error?: string;
}

function defaultSince(): string {
  return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
function defaultUntil(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }

  const since = body.since ?? defaultSince();
  const until = body.until ?? defaultUntil();
  const dryRun = body.dry_run === true;
  const eventIdAllowList = Array.isArray(body.event_ids)
    ? new Set(body.event_ids)
    : null;

  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;

  // Find every event with at least one meta_regs > 0 row in window.
  const { data: eventIdRows, error: idsErr } = await sb
    .from("event_daily_rollups")
    .select("event_id")
    .gte("date", since)
    .lte("date", until)
    .gt("meta_regs", 0);
  if (idsErr) {
    return NextResponse.json(
      { ok: false, error: `event id discovery failed: ${idsErr.message}` },
      { status: 500 },
    );
  }
  const distinctEventIds = Array.from(
    new Set(
      ((eventIdRows ?? []) as Array<{ event_id: string }>).map((r) => r.event_id),
    ),
  );
  const targetEventIds = eventIdAllowList
    ? distinctEventIds.filter((id) => eventIdAllowList.has(id))
    : distinctEventIds;

  if (targetEventIds.length === 0) {
    return NextResponse.json({
      ok: true,
      events_scanned: 0,
      window: { since, until },
      results: [],
    });
  }

  // Fetch full event metadata + ad-account binding.
  const { data: eventRows, error: eventErr } = await sb
    .from("events")
    .select(
      "id, user_id, event_code, ad_account_id, client_id, clients(id, ad_account_id)",
    )
    .in("id", targetEventIds);
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: `event metadata read failed: ${eventErr.message}` },
      { status: 500 },
    );
  }

  const results: PerEventOutcome[] = [];
  let totalRowsWritten = 0;
  let totalRowsAttempted = 0;

  for (const event of (eventRows ?? []) as Array<{
    id: string;
    user_id: string;
    event_code: string | null;
    ad_account_id: string | null;
    client_id: string;
    clients: { ad_account_id?: string | null } | null;
  }>) {
    const eventCode = event.event_code ?? "";
    const adAccount =
      event.ad_account_id ??
      (event.clients ? event.clients.ad_account_id ?? null : null);
    if (!eventCode || !adAccount) {
      results.push({
        event_id: event.id,
        event_code: eventCode,
        rows_attempted: 0,
        rows_written: 0,
        meta_regs_before: 0,
        meta_purchases_before: 0,
        meta_leads_before: 0,
        meta_regs_after: 0,
        meta_purchases_after: 0,
        meta_leads_after: 0,
        ok: false,
        error: "missing_event_code_or_ad_account",
      });
      continue;
    }

    let token: string | null = null;
    try {
      const resolved = await resolveServerMetaToken(supabase, event.user_id);
      token = resolved.token;
    } catch (err) {
      results.push({
        event_id: event.id,
        event_code: eventCode,
        rows_attempted: 0,
        rows_written: 0,
        meta_regs_before: 0,
        meta_purchases_before: 0,
        meta_leads_before: 0,
        meta_regs_after: 0,
        meta_purchases_after: 0,
        meta_leads_after: 0,
        ok: false,
        error: err instanceof Error ? err.message : "token_fetch_failed",
      });
      continue;
    }
    if (!token) {
      results.push({
        event_id: event.id,
        event_code: eventCode,
        rows_attempted: 0,
        rows_written: 0,
        meta_regs_before: 0,
        meta_purchases_before: 0,
        meta_leads_before: 0,
        meta_regs_after: 0,
        meta_purchases_after: 0,
        meta_leads_after: 0,
        ok: false,
        error: "no_meta_token_for_user",
      });
      continue;
    }

    // Count BEFORE so the per-event log shows the delta.
    const before = await columnSums(sb, event.id, since, until);

    const fetched = await fetchEventDailyMetaMetrics({
      eventCode,
      adAccountId: adAccount,
      token,
      since,
      until,
    });
    if (!fetched.ok) {
      results.push({
        event_id: event.id,
        event_code: eventCode,
        rows_attempted: 0,
        rows_written: 0,
        meta_regs_before: before.regs,
        meta_purchases_before: before.purchases,
        meta_leads_before: before.leads,
        meta_regs_after: before.regs,
        meta_purchases_after: before.purchases,
        meta_leads_after: before.leads,
        ok: false,
        error: `meta_fetch_failed:${fetched.error.reason}`,
      });
      continue;
    }

    const upsertRows: MetaUpsertRow[] = fetched.days.map((d) => ({
      date: d.day,
      ad_spend: d.spend,
      ad_spend_presale: d.presaleSpend ?? 0,
      link_clicks: d.linkClicks,
      landing_page_views: d.landingPageViews,
      meta_regs: d.metaRegs,
      meta_purchases: d.metaPurchases,
      meta_leads: d.metaLeads,
      meta_impressions: d.impressions,
      meta_reach: d.reach,
      meta_video_plays_3s: d.videoPlays3s,
      meta_video_plays_15s: d.videoPlays15s,
      meta_video_plays_p100: d.videoPlaysP100,
      meta_engagements: d.engagements,
    }));

    let writeResult: { upserted: number; skipped_noop: number } = {
      upserted: 0,
      skipped_noop: upsertRows.length,
    };
    if (!dryRun) {
      try {
        writeResult = await upsertMetaRollups(supabase, {
          userId: event.user_id,
          eventId: event.id,
          rows: upsertRows,
        });
      } catch (err) {
        results.push({
          event_id: event.id,
          event_code: eventCode,
          rows_attempted: upsertRows.length,
          rows_written: 0,
          meta_regs_before: before.regs,
          meta_purchases_before: before.purchases,
          meta_leads_before: before.leads,
          meta_regs_after: before.regs,
          meta_purchases_after: before.purchases,
          meta_leads_after: before.leads,
          ok: false,
          error:
            err instanceof Error
              ? `upsert_failed:${err.message}`
              : "upsert_failed",
        });
        continue;
      }
    }

    const after = dryRun
      ? before
      : await columnSums(sb, event.id, since, until);

    totalRowsAttempted += upsertRows.length;
    totalRowsWritten += writeResult.upserted;
    results.push({
      event_id: event.id,
      event_code: eventCode,
      rows_attempted: upsertRows.length,
      rows_written: writeResult.upserted,
      meta_regs_before: before.regs,
      meta_purchases_before: before.purchases,
      meta_leads_before: before.leads,
      meta_regs_after: after.regs,
      meta_purchases_after: after.purchases,
      meta_leads_after: after.leads,
      ok: true,
    });

    // Small inter-event delay to keep upstream rate happy.
    await sleep(120);
  }

  return NextResponse.json({
    ok: true,
    events_scanned: targetEventIds.length,
    rows_attempted: totalRowsAttempted,
    rows_written: totalRowsWritten,
    dry_run: dryRun,
    window: { since, until },
    results,
  });
}

async function columnSums(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  eventId: string,
  since: string,
  until: string,
): Promise<{ regs: number; purchases: number; leads: number }> {
  const { data } = await sb
    .from("event_daily_rollups")
    .select("meta_regs, meta_purchases, meta_leads")
    .eq("event_id", eventId)
    .gte("date", since)
    .lte("date", until);
  let regs = 0;
  let purchases = 0;
  let leads = 0;
  for (const row of (data ?? []) as Array<{
    meta_regs: number | null;
    meta_purchases: number | null;
    meta_leads: number | null;
  }>) {
    regs += row.meta_regs ?? 0;
    purchases += row.meta_purchases ?? 0;
    leads += row.meta_leads ?? 0;
  }
  return { regs, purchases, leads };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
