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
import { tryGetEventbriteTokenKey } from "@/lib/ticketing/secrets";

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
 * Response shape:
 *   {
 *     ok: boolean,                      // true when both legs ok
 *     summary: {                        // top-level booleans + total
 *       metaOk, metaError, metaReason,
 *       eventbriteOk, eventbriteError, eventbriteReason,
 *       rowsUpserted,
 *     },
 *     meta: SyncLegResult,              // legacy per-leg detail kept
 *     eventbrite: SyncLegResult,        // for backwards compat
 *     diagnostics: { ... }              // env / scope / counts — safe
 *                                       // to log to the browser
 *   }
 *
 *   Status codes:
 *     200 — both legs succeeded (rowsUpserted may be 0 when nothing
 *           to write yet — that's a valid steady state, not an error).
 *     207 — at least one leg succeeded and at least one failed.
 *     200 with ok=false — both legs failed (no HTTP error because the
 *           per-leg error strings are the actual diagnostic; we want
 *           the client to render them, not see a generic 500).
 *
 * Diagnostic logging:
 *   Every run emits a structured `[rollup-sync]` log line per leg
 *   plus one summary line. This is the _only_ place we get to print
 *   the env shape (EVENTBRITE_TOKEN_KEY presence, resolved Meta ad
 *   account id, matched campaigns) so when a sync silently writes
 *   zero rows we have a paper trail without needing to redeploy.
 *   Tokens are NEVER printed — only "present"/"missing" booleans and
 *   ID/code values that are already non-secret.
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

interface SyncDiagnostics {
  /** Resolved `clients.meta_ad_account_id` for the event's client.
   *  Null when the client has no ad account linked. */
  metaAdAccountId: string | null;
  /** Bracket-wrapped event_code we filtered on (or null when unset). */
  metaCodeBracketed: string | null;
  /** Distinct Meta campaign names that matched the case-sensitive
   *  filter — empty array doesn't mean "broken", it means no live
   *  campaigns yet for this event. */
  metaCampaignsMatched: string[];
  /** Number of distinct days Meta returned. */
  metaDaysReturned: number;
  /** Number of Meta rows we attempted to upsert (== days returned;
   *  a separate field anyway because future versions may pad zero
   *  rows for empty days). */
  metaRowsAttempted: number;
  /** True when EVENTBRITE_TOKEN_KEY is set in the running process.
   *  Always boolean — the actual key is never returned. */
  eventbriteTokenKeyPresent: boolean;
  /** Number of `event_ticketing_links` rows for this event. >1 only
   *  if the event was linked to multiple Eventbrite events at once,
   *  which v1 doesn't surface in the UI. */
  eventbriteLinksCount: number;
  /** External (Eventbrite) event id we synced from. Null when we
   *  couldn't resolve a link. Comma-joined when multiple links. */
  eventbriteEventIds: string[];
  /** Number of Eventbrite rows we attempted to upsert (sum across
   *  all links). */
  eventbriteRowsAttempted: number;
  /** Date window used for the Meta query (inclusive). */
  windowSince: string;
  windowUntil: string;
  /** Resolved event reporting timezone (or null when unset). */
  eventTimezone: string | null;
}

interface SummaryBlock {
  metaOk: boolean;
  metaError: string | null;
  metaReason: string | null;
  metaRowsUpserted: number;
  eventbriteOk: boolean;
  eventbriteError: string | null;
  eventbriteReason: string | null;
  eventbriteRowsUpserted: number;
  /** Sum across both legs — the easiest "did anything happen?" gauge. */
  rowsUpserted: number;
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

  // Diagnostic record — populated by both legs as we go and emitted
  // back to the caller (and to server logs) at the end. Defaulted up
  // front so a mid-flight throw still has a populated shape to log.
  const diagnostics: SyncDiagnostics = {
    metaAdAccountId: adAccountId,
    metaCodeBracketed: eventCode ? `[${eventCode}]` : null,
    metaCampaignsMatched: [],
    metaDaysReturned: 0,
    metaRowsAttempted: 0,
    eventbriteTokenKeyPresent: tryGetEventbriteTokenKey() !== null,
    eventbriteLinksCount: 0,
    eventbriteEventIds: [],
    eventbriteRowsAttempted: 0,
    windowSince: sinceStr,
    windowUntil: untilStr,
    eventTimezone,
  };

  console.log(
    `[rollup-sync] start event_id=${eventId} user_id=${user.id} event_code=${
      eventCode ?? "<null>"
    } meta_ad_account_id=${adAccountId ?? "<null>"} tz=${
      eventTimezone ?? "<null>"
    } window=${sinceStr}..${untilStr} EVENTBRITE_TOKEN_KEY=${
      diagnostics.eventbriteTokenKeyPresent ? "present" : "missing"
    }`,
  );

  // ── Meta leg ──────────────────────────────────────────────────────
  const metaResult: SyncLegResult = { ok: false };
  if (!eventCode) {
    metaResult.reason = "no_event_code";
    metaResult.error = "Event has no event_code — set one to track Meta spend.";
    console.warn(`[rollup-sync] meta skip: ${metaResult.reason}`);
  } else if (!adAccountId) {
    metaResult.reason = "no_ad_account";
    metaResult.error = "Client has no Meta ad account linked.";
    console.warn(`[rollup-sync] meta skip: ${metaResult.reason}`);
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
        console.warn(
          `[rollup-sync] meta fetch failed reason=${metaFetch.error.reason} msg=${metaFetch.error.message}`,
        );
      } else {
        diagnostics.metaCampaignsMatched = metaFetch.campaignNames;
        diagnostics.metaDaysReturned = metaFetch.days.length;
        diagnostics.metaRowsAttempted = metaFetch.days.length;
        console.log(
          `[rollup-sync] meta fetch ok campaigns=${
            metaFetch.campaignNames.length
          } days=${metaFetch.days.length}${
            metaFetch.campaignNames.length > 0
              ? ` names=${JSON.stringify(metaFetch.campaignNames)}`
              : ""
          }`,
        );
        try {
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
          console.log(
            `[rollup-sync] meta upsert ok rows_written=${metaFetch.days.length}`,
          );
        } catch (err) {
          metaResult.error =
            err instanceof Error ? err.message : "Unknown error";
          console.error(`[rollup-sync] meta upsert failed: ${metaResult.error}`);
        }
      }
    } catch (err) {
      metaResult.error = err instanceof Error ? err.message : "Unknown error";
      console.error(`[rollup-sync] meta leg threw: ${metaResult.error}`);
    }
  }

  // ── Eventbrite leg ────────────────────────────────────────────────
  const eventbriteResult: SyncLegResult = { ok: false };
  try {
    const links = await listLinksForEvent(supabase, eventId);
    diagnostics.eventbriteLinksCount = links.length;
    diagnostics.eventbriteEventIds = links.map((l) => l.external_event_id);
    if (links.length === 0) {
      eventbriteResult.reason = "not_linked";
      eventbriteResult.error =
        "No ticketing link — pick the Eventbrite event in the panel above first.";
      console.warn(`[rollup-sync] eventbrite skip: ${eventbriteResult.reason}`);
    } else {
      console.log(
        `[rollup-sync] eventbrite links=${links.length} external_ids=${JSON.stringify(
          diagnostics.eventbriteEventIds,
        )}`,
      );
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
            console.warn(
              `[rollup-sync] eventbrite connection ${link.connection_id} vanished`,
            );
            continue;
          }
          // Only Eventbrite orders are wired in v1. Other providers
          // (4thefans) will land their own orders fetcher behind the
          // same provider name check.
          if (connection.provider !== "eventbrite") {
            firstError ??= `Daily breakdown not implemented for provider "${connection.provider}".`;
            console.warn(
              `[rollup-sync] eventbrite skip provider=${connection.provider}`,
            );
            continue;
          }
          const { rows } = await fetchDailyOrdersForEvent({
            connection,
            externalEventId: link.external_event_id,
            eventTimezone,
          });
          diagnostics.eventbriteRowsAttempted += rows.length;
          console.log(
            `[rollup-sync] eventbrite link=${link.external_event_id} fetched_rows=${rows.length}`,
          );
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
          console.log(
            `[rollup-sync] eventbrite link=${link.external_event_id} upsert ok rows_written=${rows.length}`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          firstError ??= message;
          console.error(
            `[rollup-sync] eventbrite link=${link.external_event_id} failed: ${message}`,
          );
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
    eventbriteResult.error =
      err instanceof Error ? err.message : "Unknown error";
    console.error(`[rollup-sync] eventbrite leg threw: ${eventbriteResult.error}`);
  }

  const allOk = metaResult.ok && eventbriteResult.ok;
  const anyOk = metaResult.ok || eventbriteResult.ok;

  const summary: SummaryBlock = {
    metaOk: metaResult.ok,
    metaError: metaResult.ok ? null : (metaResult.error ?? null),
    metaReason: metaResult.reason ?? null,
    metaRowsUpserted: metaResult.rowsWritten ?? 0,
    eventbriteOk: eventbriteResult.ok,
    eventbriteError: eventbriteResult.ok
      ? null
      : (eventbriteResult.error ?? null),
    eventbriteReason: eventbriteResult.reason ?? null,
    eventbriteRowsUpserted: eventbriteResult.rowsWritten ?? 0,
    rowsUpserted:
      (metaResult.rowsWritten ?? 0) + (eventbriteResult.rowsWritten ?? 0),
  };

  console.log(
    `[rollup-sync] done event_id=${eventId} ok=${allOk} meta_ok=${
      summary.metaOk
    } meta_rows=${summary.metaRowsUpserted} eb_ok=${
      summary.eventbriteOk
    } eb_rows=${summary.eventbriteRowsUpserted} total_rows=${
      summary.rowsUpserted
    }`,
  );

  return NextResponse.json(
    {
      ok: allOk,
      summary,
      meta: metaResult,
      eventbrite: eventbriteResult,
      diagnostics,
    },
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
