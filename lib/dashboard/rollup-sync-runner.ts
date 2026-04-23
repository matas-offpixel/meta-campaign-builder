import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
 * lib/dashboard/rollup-sync-runner.ts
 *
 * Core "sync one event's daily rollups" routine. Originally inlined in
 * `app/api/ticketing/rollup-sync/route.ts`; extracted in PR #67 so the
 * same routine can run from three transports without re-implementing
 * the leg orchestration:
 *
 *   1. POST /api/ticketing/rollup-sync         — owner-session caller
 *      (existing dashboard "Sync now" / EventDailyReportBlock mount).
 *   2. POST /api/ticketing/rollup-sync/by-share-token/[token] — public
 *      share page Refresh button. Auth = the share token itself.
 *      Resolved share row supplies the event_id and owner user_id; we
 *      pass the service-role client through.
 *   3. GET  /api/cron/rollup-sync-events       — daily scheduled run
 *      across every event with an active ticketing connection +
 *      `general_sale_at` within the last 60 days.
 *
 * The runner intentionally takes pre-resolved primitives (`eventId`,
 * `userId`, `eventCode`, `eventTimezone`, `adAccountId`) rather than
 * doing its own event lookup, because each caller has different
 * authorisation rules around how that lookup is permitted. Keeping the
 * runner narrow + side-effect-free outside the upserts makes it
 * straightforward to test.
 */

export interface RollupSyncInput {
  /** Supabase client. Owner-session route passes the auth client; the
   *  share-token route + cron pass the service-role client. The
   *  underlying `event_daily_rollups` upserts are written under
   *  `userId`, not the caller's session — so RLS is moot for those. */
  supabase: SupabaseClient;
  eventId: string;
  /** The OWNING user_id of the event. Used as:
   *   - the principal for `resolveServerMetaToken` (each user has
   *     their own Facebook OAuth token row)
   *   - the `user_id` written on the upserted rollup rows
   *  Cron and share-token paths resolve this from the event row before
   *  calling the runner. */
  userId: string;
  /** Resolved bracket-stripped event_code (e.g. "LEEDS26-FACUP"). Null
   *  short-circuits the Meta leg with reason="no_event_code". */
  eventCode: string | null;
  /** IANA timezone string for daily-bucketing Eventbrite orders. Null
   *  is acceptable — the orders helper falls back to UTC. */
  eventTimezone: string | null;
  /** Resolved Meta ad account id (e.g. "act_123456"). Null short-
   *  circuits the Meta leg with reason="no_ad_account". */
  adAccountId: string | null;
}

export interface SyncLegResult {
  ok: boolean;
  rowsWritten?: number;
  error?: string;
  reason?: string;
}

export interface SyncDiagnostics {
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
  /** Number of `event_ticketing_links` rows for this event. */
  eventbriteLinksCount: number;
  /** External (Eventbrite) event ids we synced from. */
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

export interface SyncSummary {
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

export interface RollupSyncResult {
  /** True when both legs succeeded. */
  ok: boolean;
  /** True when at least one leg succeeded. Used by route handlers to
   *  pick a 200 vs 207 vs 500 status code. */
  anyOk: boolean;
  summary: SyncSummary;
  /** Legacy per-leg shape — clients written before the `summary`
   *  block landed read these directly. Kept for backwards compat. */
  meta: SyncLegResult;
  eventbrite: SyncLegResult;
  diagnostics: SyncDiagnostics;
}

/**
 * Sync one event's daily Meta + Eventbrite rollups.
 *
 * Both legs run independently — a Meta failure never stops Eventbrite
 * and vice versa. Each leg's error is captured into the per-leg result
 * + the unified summary. The route handler decides what HTTP status
 * to return based on `result.ok` / `result.anyOk`.
 *
 * Logging conventions (kept identical to the pre-PR-#67 inline code so
 * Vercel log alerting and dashboards keep working):
 *
 *   - One `[rollup-sync] start` line on entry with all the resolved
 *     scope fields.
 *   - Per-leg `[rollup-sync] meta …` / `[rollup-sync] eventbrite …`
 *     with success/skip/failure detail.
 *   - One `[rollup-sync] done` summary line on exit.
 *
 * Tokens are NEVER logged — only "present"/"missing" booleans for
 * env vars and ID/code values that are already non-secret.
 */
export async function runRollupSyncForEvent(
  input: RollupSyncInput,
): Promise<RollupSyncResult> {
  const {
    supabase,
    eventId,
    userId,
    eventCode,
    eventTimezone,
    adAccountId,
  } = input;

  // Window: last 60 days (inclusive of today) in account local time.
  // We don't need timezone-perfect bounds — Meta returns rows by
  // ad-account local day, and any drift around midnight is washed out
  // by the next sync cycle.
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - 59);
  const sinceStr = ymd(since);
  const untilStr = ymd(until);

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
    `[rollup-sync] start event_id=${eventId} user_id=${userId} event_code=${
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
      const { token } = await resolveServerMetaToken(supabase, userId);
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
            userId,
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
            userId,
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

  const summary: SyncSummary = {
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

  return {
    ok: allOk,
    anyOk,
    summary,
    meta: metaResult,
    eventbrite: eventbriteResult,
    diagnostics,
  };
}

function ymd(d: Date): string {
  // Local-tz YYYY-MM-DD. Same approach as the rest of the app — we
  // don't need timezone-perfect bounds for a 60-day rolling window.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
