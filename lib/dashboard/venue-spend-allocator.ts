import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { upsertAllocatedSpendRollups } from "@/lib/db/event-daily-rollups";
import { extractOpponentName } from "@/lib/db/event-opponent-extraction";
import { fetchVenueDailyAdMetrics } from "@/lib/insights/meta";
import {
  allocateVenueSpend,
  integerAllocationsByEvent,
  type AllocatorAd,
  type AllocatorEvent,
} from "@/lib/dashboard/venue-spend-allocation";

/**
 * lib/dashboard/venue-spend-allocator.ts
 *
 * Thin server-side wrapper that turns the per-venue spend allocator
 * (which is pure — see lib/dashboard/venue-spend-allocation.ts) into
 * a side-effectful runner:
 *
 *   1. Look up every event in the venue (same `event_code` + same
 *      `event_date`, under the same `client_id`).
 *   2. Pull ad-level daily insights from Meta for the bracketed
 *      `[event_code]`, reconciled against campaign-level spend so
 *      inactive/off campaigns and rows without ad granularity still
 *      contribute.
 *   3. Split the ad rows by campaign phase — `presale` is aggregated
 *      into its own per-event share and persisted to
 *      `ad_spend_presale`; `onsale` flows through the opponent-
 *      matching allocator and lands in the three existing
 *      allocation columns.
 *   4. For each calendar day with any ad activity, run the pure
 *      allocator on the on-sale rows → per-event `(specific,
 *      generic_share, allocated)`; split that day's presale total
 *      evenly across every sibling → per-event `presale`.
 *   5. Upsert the combined result into `event_daily_rollups`'s four
 *      allocation columns (ad_spend_allocated, ad_spend_specific,
 *      ad_spend_generic_share, ad_spend_presale), plus allocated
 *      per-event link_clicks so venue charts do not multiply shared
 *      campaign clicks by sibling count.
 *
 * Called from `runRollupSyncForEvent` after the Meta leg succeeds —
 * it's a deliberate superset of the existing campaign-level rollup
 * (both are keyed by event_code) so the two can share a diagnostic
 * scope in logs without a bespoke cross-process contract.
 *
 * Why we refetch instead of reusing only the campaign-level fetch:
 *
 *   The allocator needs per-AD spend to classify by ad name, but
 *   Meta can return campaign spend that does not appear in the
 *   ad-level daily rows. The fetch helper therefore keeps ad-level
 *   detail where available and injects the campaign-level remainder
 *   as generic/presale spend keyed by campaign id.
 *
 * Why we run after the Meta leg rather than in parallel:
 *
 *   The Meta leg writes `ad_spend` (raw venue total per-event). The
 *   allocator writes the SAME row's allocation columns. Running
 *   serially means the allocator can safely upsert without
 *   conflicting on the row's created_at / updated_at dance. The
 *   cost is a small added serial latency on the sync — an extra
 *   1-3s for typical venues.
 *
 * Failure isolation
 *
 *   The runner wraps this entire call in try/catch + never flips
 *   the Meta leg's `ok` flag on allocator failure. Individual per-
 *   ad classification failures are caught inside the loop and
 *   reported in `classificationErrors` — the ad is dropped rather
 *   than bubbling a single malformed ad name up as a venue-wide
 *   crash. The reporting layer falls back to `ad_spend` /
 *   `events.prereg_spend` when the allocator rows are NULL, so a
 *   failed allocation is always soft.
 */

export interface VenueAllocatorInput {
  /** Service-role or owner-session Supabase client. */
  supabase: SupabaseClient;
  /** The OWNING user_id of the events. Written on insert; does
   *  NOT bypass RLS (the caller is responsible for picking the
   *  right client). */
  userId: string;
  /** client_id scoping the sibling lookup so we don't accidentally
   *  match another client's events that also share the event_code
   *  by coincidence. */
  clientId: string;
  /** Bracket-naked event_code, e.g. "WC26-BRIGHTON". The matcher
   *  wraps it in brackets. */
  eventCode: string;
  /** YYYY-MM-DD `events.event_date` shared by the venue siblings.
   *  Null short-circuits with reason="no_event_date" — can't
   *  group without a date. */
  eventDate: string | null;
  /** "act_…" prefixed ad account id. Null short-circuits the
   *  fetch. */
  adAccountId: string | null;
  /** Meta OAuth token for the owning user. */
  token: string;
  /** YYYY-MM-DD inclusive lower bound for the Meta fetch window.
   *  Kept identical to the parent rollup-sync window so the two
   *  upsert sets cover the same rows. */
  since: string;
  /** YYYY-MM-DD inclusive upper bound for the Meta fetch window. */
  until: string;
}

export interface VenueAllocatorResult {
  ok: boolean;
  /** Short reason code when ok=false. Stable strings for alert
   *  routing / dashboards — never human-facing. */
  reason?:
    | "no_event_code"
    | "no_event_date"
    | "no_ad_account"
    | "no_siblings"
    | "solo_event_skipped"
    | "meta_fetch_failed"
    | "upsert_failed";
  /** Human-safe error text for the route handler to pass through. */
  error?: string;
  /** Sibling events in the venue — stable id order. */
  venueEventIds: string[];
  /** Distinct ad names that survived the bracketed-code filter.
   *  Diagnostics only. */
  adNames: string[];
  /** Rows written across all events × days. */
  rowsWritten: number;
  /** Per-event lifetime totals — surfaced so the caller can log
   *  the reconciliation in one line (this is also what the
   *  verification step reads to confirm Brighton's Croatia row
   *  has the larger allocation). */
  perEventLifetime: Array<{
    eventId: string;
    specific: number;
    genericShare: number;
    allocated: number;
    /** This event's share of the venue's presale-campaign spend
     *  across the fetch window, lifetime. Split evenly across all
     *  siblings. */
    presale: number;
  }>;
  /** Date window that was fetched. */
  windowSince: string;
  windowUntil: string;
  /** Per-ad classification errors captured by the per-ad try/catch
   *  (Fix #2 in PR #120). Empty on happy-path runs; non-empty
   *  rows are dropped from the allocation but the rest of the
   *  venue still reconciles. */
  classificationErrors: Array<{
    adId: string;
    adName: string;
    message: string;
  }>;
  campaignDiagnostics?: Array<{
    campaignId: string;
    campaignName: string;
    spend: number;
    adRowsSpend: number;
    syntheticRemainder: number;
    linkClicks: number;
    adRowsLinkClicks: number;
    syntheticLinkClicks: number;
    isPresaleMatch: boolean;
    isAllocatedMatch: boolean;
  }>;
}

const EMPTY_RESULT = (
  partial: Partial<VenueAllocatorResult> = {},
): VenueAllocatorResult => ({
  ok: false,
  venueEventIds: [],
  adNames: [],
  rowsWritten: 0,
  perEventLifetime: [],
  windowSince: "",
  windowUntil: "",
  classificationErrors: [],
  ...partial,
});

/**
 * Allocate venue spend for one event_code + event_date pair.
 *
 * Returns a normal result (never throws) so the parent runner can
 * log per-leg diagnostics and continue — allocator failure never
 * fails the sync (the existing `ad_spend` column stays populated
 * as a fallback, and the reporting layer handles the NULL case).
 */
export async function allocateVenueSpendForCode(
  input: VenueAllocatorInput,
): Promise<VenueAllocatorResult> {
  const {
    supabase,
    userId,
    clientId,
    eventCode,
    eventDate,
    adAccountId,
    token,
    since,
    until,
  } = input;

  if (!eventCode || !eventCode.trim()) {
    return EMPTY_RESULT({
      reason: "no_event_code",
      error: "Event has no event_code set.",
      windowSince: since,
      windowUntil: until,
    });
  }
  if (!eventDate) {
    return EMPTY_RESULT({
      reason: "no_event_date",
      error: "Event has no event_date set.",
      windowSince: since,
      windowUntil: until,
    });
  }
  if (!adAccountId) {
    return EMPTY_RESULT({
      reason: "no_ad_account",
      error: "Client has no Meta ad account linked.",
      windowSince: since,
      windowUntil: until,
    });
  }

  // Sibling lookup — every event at this venue. `event_date` is
  // included in the key so a venue that happens to reuse the same
  // event_code across two tour dates (rare, but possible) stays
  // split across two allocation passes.
  const client = supabase as unknown as SupabaseClient;
  const { data: siblings, error: siblingsErr } = await client
    .from("events")
    .select("id, name")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .eq("event_date", eventDate);
  if (siblingsErr) {
    return EMPTY_RESULT({
      reason: "upsert_failed",
      error: siblingsErr.message,
      windowSince: since,
      windowUntil: until,
    });
  }
  const siblingRows = (siblings ?? []) as Array<{ id: string; name: string | null }>;
  if (siblingRows.length === 0) {
    return EMPTY_RESULT({
      reason: "no_siblings",
      error: "No events found for this (client, event_code, event_date).",
      windowSince: since,
      windowUntil: until,
    });
  }
  // Solo-event venues are a no-op for allocation: all ad spend is
  // effectively generic and the single event receives 100% of it,
  // which is exactly what the existing `ad_spend` column already
  // says. Skip the extra Meta fetch + upsert and keep the rollup
  // reader on the fallback path.
  if (siblingRows.length === 1) {
    return EMPTY_RESULT({
      ok: true,
      reason: "solo_event_skipped",
      venueEventIds: [siblingRows[0].id],
      windowSince: since,
      windowUntil: until,
    });
  }

  // Stable order used by the allocator for tie-breaks.
  const allocatorEvents: AllocatorEvent[] = siblingRows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, name: r.name ?? null }));
  const eventCount = allocatorEvents.length;

  // Fix #2 diagnostic: surface the opponent extraction decisions up
  // front so a future "Croatia didn't match" bug is traceable
  // without stepping through the allocator. The list is small
  // (~4 siblings per venue) so the single-line log is readable.
  const opponentSummary = allocatorEvents
    .map((ev) => {
      const opp = extractOpponentName(ev.name);
      return `${ev.id}:${opp ? `"${opp}"` : "<generic>"}`;
    })
    .join(" ");

  const effectiveSince = await resolveAllocatorSince(
    client,
    allocatorEvents.map((e) => e.id),
    since,
  );
  if (effectiveSince !== since) {
    console.info(
      `[venue-spend-allocator] extended window event_code=${eventCode} requested=${since} effective=${effectiveSince} until=${until}`,
    );
  }

  // Pull ad-level daily insights for the bracketed event_code. The
  // fetch starts at the earliest existing allocated/presale rollup row
  // when that predates the parent runner's rolling window; this lets a
  // normal re-sync backfill allocator-owned fields such as link_clicks
  // for historical PRESALE periods without widening the main Meta leg.
  // Meta returns zero rows when no ads are live yet — the allocator
  // handles that cleanly (returns empty perEvent allocations, which we
  // then DON'T upsert).
  const adFetch = await fetchVenueDailyAdMetrics({
    eventCode,
    adAccountId,
    token,
    since: effectiveSince,
    until,
  });
  if (!adFetch.ok) {
    return EMPTY_RESULT({
      reason: "meta_fetch_failed",
      error: adFetch.error.message,
      venueEventIds: allocatorEvents.map((e) => e.id),
      windowSince: effectiveSince,
      windowUntil: until,
    });
  }

  // Fix #1 (PR #120): split presale out of the allocator pool.
  // Presale campaigns (name contains "PRESALE" as a whole word) are
  // already double-counted against the PRE-REG column when also
  // flowing through the opponent allocator. We route their spend to
  // a separate bucket — split evenly across every event — and feed
  // ONLY on-sale rows into the opponent classifier.
  //
  // Fix #2 (PR #120): the per-ad try/catch below ensures one
  // malformed ad name (or a future regex crash) can't fail the
  // entire venue's allocation. Bad ads are recorded + dropped.
  const classificationErrors: VenueAllocatorResult["classificationErrors"] =
    [];
  const onsaleByDay = new Map<string, AllocatorAd[]>();
  const onsaleClicksByDay = new Map<string, AllocatorAd[]>();
  const presaleByDay = new Map<string, number>();
  const presaleClicksByDay = new Map<string, number>();

  // Campaign-id diagnostics: log what the Meta fetch returned vs
  // what the presale filter kept so a misclassified campaign name
  // (e.g. a PRESALE typo) is immediately visible in the rollup
  // log.
  const campaignIdsAll = new Set<string>();
  const campaignIdsOnsale = new Set<string>();
  const campaignIdsPresale = new Set<string>();

  for (const row of adFetch.rows) {
    if (row.campaignId) campaignIdsAll.add(row.campaignId);
    let bucket: "presale" | "onsale";
    try {
      bucket = row.campaignPhase;
    } catch (err) {
      // Extremely unlikely — phase is pre-computed server-side —
      // but guard against a future shape change without crashing
      // the whole leg.
      classificationErrors.push({
        adId: row.adId,
        adName: row.adName,
        message: err instanceof Error ? err.message : "Unknown error",
      });
      continue;
    }
    if (bucket === "presale") {
      if (row.campaignId) campaignIdsPresale.add(row.campaignId);
      presaleByDay.set(
        row.day,
        (presaleByDay.get(row.day) ?? 0) + sanitiseSpend(row.spend),
      );
      presaleClicksByDay.set(
        row.day,
        (presaleClicksByDay.get(row.day) ?? 0) + sanitiseSpend(row.linkClicks),
      );
    } else {
      if (row.campaignId) campaignIdsOnsale.add(row.campaignId);
      const list = onsaleByDay.get(row.day) ?? [];
      list.push({ id: row.adId, name: row.adName, spend: row.spend });
      onsaleByDay.set(row.day, list);
      const clickList = onsaleClicksByDay.get(row.day) ?? [];
      clickList.push({
        id: row.adId,
        name: row.adName,
        spend: sanitiseSpend(row.linkClicks),
      });
      onsaleClicksByDay.set(row.day, clickList);
    }
  }

  console.log(
    `[venue-spend-allocator] phase-split event_code=${eventCode} window=${since}..${until} siblings=${eventCount} ads_total=${adFetch.rows.length} campaigns_total=${campaignIdsAll.size} campaigns_onsale=${campaignIdsOnsale.size} campaigns_presale=${campaignIdsPresale.size} opponents=${opponentSummary}`,
  );
  if (isBristolEventCode(eventCode)) {
    console.info("[venue-spend-allocator] Bristol campaign diagnostics", {
      eventCode,
      campaigns: adFetch.campaignDiagnostics.map((c) => ({
        campaign_id: c.campaignId,
        name: c.campaignName,
        spend: c.spend,
        ad_rows_spend: c.adRowsSpend,
        synthetic_remainder: c.syntheticRemainder,
        link_clicks: c.linkClicks,
        ad_rows_link_clicks: c.adRowsLinkClicks,
        synthetic_link_clicks: c.syntheticLinkClicks,
        isPresale_match_result: c.isPresaleMatch,
        isAllocated_match_result: c.isAllocatedMatch,
      })),
    });
  }

  // Per-event running totals for the lifetime diagnostic.
  const lifetimeSpecific = new Map<string, number>();
  const lifetimeGenericShare = new Map<string, number>();
  const lifetimeAllocated = new Map<string, number>();
  const lifetimePresale = new Map<string, number>();
  const lifetimeLinkClicks = new Map<string, number>();

  // Payload keyed by eventId so the upsert can run one call per
  // event (Supabase's upsert is keyed on (event_id, date) and a
  // single payload across events would require onConflict hints
  // Supabase doesn't support cleanly — per-event keeps the failure
  // scope local).
  const upsertPayloads = new Map<
    string,
    Array<{
      date: string;
      ad_spend_allocated: number;
      ad_spend_specific: number;
      ad_spend_generic_share: number;
      ad_spend_presale: number;
      link_clicks: number;
    }>
  >();

  // Collect every calendar day we saw ad activity on (either
  // presale or on-sale). We iterate this union so a day with only
  // presale activity still gets a zero-allocated row written —
  // otherwise the PRE-REG column would show data for days the
  // AD SPEND column left blank, forking the timeseries shape.
  const activeDays = new Set<string>([
    ...onsaleByDay.keys(),
    ...presaleByDay.keys(),
    ...onsaleClicksByDay.keys(),
    ...presaleClicksByDay.keys(),
  ]);

  for (const day of activeDays) {
    const onsaleAds = onsaleByDay.get(day) ?? [];
    const onsaleClickAds = onsaleClicksByDay.get(day) ?? [];
    const presaleDayTotal = presaleByDay.get(day) ?? 0;
    const presaleDayClicks = presaleClicksByDay.get(day) ?? 0;
    const presaleShare = eventCount > 0 ? presaleDayTotal / eventCount : 0;
    const presaleClickShare = eventCount > 0 ? presaleDayClicks / eventCount : 0;

    // Wrap the pure allocator so a malformed ad name in the
    // classifier's regex path doesn't tank the whole venue.
    let dayResult;
    try {
      dayResult = allocateVenueSpend(allocatorEvents, onsaleAds);
    } catch (err) {
      // Every ad on the day is lost to the classification error
      // — record each so the root cause is visible in logs, and
      // fall through with zero on-sale allocation for the day.
      // Presale share for the day is still written so the
      // PRE-REG column doesn't lose data.
      const message = err instanceof Error ? err.message : "Unknown error";
      for (const ad of onsaleAds) {
        classificationErrors.push({ adId: ad.id, adName: ad.name, message });
      }
      console.error(
        `[venue-spend-allocator] classify_day_failed event_code=${eventCode} day=${day} ads=${onsaleAds.length} msg=${message}`,
      );
      dayResult = {
        perEvent: allocatorEvents.map((ev) => ({
          eventId: ev.id,
          specific: 0,
          genericShare: 0,
          allocated: 0,
        })),
        venueTotalSpend: 0,
        genericPool: 0,
        genericSharePerEvent: 0,
      };
    }

    let clickDayResult;
    try {
      clickDayResult = allocateVenueSpend(allocatorEvents, onsaleClickAds);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[venue-spend-allocator] classify_click_day_failed event_code=${eventCode} day=${day} ads=${onsaleClickAds.length} msg=${message}`,
      );
      clickDayResult = {
        perEvent: allocatorEvents.map((ev) => ({
          eventId: ev.id,
          specific: 0,
          genericShare: 0,
          allocated: 0,
        })),
        venueTotalSpend: 0,
        genericPool: 0,
        genericSharePerEvent: 0,
      };
    }
    const clickAllocations = integerAllocationsByEvent(
      allocatorEvents,
      clickDayResult.perEvent.map((r) => ({
        eventId: r.eventId,
        value: r.allocated + presaleClickShare,
      })),
      Math.round(clickDayResult.venueTotalSpend + presaleDayClicks),
    );

    for (const r of dayResult.perEvent) {
      lifetimeSpecific.set(
        r.eventId,
        (lifetimeSpecific.get(r.eventId) ?? 0) + r.specific,
      );
      lifetimeGenericShare.set(
        r.eventId,
        (lifetimeGenericShare.get(r.eventId) ?? 0) + r.genericShare,
      );
      lifetimeAllocated.set(
        r.eventId,
        (lifetimeAllocated.get(r.eventId) ?? 0) + r.allocated,
      );
      lifetimePresale.set(
        r.eventId,
        (lifetimePresale.get(r.eventId) ?? 0) + presaleShare,
      );
      const linkClicks = clickAllocations.get(r.eventId) ?? 0;
      lifetimeLinkClicks.set(
        r.eventId,
        (lifetimeLinkClicks.get(r.eventId) ?? 0) + linkClicks,
      );
      const list = upsertPayloads.get(r.eventId) ?? [];
      list.push({
        date: day,
        ad_spend_allocated: round2(r.allocated),
        ad_spend_specific: round2(r.specific),
        ad_spend_generic_share: round2(r.genericShare),
        ad_spend_presale: round2(presaleShare),
        link_clicks: linkClicks,
      });
      upsertPayloads.set(r.eventId, list);
    }
  }

  let rowsWritten = 0;
  for (const [eventId, rows] of upsertPayloads) {
    if (rows.length === 0) continue;
    try {
      await upsertAllocatedSpendRollups(supabase, {
        userId,
        eventId,
        rows,
      });
      rowsWritten += rows.length;
    } catch (err) {
      return EMPTY_RESULT({
        reason: "upsert_failed",
        error: err instanceof Error ? err.message : "Unknown error",
        venueEventIds: allocatorEvents.map((e) => e.id),
        adNames: adFetch.adNames,
        rowsWritten,
        perEventLifetime: toLifetime(
          allocatorEvents,
          lifetimeSpecific,
          lifetimeGenericShare,
          lifetimeAllocated,
          lifetimePresale,
        ),
        windowSince: effectiveSince,
        windowUntil: until,
        classificationErrors,
        campaignDiagnostics: adFetch.campaignDiagnostics,
      });
    }
  }

  if (classificationErrors.length > 0) {
    // Dedupe messages so a single malformed regex doesn't flood
    // the log when it fires once per day of history.
    const unique = new Set(classificationErrors.map((e) => e.message));
    console.warn(
      `[venue-spend-allocator] classification_errors event_code=${eventCode} count=${classificationErrors.length} unique=${unique.size} sample=${[...unique].slice(0, 3).join(" | ")}`,
    );
  }

  if (isBristolEventCode(eventCode)) {
    const rawAdSpend = round2(
      adFetch.campaignDiagnostics.reduce((sum, c) => sum + c.spend, 0),
    );
    const allocated = sumMap(lifetimeAllocated);
    const presale = sumMap(lifetimePresale);
    const linkClicks = sumMap(lifetimeLinkClicks);
    const unattributedRemainder = round2(rawAdSpend - allocated - presale);
    console.info("[venue-spend-allocator] Bristol attribution gap", {
      eventCode,
      rawAdSpend,
      allocated,
      presale,
      link_clicks: linkClicks,
      unattributed_remainder: unattributedRemainder,
      rowsWritten,
      perEventLifetime: toLifetime(
        allocatorEvents,
        lifetimeSpecific,
        lifetimeGenericShare,
        lifetimeAllocated,
        lifetimePresale,
      ),
    });
    if (Math.abs(unattributedRemainder) > 0.01) {
      console.warn(
        `[venue-spend-allocator] Bristol unattributed spend event_code=${eventCode} raw=${rawAdSpend} allocated=${allocated} presale=${presale} remainder=${unattributedRemainder}`,
      );
    }
  }

  return {
    ok: true,
    venueEventIds: allocatorEvents.map((e) => e.id),
    adNames: adFetch.adNames,
    rowsWritten,
    perEventLifetime: toLifetime(
      allocatorEvents,
      lifetimeSpecific,
      lifetimeGenericShare,
      lifetimeAllocated,
      lifetimePresale,
    ),
    windowSince: effectiveSince,
    windowUntil: until,
    classificationErrors,
    campaignDiagnostics: adFetch.campaignDiagnostics,
  };
}

function toLifetime(
  events: readonly AllocatorEvent[],
  specific: Map<string, number>,
  genericShare: Map<string, number>,
  allocated: Map<string, number>,
  presale: Map<string, number>,
): VenueAllocatorResult["perEventLifetime"] {
  return events.map((e) => ({
    eventId: e.id,
    specific: round2(specific.get(e.id) ?? 0),
    genericShare: round2(genericShare.get(e.id) ?? 0),
    allocated: round2(allocated.get(e.id) ?? 0),
    presale: round2(presale.get(e.id) ?? 0),
  }));
}

async function resolveAllocatorSince(
  client: SupabaseClient,
  eventIds: string[],
  requestedSince: string,
): Promise<string> {
  if (eventIds.length === 0) return requestedSince;
  const { data, error } = await (client as SupabaseClient)
    .from("event_daily_rollups")
    .select("date, ad_spend_allocated, ad_spend_presale")
    .in("event_id", eventIds)
    .lt("date", requestedSince)
    .order("date", { ascending: true })
    .limit(1000);
  if (error) {
    console.warn(
      `[venue-spend-allocator] existing allocation window lookup failed: ${error.message}`,
    );
    return requestedSince;
  }
  for (const row of (data ?? []) as Array<{
    date: string | null;
    ad_spend_allocated: number | null;
    ad_spend_presale: number | null;
  }>) {
    if (!row.date) continue;
    if (row.ad_spend_allocated == null && row.ad_spend_presale == null) continue;
    return row.date < requestedSince ? row.date : requestedSince;
  }
  return requestedSince;
}

function round2(n: number): number {
  // Two decimal places — matches numeric(12, 2) on the column.
  // Also keeps the diagnostic logs readable (without this, a
  // generic share of £561.60 shows up as 561.5999999999).
  return Math.round(n * 100) / 100;
}

function sanitiseSpend(spend: number | null | undefined): number {
  if (spend == null || !Number.isFinite(spend) || spend < 0) return 0;
  return spend;
}

function sumMap(values: Map<string, number>): number {
  let total = 0;
  for (const value of values.values()) total += value;
  return round2(total);
}

function isBristolEventCode(eventCode: string): boolean {
  return eventCode.toUpperCase().includes("BRISTOL");
}
