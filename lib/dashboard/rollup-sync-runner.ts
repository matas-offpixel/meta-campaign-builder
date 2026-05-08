import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  fetchEventDailyMetaMetrics,
  fetchEventTodayMetaSnapshot,
} from "@/lib/insights/meta";
import {
  getEarliestSnapshotForEventSource,
  getLatestSnapshotForLinkBeforeDate,
  getConnectionWithDecryptedCredentials,
  insertSnapshot,
  listLinksForEvent,
  recordConnectionSync,
  replaceEventTicketTiers,
  updateEventCapacityFromTicketTiers,
} from "@/lib/db/ticketing";
import {
  clearHistoricalCurrentSnapshotTicketPadding,
  upsertEventbriteRollups,
  upsertGoogleAdsRollups,
  upsertMetaRollups,
  upsertTikTokRollups,
} from "@/lib/db/event-daily-rollups";
import { eachInclusiveYmd } from "@/lib/dashboard/rollup-date-range";
import { fetchDailyOrdersForEvent } from "@/lib/ticketing/eventbrite/orders";
import { getProvider } from "@/lib/ticketing/registry";
import type {
  TicketTierBreakdown,
  TicketingConnection,
} from "@/lib/ticketing/types";
import { tryGetEventbriteTokenKey } from "@/lib/ticketing/secrets";
import { currentSnapshotDailyDelta } from "@/lib/ticketing/current-snapshot-delta";
import {
  allocateVenueSpendForCode,
  type VenueAllocatorResult,
} from "@/lib/dashboard/venue-spend-allocator";
import { getTikTokCredentials } from "@/lib/tiktok/credentials";
import {
  fetchTikTokDailyRollupInsights,
} from "@/lib/tiktok/rollup-insights";
import {
  runTikTokRollupLeg,
  type TikTokRollupDeps,
} from "@/lib/dashboard/tiktok-rollup-leg";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import { fetchGoogleAdsDailyRollupInsights } from "@/lib/google-ads/rollup-insights";
import {
  runGoogleAdsRollupLeg,
  type GoogleAdsRollupDeps,
} from "@/lib/dashboard/google-ads-rollup-leg";
import { shouldInvokeVenueAllocator } from "@/lib/dashboard/venue-allocator-trigger";

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
  /** Owning client_id — needed by the per-event spend allocator
   *  (PR D2) to scope the venue sibling lookup so we don't match
   *  another client that happens to share an event_code.
   *  Null short-circuits the allocator leg without failing the
   *  sync (old callers pre-D2 keep working). */
  clientId?: string | null;
  /** Event's `event_date` — part of the venue key when present.
   *  Null-date imported venue groups still run allocation, grouped
   *  under (client_id, event_code, event_date IS NULL). */
  eventDate?: string | null;
  /** Event-level TikTok account FK. Falls back to `clientTikTokAccountId`. */
  eventTikTokAccountId?: string | null;
  /** Client-level TikTok account FK used when the event has no override. */
  clientTikTokAccountId?: string | null;
  /** Event-level Google Ads account FK. Falls back to `clientGoogleAdsAccountId`. */
  eventGoogleAdsAccountId?: string | null;
  /** Client-level Google Ads account FK used when the event has no override. */
  clientGoogleAdsAccountId?: string | null;
  /**
   * Test-only override for the 50001 retry delay. Runtime keeps the TikTok
   * Business API's 10s cool-off.
   */
  tiktokRateLimitRetryDelayMs?: number;
  /** Test hooks only — production callers use the real TikTok helpers. */
  tiktokDeps?: Partial<TikTokRollupDeps>;
  /** Test hooks only — production callers use the real Google Ads helpers. */
  googleAdsDeps?: Partial<GoogleAdsRollupDeps>;
  /**
   * Rolling window length in calendar days including today.
   * Default 60 (cron + dashboard “Sync now”).
   */
  rollupWindowDays?: number;
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
  /**
   * Server-local YYYY-MM-DD treated as "today" by both this runner
   * and the Daily Tracker UI's synthetic placeholder. The two MUST
   * agree or the placeholder won't be replaced by the real row.
   */
  todayDate: string;
  /**
   * `true` when the historical Meta `time_increment=1` call returned
   * a row keyed on `todayDate`. `false` triggers the live snapshot
   * fall-forward (date_preset=today) and ultimately the zero-pad.
   */
  metaTodayInWindow: boolean;
  /**
   * `true` when today's row was sourced from the `date_preset=today`
   * fall-forward (i.e. window missed it but live snapshot returned).
   */
  metaTodayFromSnapshot: boolean;
  /**
   * `true` when neither path returned today, so we wrote a (0, 0)
   * placeholder for today purely to make the daily-tracker row exist.
   * Subsequent syncs overwrite with real numbers as they materialise.
   */
  metaTodayPadded: boolean;
  /**
   * `true` when the Eventbrite orders leg's daily aggregate already
   * had a row for today.
   */
  eventbriteTodayInWindow: boolean;
  /**
   * `true` when we wrote a zero-row for today because no Eventbrite
   * orders bucketed under today (no orders yet, or all in non-paid
   * status).
   */
  eventbriteTodayPadded: boolean;
  /** Calendar days in the sync window that received Meta zero-padding. */
  metaWindowDaysPadded: number;
  /** Calendar days in the sync window that received Eventbrite zero-padding. */
  eventbriteWindowDaysPadded: number;
  /**
   * Post-upsert sanity probe — `null` when the assertion was skipped
   * (read-back failed, or both legs were skipped). Otherwise reports
   * whether today's row exists and which `source_*_at` fields
   * landed. A warning log is emitted alongside.
   */
  todayRowAfterSync: TodayRowProbe | null;
  /**
   * Summary of the per-event spend allocator leg (PR D2). `null`
   * when the allocator didn't run (no event_code, no client_id —
   * old callers that haven't opted in, or solo-event venues where
   * allocation is a no-op). When present, it
   * reports the sibling count, distinct ad names seen, rows
   * written, and the per-event lifetime breakdown — the last is
   * what the post-deploy verification step prints to confirm
   * Brighton's Croatia allocation exceeds the others.
   */
  allocatorResult: VenueAllocatorResult | null;
}

export interface TodayRowProbe {
  /** True iff a row exists for `(event_id, todayDate)`. */
  exists: boolean;
  hasMetaTimestamp: boolean;
  hasEventbriteTimestamp: boolean;
  /** `event_daily_rollups.ad_spend` for today, or null. */
  ad_spend: number | null;
  /** `event_daily_rollups.tickets_sold` for today, or null. */
  tickets_sold: number | null;
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
  tiktokOk: boolean;
  tiktokError: string | null;
  tiktokReason: string | null;
  tiktokRowsUpserted: number;
  googleAdsOk: boolean;
  googleAdsError: string | null;
  googleAdsReason: string | null;
  googleAdsRowsUpserted: number;
  /**
   * Allocator leg (PR D2 / PR #120) — `null` when the allocator
   * didn't run (missing scope inputs or Meta leg bailed first;
   * nothing to report). `true` when the allocator ran and wrote
   * rows. `false` when the allocator ran but bailed for a recoverable
   * reason (e.g. no siblings, opponent extraction returned empty);
   * the raw `ad_spend` column is unaffected either way so this is
   * never fatal to the overall sync.
   */
  allocatorOk: boolean | null;
  allocatorError: string | null;
  allocatorReason: string | null;
  allocatorRowsUpserted: number;
  /**
   * Per-ad classification error count — useful in the inline error
   * chip when the allocator bailed partway through. Zero is the happy
   * path.
   */
  allocatorClassErrors: number;
  /** Sum across all legs — the easiest "did anything happen?" gauge. */
  rowsUpserted: number;
  /**
   * Semantic success: "did every leg that was supposed to run
   * actually succeed?". Treats **expected terminal states** as
   * success so operators don't see phantom failures on events that
   * legitimately don't have (say) an Eventbrite link:
   *
   *   - Meta leg: `metaOk` OR reason is `"no_event_code"` /
   *     `"no_ad_account"` (the event is not set up for Meta yet —
   *     not a runtime failure).
   *   - Eventbrite leg: `eventbriteOk` OR reason is `"not_linked"`
   *     (event has no Eventbrite binding — e.g. 4theFans events
   *     routed through internal ticketing).
   *   - Allocator leg: treated as non-fatal; only counts as failure
   *     when `allocatorOk === false` AND the Meta leg succeeded
   *     (otherwise the allocator's skip is cascading from Meta's).
   *
   * The legacy boolean `ok` (result.ok) remains the strict AND of
   * metaOk+eventbriteOk for backwards compatibility with pre-#121
   * callers. New callers should prefer `synced`.
   */
  synced: boolean;
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
  tiktok: SyncLegResult;
  googleAds: SyncLegResult;
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
    clientId,
    eventDate,
    eventTikTokAccountId,
    clientTikTokAccountId,
    eventGoogleAdsAccountId,
    clientGoogleAdsAccountId,
    tiktokRateLimitRetryDelayMs,
    tiktokDeps,
    googleAdsDeps,
    rollupWindowDays,
  } = input;

  const windowDays = rollupWindowDays ?? 60;

  // Rolling window inclusive of `until` (default 60 days).
  // We don't need timezone-perfect bounds — Meta returns rows by
  // ad-account local day, and any drift around midnight is washed out
  // by the next sync cycle.
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - (windowDays - 1));
  const sinceStr = ymd(since);
  const untilStr = ymd(until);

  // `todayStr` MUST match what the Daily Tracker UI uses when it
  // builds its synthetic placeholder row (see
  // `components/dashboard/events/daily-tracker.tsx → buildDisplayRows`).
  // Both this runner and the share-page server render in UTC, so
  // local-tz `ymd()` is correct on both sides.
  const todayStr = untilStr;

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
    todayDate: todayStr,
    metaTodayInWindow: false,
    metaTodayFromSnapshot: false,
    metaTodayPadded: false,
    eventbriteTodayInWindow: false,
    eventbriteTodayPadded: false,
    metaWindowDaysPadded: 0,
    eventbriteWindowDaysPadded: 0,
    todayRowAfterSync: null,
    allocatorResult: null,
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

  const tiktokAccountId = eventTikTokAccountId ?? clientTikTokAccountId ?? null;
  const tiktokPromise = runTikTokRollupLeg({
    supabase,
    eventId,
    userId,
    eventCode,
    tiktokAccountId,
    since: sinceStr,
    until: untilStr,
    retryDelayMs: tiktokRateLimitRetryDelayMs ?? 10_000,
    deps: {
      getCredentials: getTikTokCredentials,
      fetchDailyInsights: fetchTikTokDailyRollupInsights,
      upsertRollups: upsertTikTokRollups,
      sleep,
      ...tiktokDeps,
    },
  });
  const googleAdsAccountId =
    eventGoogleAdsAccountId ?? clientGoogleAdsAccountId ?? null;
  const googleAdsPromise = runGoogleAdsRollupLeg({
    supabase,
    eventId,
    userId,
    eventCode,
    googleAdsAccountId,
    since: sinceStr,
    until: untilStr,
    deps: {
      getCredentials: getGoogleAdsCredentials,
      fetchDailyInsights: fetchGoogleAdsDailyRollupInsights,
      upsertRollups: upsertGoogleAdsRollups,
      ...googleAdsDeps,
    },
  });

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
        console.log(
          `[rollup-sync] meta fetch ok campaigns=${
            metaFetch.campaignNames.length
          } days=${metaFetch.days.length}${
            metaFetch.campaignNames.length > 0
              ? ` names=${JSON.stringify(metaFetch.campaignNames)}`
              : ""
          }`,
        );

        // ── Today's row guarantee ──────────────────────────────────
        //
        // The historical `time_increment=1` call may not include today
        // when Meta's daily breakdown hasn't been materialised yet
        // (typical lag is the first 4-8 hours of the day). When that
        // happens the daily-tracker UI synthesises an all-null
        // placeholder row, which renders as dashes and freezes the
        // running totals at yesterday — exactly the bug we're fixing.
        //
        // We attempt three fall-forwards in order:
        //
        //   1. If today's date is already in `metaFetch.days`, do nothing.
        //   2. Else hit `date_preset=today` (Meta's live counter — same
        //      source as Ads Manager's top bar, materialises within
        //      minutes of an impression). When this returns ANY value
        //      (including a legit zero) we use it.
        //   3. Else write a (0, 0) padding row so the row exists. The
        //      next sync (manual Refresh or 6-hourly cron) replaces it
        //      with real numbers as soon as Meta has them.
        //
        // The padding write still sets `source_meta_at = now()`, so
        // the dev-mode assertion can confirm the row landed even when
        // the underlying numbers are pending.
        const metaByDate = new Map<
          string,
          {
            ad_spend: number;
            ad_spend_presale: number;
            link_clicks: number;
            meta_regs: number;
            meta_impressions: number;
            meta_reach: number;
            meta_video_plays_3s: number;
            meta_video_plays_15s: number;
            meta_video_plays_p100: number;
            meta_engagements: number;
          }
        >();
        for (const d of metaFetch.days) {
          metaByDate.set(d.day, {
            ad_spend: d.spend,
            ad_spend_presale: d.presaleSpend ?? 0,
            link_clicks: d.linkClicks,
            meta_regs: d.metaRegs,
            meta_impressions: d.impressions,
            meta_reach: d.reach,
            meta_video_plays_3s: d.videoPlays3s,
            meta_video_plays_15s: d.videoPlays15s,
            meta_video_plays_p100: d.videoPlaysP100,
            meta_engagements: d.engagements,
          });
        }
        const hasToday = metaByDate.has(todayStr);
        diagnostics.metaTodayInWindow = hasToday;
        if (!hasToday) {
          let snapshotSpend = 0;
          let snapshotPresaleSpend = 0;
          let snapshotClicks = 0;
          let snapshotRegs = 0;
          let snapshotImpressions = 0;
          let snapshotReach = 0;
          let snapshotVideo3s = 0;
          let snapshotVideo15s = 0;
          let snapshotVideoP100 = 0;
          let snapshotEngagements = 0;
          let snapshotOk = false;
          try {
            const snap = await fetchEventTodayMetaSnapshot({
              eventCode,
              adAccountId,
              token,
              todayDate: todayStr,
            });
            if (snap.ok && snap.days.length > 0) {
              snapshotSpend = snap.days[0]?.spend ?? 0;
              snapshotPresaleSpend = snap.days[0]?.presaleSpend ?? 0;
              snapshotClicks = snap.days[0]?.linkClicks ?? 0;
              snapshotRegs = snap.days[0]?.metaRegs ?? 0;
              snapshotImpressions = snap.days[0]?.impressions ?? 0;
              snapshotReach = snap.days[0]?.reach ?? 0;
              snapshotVideo3s = snap.days[0]?.videoPlays3s ?? 0;
              snapshotVideo15s = snap.days[0]?.videoPlays15s ?? 0;
              snapshotVideoP100 = snap.days[0]?.videoPlaysP100 ?? 0;
              snapshotEngagements = snap.days[0]?.engagements ?? 0;
              snapshotOk = true;
              diagnostics.metaTodayFromSnapshot = true;
              console.log(
                `[rollup-sync] meta today snapshot ok spend=${snapshotSpend} clicks=${snapshotClicks} regs=${snapshotRegs}`,
              );
            } else if (!snap.ok) {
              console.warn(
                `[rollup-sync] meta today snapshot failed reason=${snap.error.reason} msg=${snap.error.message}`,
              );
            }
          } catch (err) {
            console.warn(
              `[rollup-sync] meta today snapshot threw: ${
                err instanceof Error ? err.message : "Unknown error"
              }`,
            );
          }
          if (!snapshotOk) {
            diagnostics.metaTodayPadded = true;
            console.warn(
              `[rollup-sync] meta today padded with zeros date=${todayStr}`,
            );
          }
          metaByDate.set(todayStr, {
            ad_spend: snapshotSpend,
            ad_spend_presale: snapshotPresaleSpend,
            link_clicks: snapshotClicks,
            meta_regs: snapshotRegs,
            meta_impressions: snapshotImpressions,
            meta_reach: snapshotReach,
            meta_video_plays_3s: snapshotVideo3s,
            meta_video_plays_15s: snapshotVideo15s,
            meta_video_plays_p100: snapshotVideoP100,
            meta_engagements: snapshotEngagements,
          });
        }

        const metaDaysBeforeWindowPad = metaByDate.size;
        let metaPadded = 0;
        for (const d of eachInclusiveYmd(sinceStr, untilStr)) {
          if (!metaByDate.has(d)) {
            metaByDate.set(d, {
              ad_spend: 0,
              ad_spend_presale: 0,
              link_clicks: 0,
              meta_regs: 0,
              meta_impressions: 0,
              meta_reach: 0,
              meta_video_plays_3s: 0,
              meta_video_plays_15s: 0,
              meta_video_plays_p100: 0,
              meta_engagements: 0,
            });
            metaPadded++;
          }
        }
        diagnostics.metaWindowDaysPadded = metaPadded;
        const metaRows = Array.from(metaByDate.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, v]) => ({
            date,
            ad_spend: v.ad_spend,
            ad_spend_presale: v.ad_spend_presale,
            link_clicks: v.link_clicks,
            meta_regs: v.meta_regs,
            meta_impressions: v.meta_impressions,
            meta_reach: v.meta_reach,
            meta_video_plays_3s: v.meta_video_plays_3s,
            meta_video_plays_15s: v.meta_video_plays_15s,
            meta_video_plays_p100: v.meta_video_plays_p100,
            meta_engagements: v.meta_engagements,
          }));
        diagnostics.metaRowsAttempted = metaRows.length;
        console.log(
          `[rollup-sync] meta window zero-pad added=${metaPadded} dates (map before pad=${metaDaysBeforeWindowPad})`,
        );
        try {
          await upsertMetaRollups(supabase, {
            userId,
            eventId,
            rows: metaRows,
          });
          metaResult.ok = true;
          metaResult.rowsWritten = metaRows.length;
          console.log(
            `[rollup-sync] meta upsert ok rows_written=${metaRows.length} today_in_window=${hasToday} today_from_snapshot=${diagnostics.metaTodayFromSnapshot} today_padded=${diagnostics.metaTodayPadded}`,
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

  // ── Per-event spend allocator (PR D2) ─────────────────────────────
  //
  // Runs after the Meta leg wrote `ad_spend` to every event in the
  // venue window. The allocator fetches ad-level daily insights
  // ONCE per venue, classifies each ad against the venue's opponent
  // set, and writes per-event allocation columns for every sibling.
  //
  // Short-circuits cleanly when the caller didn't supply the extra
  // scope (pre-D2 callers) or when the Meta leg itself didn't run —
  // no point fetching ad-level insights when the campaign-level
  // fetch just failed with `owner_token_expired` or similar.
  //
  // Failure policy: a failed allocator DOES NOT flip metaResult.ok.
  // The existing `ad_spend` column stays valid and the reporting
  // layer falls back to it when `ad_spend_allocated` is null.
  if (
    shouldInvokeVenueAllocator({
      metaOk: metaResult.ok,
      eventCode,
      adAccountId,
      clientId,
    })
  ) {
    try {
      const allocatorClientId = clientId as string;
      const allocatorEventCode = eventCode as string;
      const allocatorAdAccountId = adAccountId as string;
      console.info(
        `[rollup-sync] allocator invoking event_code=${allocatorEventCode} client_id=${allocatorClientId} event_date=${eventDate ?? "<null>"} window=${sinceStr}..${untilStr}`,
      );
      const { token } = await resolveServerMetaToken(supabase, userId);
      const allocator = await allocateVenueSpendForCode({
        supabase,
        userId,
        clientId: allocatorClientId,
        eventCode: allocatorEventCode,
        eventDate: eventDate ?? null,
        adAccountId: allocatorAdAccountId,
        token,
        since: sinceStr,
        until: untilStr,
      });
      diagnostics.allocatorResult = allocator;
      if (allocator.ok) {
        const lifetime = allocator.perEventLifetime
          .map(
            (r) =>
              `${r.eventId}:${r.allocated.toFixed(2)}(s=${r.specific.toFixed(
                2,
              )},g=${r.genericShare.toFixed(2)},p=${r.presale.toFixed(2)})`,
          )
          .join(" ");
        console.log(
          `[rollup-sync] allocator ok siblings=${allocator.venueEventIds.length} ads=${allocator.adNames.length} rows_written=${allocator.rowsWritten} reason=${allocator.reason ?? "ran"} class_errors=${allocator.classificationErrors.length} lifetime=${lifetime}`,
        );
      } else {
        console.warn(
          `[rollup-sync] allocator skip reason=${allocator.reason ?? "unknown"} msg=${allocator.error ?? "<none>"} class_errors=${allocator.classificationErrors.length}`,
        );
      }
    } catch (err) {
      // Hard belt-and-braces: the allocator itself wraps per-ad
      // failures + always returns a result object, but a future
      // change could still throw before that guard runs. This
      // catch intentionally does NOT flip `metaResult.ok` — the
      // raw `ad_spend` column is already persisted and the
      // reporting layer falls back to it when the allocation
      // columns are null. See the leg's docstring above.
      console.error(
        `[rollup-sync] allocator threw: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  } else if (metaResult.ok) {
    console.log(
      `[rollup-sync] allocator not invoked (clientId=${
        clientId ?? "<null>"
      } eventCode=${eventCode ?? "<null>"} adAccountId=${adAccountId ?? "<null>"})`,
    );
  }

  // ── TikTok leg ────────────────────────────────────────────────────
  //
  // Started before the Meta leg above so both paid-media axes can run
  // independently. Await here to keep the rest of the function's
  // summary / diagnostics assembly simple while preserving overlap
  // during the expensive remote calls.
  const tiktokResult = await tiktokPromise;
  const googleAdsResult = await googleAdsPromise;

  // ── Eventbrite / ticketing rollups ────────────────────────────────
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
      const mergedEbByDate = new Map<
        string,
        { tickets_sold: number; revenue: number }
      >();
      const fourthefansTierBatches: TicketTierBreakdown[][] = [];
      let capacityTierSource: TicketingConnection["provider"] | null = null;
      let snapshotSourceForPaddingClear:
        | "fourthefans"
        | "foursomething"
        | null = null;
      let hasNonEventbriteOrdersProvider = false;

      function mergeDailyTicketsRow(
        date: string,
        ticketsSold: number,
        revenue: number,
      ) {
        const cur = mergedEbByDate.get(date) ?? {
          tickets_sold: 0,
          revenue: 0,
        };
        mergedEbByDate.set(date, {
          tickets_sold: cur.tickets_sold + ticketsSold,
          revenue: cur.revenue + revenue,
        });
      }

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
          if (connection.provider === "fourthefans") {
            console.info(
              `[fourthefans-sync] event_id=${eventId} external_id=${link.external_event_id} connection_id=${connection.id}`,
            );
          }
          const isEbOrders = connection.provider === "eventbrite";
          if (!isEbOrders) {
            hasNonEventbriteOrdersProvider = true;
          }
          const src = snapshotSourceForProvider(connection.provider);
          if (src) {
            snapshotSourceForPaddingClear = src;
          }

          let rows: Array<{
            date: string;
            ticketsSold: number;
            revenue: number;
          }>;
          if (isEbOrders) {
            const fetched = await fetchDailyOrdersForEvent({
              connection,
              externalEventId: link.external_event_id,
              eventTimezone,
            });
            rows = fetched.rows;
          } else {
            const contrib = await fetchFourthefansRollupSnapshotContribution({
              supabase,
              userId,
              eventId,
              connection,
              externalEventId: link.external_event_id,
              externalApiBase: link.external_api_base ?? null,
              todayStr,
            });
            rows = contrib.rows;
            if (contrib.ticketTiers?.length) {
              fourthefansTierBatches.push(contrib.ticketTiers);
              capacityTierSource = connection.provider;
            }
          }

          console.log(
            `[rollup-sync] eventbrite link=${link.external_event_id} provider=${connection.provider} fetched_rows=${rows.length}`,
          );

          for (const r of rows) {
            mergeDailyTicketsRow(r.date, r.ticketsSold, r.revenue);
          }

          await recordConnectionSync(supabase, connection.id, { ok: true });
          console.log(
            `[rollup-sync] eventbrite link=${link.external_event_id} merged into rollup map provider=${connection.provider}`,
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

      if (fourthefansTierBatches.length > 0) {
        const mergedTiers = fourthefansTierBatches.flat();
        const tierSnapshotAt = new Date().toISOString();
        // Tier write is isolated in its own try/catch so a failure sets
        // firstError (which the response surfaces) without aborting the daily
        // rollup upsert that follows.  replaceEventTicketTiers now throws on
        // any upsert rejection (RLS or otherwise) rather than silently
        // returning 0 and letting the route claim ok:true.
        try {
          await replaceEventTicketTiers(supabase, {
            eventId,
            tiers: mergedTiers,
            snapshotAt: tierSnapshotAt,
          });
          console.info(
            `[rollup-sync] merged ticket tiers event_id=${eventId} tiers=${mergedTiers.length}`,
          );
          const capacityResult = await updateEventCapacityFromTicketTiers(
            supabase,
            {
              eventId,
              userId,
              tiers: mergedTiers,
              source: capacityTierSource ?? "fourthefans",
            },
          );
          console.info(
            `[rollup-sync] merged capacity event_id=${eventId} computed_capacity=${capacityResult.computedCapacity} updated=${capacityResult.updated} skipped=${capacityResult.skippedReason ?? "<none>"}`,
          );
        } catch (tierErr) {
          const tierMsg =
            tierErr instanceof Error ? tierErr.message : "Unknown tier write error";
          firstError ??= tierMsg;
          console.error(
            `[rollup-sync] tier upsert failed event_id=${eventId}: ${tierMsg}`,
          );
        }
      }

      if (snapshotSourceForPaddingClear) {
        const firstSourceSnapshot = await getEarliestSnapshotForEventSource(
          supabase,
          {
            eventId,
            source: snapshotSourceForPaddingClear,
          },
        );
        const firstSourceDate = firstSourceSnapshot?.snapshot_at?.slice(0, 10);
        if (firstSourceDate) {
          try {
            await clearHistoricalCurrentSnapshotTicketPadding(supabase, {
              eventId,
              beforeDate: firstSourceDate,
            });
          } catch (err) {
            console.warn(
              `[rollup-sync] current snapshot padding cleanup skipped event_id=${eventId} before_date=${firstSourceDate}: ${
                err instanceof Error ? err.message : "Unknown error"
              }`,
            );
          }
        }
      }

      const hadOrdersToday = mergedEbByDate.has(todayStr);
      diagnostics.eventbriteTodayInWindow = hadOrdersToday;
      if (!hadOrdersToday && !hasNonEventbriteOrdersProvider) {
        diagnostics.eventbriteTodayPadded = true;
        console.warn(
          `[rollup-sync] eventbrite today has no paid orders; will zero-pad in window`,
        );
      }

      const ebBeforePad = mergedEbByDate.size;
      let ebPadded = 0;
      if (!hasNonEventbriteOrdersProvider) {
        for (const d of eachInclusiveYmd(sinceStr, untilStr)) {
          if (!mergedEbByDate.has(d)) {
            mergedEbByDate.set(d, { tickets_sold: 0, revenue: 0 });
            ebPadded++;
          }
        }
      }
      diagnostics.eventbriteWindowDaysPadded = ebPadded;

      const ebUpsertRows = Array.from(mergedEbByDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({
          date,
          tickets_sold: v.tickets_sold,
          revenue: v.revenue,
        }));
      diagnostics.eventbriteRowsAttempted = ebUpsertRows.length;
      console.log(
        `[rollup-sync] eventbrite merged window zero-pad added=${ebPadded} dates (with orders before pad=${ebBeforePad})`,
      );

      if (ebUpsertRows.length > 0) {
        await upsertEventbriteRollups(supabase, {
          userId,
          eventId,
          rows: ebUpsertRows,
        });
        totalRows = ebUpsertRows.length;
        console.log(
          `[rollup-sync] eventbrite merged upsert ok rows_written=${ebUpsertRows.length} today_in_window=${hadOrdersToday}`,
        );
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

  // ── Today-row probe ────────────────────────────────────────────────
  //
  // Read back the (event_id, todayDate) row to confirm the upserts
  // landed end-to-end. Always runs — cost is a single indexed select;
  // the diagnostic value (catching the "today missing" regression
  // before a client notices) is worth it. The result is also surfaced
  // in the JSON response so a manual Refresh failure surfaces next to
  // the leg results without grepping logs.
  //
  // Warning policy:
  //   - Missing row entirely → console.warn (something's wrong even if
  //     both legs reported ok).
  //   - Missing source_meta_at when meta leg succeeded → console.warn.
  //   - Missing source_eventbrite_at when eb leg succeeded → console.warn.
  //   - Otherwise → console.log with the row contents.
  diagnostics.todayRowAfterSync = await probeTodayRow(
    supabase,
    eventId,
    todayStr,
  );
  const probe = diagnostics.todayRowAfterSync;
  if (probe) {
    const missing: string[] = [];
    if (!probe.exists) missing.push("row");
    if (probe.exists && !probe.hasMetaTimestamp && metaResult.ok) {
      missing.push("source_meta_at");
    }
    if (probe.exists && !probe.hasEventbriteTimestamp && eventbriteResult.ok) {
      missing.push("source_eventbrite_at");
    }
    if (missing.length > 0) {
      console.warn(
        `[rollup-sync] today-row probe MISSING fields=${JSON.stringify(
          missing,
        )} event_id=${eventId} date=${todayStr}`,
      );
    } else {
      console.log(
        `[rollup-sync] today-row probe ok event_id=${eventId} date=${todayStr} ad_spend=${probe.ad_spend} tickets_sold=${probe.tickets_sold}`,
      );
    }
  }

  const allOk = metaResult.ok && eventbriteResult.ok;
  const anyOk =
    metaResult.ok || eventbriteResult.ok || tiktokResult.ok || googleAdsResult.ok;

  // Allocator roll-up — pull from the diagnostics object we threaded
  // through above. `null` on every field means the allocator leg
  // didn't run at all (caller didn't opt in, or Meta failed first).
  const allocator = diagnostics.allocatorResult;
  const allocatorOk: boolean | null = allocator ? allocator.ok : null;
  const allocatorError: string | null = allocator?.ok === false
    ? (allocator.error ?? null)
    : null;
  const allocatorReason: string | null = allocator?.reason ?? null;
  const allocatorRowsUpserted: number = allocator?.rowsWritten ?? 0;
  const allocatorClassErrors: number =
    allocator?.classificationErrors.length ?? 0;

  // Semantic success — treat expected terminal states as success.
  // See `SyncSummary.synced` for the full acceptance rule set.
  const metaExpectedSkip =
    metaResult.reason === "no_event_code" ||
    metaResult.reason === "no_ad_account";
  const eventbriteExpectedSkip = eventbriteResult.reason === "not_linked";
  const metaOkOrExpectedSkip = metaResult.ok || metaExpectedSkip;
  const eventbriteOkOrExpectedSkip =
    eventbriteResult.ok || eventbriteExpectedSkip;
  // Allocator failures are never fatal — the raw `ad_spend` column
  // is still authoritative. We surface allocatorError downstream so
  // the operator can see it, but `synced` stays true as long as the
  // two primary legs are accounted for.
  const synced = metaOkOrExpectedSkip && eventbriteOkOrExpectedSkip;

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
    tiktokOk: tiktokResult.ok,
    tiktokError: tiktokResult.ok ? null : (tiktokResult.error ?? null),
    tiktokReason: tiktokResult.reason ?? null,
    tiktokRowsUpserted: tiktokResult.rowsWritten ?? 0,
    googleAdsOk: googleAdsResult.ok,
    googleAdsError: googleAdsResult.ok ? null : (googleAdsResult.error ?? null),
    googleAdsReason: googleAdsResult.reason ?? null,
    googleAdsRowsUpserted: googleAdsResult.rowsWritten ?? 0,
    allocatorOk,
    allocatorError,
    allocatorReason,
    allocatorRowsUpserted,
    allocatorClassErrors,
    rowsUpserted:
      (metaResult.rowsWritten ?? 0) +
      (eventbriteResult.rowsWritten ?? 0) +
      (tiktokResult.rowsWritten ?? 0) +
      (googleAdsResult.rowsWritten ?? 0) +
      allocatorRowsUpserted,
    synced,
  };

  console.log(
    `[rollup-sync] done event_id=${eventId} ok=${allOk} synced=${synced} meta_ok=${
      summary.metaOk
    }${summary.metaReason ? `(${summary.metaReason})` : ""} meta_rows=${
      summary.metaRowsUpserted
    } tt_ok=${summary.tiktokOk}${
      summary.tiktokReason ? `(${summary.tiktokReason})` : ""
    } tt_rows=${summary.tiktokRowsUpserted} gads_ok=${summary.googleAdsOk}${
      summary.googleAdsReason ? `(${summary.googleAdsReason})` : ""
    } gads_rows=${
      summary.googleAdsRowsUpserted
    } eb_ok=${summary.eventbriteOk}${
      summary.eventbriteReason ? `(${summary.eventbriteReason})` : ""
    } eb_rows=${summary.eventbriteRowsUpserted} alloc_ok=${
      summary.allocatorOk ?? "n/a"
    }${
      summary.allocatorReason ? `(${summary.allocatorReason})` : ""
    } alloc_rows=${summary.allocatorRowsUpserted} alloc_class_errors=${
      summary.allocatorClassErrors
    } total_rows=${summary.rowsUpserted}`,
  );

  return {
    ok: allOk,
    anyOk,
    summary,
    meta: metaResult,
    eventbrite: eventbriteResult,
    tiktok: tiktokResult,
    googleAds: googleAdsResult,
    diagnostics,
  };
}

/**
 * Fetches one external listing (4theFans / foursomething API snapshot path),
 * writes `ticket_sales_snapshots` scoped by `external_event_id`, and returns
 * today's daily delta row + tier breakdown for merging across multi-link
 * events. Tier/capacity writes are deferred to the rollup caller.
 */
async function fetchFourthefansRollupSnapshotContribution(args: {
  supabase: SupabaseClient;
  userId: string;
  eventId: string;
  connection: TicketingConnection;
  externalEventId: string;
  /** Per-link API base override (migration 083). Null = use provider default. */
  externalApiBase?: string | null;
  todayStr: string;
}): Promise<{
  rows: Array<{ date: string; ticketsSold: number; revenue: number }>;
  ticketTiers: TicketTierBreakdown[] | undefined;
}> {
  const provider = getProvider(args.connection.provider);
  const previousSnapshot = await getLatestSnapshotForLinkBeforeDate(
    args.supabase,
    {
      eventId: args.eventId,
      connectionId: args.connection.id,
      externalEventId: args.externalEventId,
      beforeDate: args.todayStr,
    },
  );
  const fetched = await provider.getEventSales(
    args.connection,
    args.externalEventId,
    { apiBase: args.externalApiBase ?? null },
  );
  const ticketsSold = currentSnapshotDailyDelta({
    currentTotal: fetched.ticketsSold,
    previousTotal: previousSnapshot?.tickets_sold ?? null,
  });
  const source = snapshotSourceForProvider(args.connection.provider);
  if (source) {
    const revenue =
      fetched.grossRevenueCents == null
        ? 0
        : Number((fetched.grossRevenueCents / 100).toFixed(2));
    if (args.connection.provider === "fourthefans") {
      console.info(
        `[fourthefans-sync] writing snapshot lifetime_tickets=${fetched.ticketsSold} previous_lifetime_tickets=${previousSnapshot?.tickets_sold ?? "<none>"} daily_delta=${ticketsSold} revenue=£${revenue.toFixed(2)}`,
      );
    }
    const snapshot = await insertSnapshot(args.supabase, {
      userId: args.userId,
      eventId: args.eventId,
      connectionId: args.connection.id,
      externalEventId: args.externalEventId,
      ticketsSold: fetched.ticketsSold,
      ticketsAvailable: fetched.ticketsAvailable,
      grossRevenueCents: fetched.grossRevenueCents,
      currency: fetched.currency,
      source,
      rawPayload: fetched.rawPayload,
    });
    console.info(
      `[rollup-sync] ticket snapshot ${
        snapshot ? "inserted" : "insert failed"
      } provider=${args.connection.provider} source=${source} event_id=${
        args.eventId
      } external_event_id=${args.externalEventId} tickets_sold=${
        fetched.ticketsSold
      }`,
    );
  }
  return {
    rows: [
      {
        date: args.todayStr,
        ticketsSold,
        revenue:
          fetched.grossRevenueCents == null
            ? 0
            : Number((fetched.grossRevenueCents / 100).toFixed(2)),
      },
    ],
    ticketTiers: fetched.ticketTiers,
  };
}

function snapshotSourceForProvider(
  provider: TicketingConnection["provider"],
): "fourthefans" | "foursomething" | null {
  if (provider === "fourthefans") return "fourthefans";
  if (provider === "foursomething_internal") return "foursomething";
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ymd(d: Date): string {
  // Local-tz YYYY-MM-DD. Same approach as the rest of the app — we
  // don't need timezone-perfect bounds for a 60-day rolling window.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Fetch the post-sync state of the (event_id, todayDate) row from
 * `event_daily_rollups`. Used by the runner's end-to-end assertion to
 * confirm both legs landed their writes.
 *
 * Returns `null` only when the read itself errored (the assertion is
 * skipped in that case rather than masking the upstream sync result).
 * Returns `{exists: false, ...}` when no row exists for today —
 * callers treat this as a sync miss.
 *
 * Why a fresh select rather than trusting the upsert return value:
 *   `upsertMetaRollups` and `upsertEventbriteRollups` don't return the
 *   resulting rows. RLS, mid-flight migrations, or a concurrent write
 *   can all produce divergent state. The probe is cheap and gives us
 *   ground truth.
 */
async function probeTodayRow(
  supabase: SupabaseClient,
  eventId: string,
  todayDate: string,
): Promise<TodayRowProbe | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  try {
    const { data, error } = await client
      .from("event_daily_rollups")
      .select("ad_spend, tickets_sold, source_meta_at, source_eventbrite_at")
      .eq("event_id", eventId)
      .eq("date", todayDate)
      .maybeSingle();
    if (error) {
      console.warn(
        `[rollup-sync] today-row probe read error: ${error.message}`,
      );
      return null;
    }
    if (!data) {
      return {
        exists: false,
        hasMetaTimestamp: false,
        hasEventbriteTimestamp: false,
        ad_spend: null,
        tickets_sold: null,
      };
    }
    return {
      exists: true,
      hasMetaTimestamp: data.source_meta_at != null,
      hasEventbriteTimestamp: data.source_eventbrite_at != null,
      ad_spend: data.ad_spend != null ? Number(data.ad_spend) : null,
      tickets_sold: data.tickets_sold ?? null,
    };
  } catch (err) {
    console.warn(
      `[rollup-sync] today-row probe threw: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
    return null;
  }
}
