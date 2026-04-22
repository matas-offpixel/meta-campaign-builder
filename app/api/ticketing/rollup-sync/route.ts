import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchEventDailyMetaMetrics } from "@/lib/insights/meta";
import {
  getConnectionWithDecryptedCredentials,
  listLinksForEvent,
  recordConnectionSync,
} from "@/lib/db/ticketing";
import {
  upsertEventbriteRollups,
  upsertMetaRollups,
} from "@/lib/db/event-daily-rollups";
import { fetchDailyOrdersForEvent } from "@/lib/ticketing/eventbrite/orders";

/**
 * POST /api/ticketing/rollup-sync?eventId=X
 *
 * Pulls the last 60 days of Meta + Eventbrite daily breakdowns for a
 * single event and upserts them into `event_daily_rollups`. Idempotent
 * — re-running overwrites any same-day rows; the operator-edited
 * `notes` column is left alone.
 *
 * Two halves run independently:
 *
 *   - Meta: bracket-wrap match on campaign.name CONTAINS [event_code]
 *           via `fetchEventDailyMetaMetrics`. Failures here don't stop
 *           the Eventbrite leg.
 *
 *   - Eventbrite: for every event_ticketing_links row, decrypt the
 *           connection and aggregate orders by day in the event's
 *           timezone. Failures are recorded on the connection row so
 *           the Eventbrite live block surfaces the same error.
 *
 * Returns 200 with `{ ok, meta, eventbrite }` describing each leg.
 * 207 (multi-status) when at least one leg failed but at least one
 * succeeded; 500 only when both fail catastrophically.
 *
 * Sits next to the existing `/api/ticketing/sync` route (which writes
 * a single `ticket_sales_snapshots` row) — the snapshot route stays
 * the source of truth for "current cumulative" numbers; this route
 * powers the per-day breakdown.
 */

interface SyncLegResult {
  ok: boolean;
  rowsWritten?: number;
  error?: string;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json(
      { ok: false, error: "eventId is required" },
      { status: 400 },
    );
  }

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, event_code, event_timezone, client:clients ( meta_ad_account_id )",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  if (event.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  const eventCode = (event.event_code as string | null) ?? null;
  const eventTimezone = (event.event_timezone as string | null) ?? null;
  // Same single-vs-array unwrap as /spend-by-day; Supabase returns the
  // join as either depending on schema definition.
  const clientRel = event.client as
    | { meta_ad_account_id: string | null }
    | { meta_ad_account_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);

  // Window: last 60 days (inclusive of today) in account local time.
  // We don't need timezone-perfect bounds — Meta returns rows by
  // ad-account local day, and any drift around midnight is washed out
  // by the next sync cycle.
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 59);
  const sinceStr = ymd(since);
  const untilStr = ymd(until);

  // ── Meta leg ──────────────────────────────────────────────────────
  const metaResult: SyncLegResult = { ok: false };
  if (!eventCode) {
    metaResult.reason = "no_event_code";
    metaResult.error = "Event has no event_code — set one to track Meta spend.";
  } else if (!adAccountId) {
    metaResult.reason = "no_ad_account";
    metaResult.error = "Client has no Meta ad account linked.";
  } else {
    try {
      const { token } = await resolveServerMetaToken(supabase, user.id);
      const metaFetch = await fetchEventDailyMetaMetrics({
        eventCode,
        adAccountId,
        token,
        since: sinceStr,
        until: untilStr,
      });
      if (!metaFetch.ok) {
        metaResult.reason = metaFetch.error.reason;
        metaResult.error = metaFetch.error.message;
      } else {
        await upsertMetaRollups(supabase, {
          userId: user.id,
          eventId,
          rows: metaFetch.days.map((d) => ({
            date: d.day,
            ad_spend: d.spend,
            link_clicks: d.linkClicks,
          })),
        });
        metaResult.ok = true;
        metaResult.rowsWritten = metaFetch.days.length;
      }
    } catch (err) {
      metaResult.error = err instanceof Error ? err.message : "Unknown error";
    }
  }

  // ── Eventbrite leg ────────────────────────────────────────────────
  const eventbriteResult: SyncLegResult = { ok: false };
  try {
    const links = await listLinksForEvent(supabase, eventId);
    if (links.length === 0) {
      eventbriteResult.reason = "not_linked";
      eventbriteResult.error =
        "No ticketing link — pick the Eventbrite event in the panel above first.";
    } else {
      let totalRows = 0;
      let firstError: string | null = null;
      for (const link of links) {
        try {
          const connection = await getConnectionWithDecryptedCredentials(
            supabase,
            link.connection_id,
          );
          if (!connection) {
            firstError ??= "Connection vanished — re-create the link.";
            continue;
          }
          // Only Eventbrite orders are wired in v1. Other providers
          // (4thefans) will land their own orders fetcher behind the
          // same provider name check.
          if (connection.provider !== "eventbrite") {
            firstError ??= `Daily breakdown not implemented for provider "${connection.provider}".`;
            continue;
          }
          const { rows } = await fetchDailyOrdersForEvent({
            connection,
            externalEventId: link.external_event_id,
            eventTimezone,
          });
          await upsertEventbriteRollups(supabase, {
            userId: user.id,
            eventId,
            rows: rows.map((r) => ({
              date: r.date,
              tickets_sold: r.ticketsSold,
              revenue: r.revenue,
            })),
          });
          await recordConnectionSync(supabase, connection.id, { ok: true });
          totalRows += rows.length;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          firstError ??= message;
          // Best-effort: flip the connection to error state so the
          // live block badge picks it up.
          try {
            await recordConnectionSync(supabase, link.connection_id, {
              ok: false,
              error: message,
            });
          } catch {
            // swallow — the per-link sync result is already captured
          }
        }
      }
      if (firstError && totalRows === 0) {
        eventbriteResult.error = firstError;
      } else {
        eventbriteResult.ok = true;
        eventbriteResult.rowsWritten = totalRows;
        if (firstError) eventbriteResult.error = firstError;
      }
    }
  } catch (err) {
    eventbriteResult.error = err instanceof Error ? err.message : "Unknown error";
  }

  const allOk = metaResult.ok && eventbriteResult.ok;
  const anyOk = metaResult.ok || eventbriteResult.ok;
  return NextResponse.json(
    { ok: allOk, meta: metaResult, eventbrite: eventbriteResult },
    { status: allOk ? 200 : anyOk ? 207 : 200 },
  );
}

function ymd(d: Date): string {
  // Local-tz YYYY-MM-DD. Same approach as the rest of the app — we
  // don't need timezone-perfect bounds for a 60-day rolling window.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
