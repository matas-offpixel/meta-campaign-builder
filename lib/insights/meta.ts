import "server-only";

import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import {
  graphGetWithToken,
  isReduceDataError,
  MetaApiError,
} from "@/lib/meta/client";

// Re-export the pure date helper from the canonical insights module
// so callers/tests that already import from this file keep working.
export { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type {
  CreativeRow,
  CreativeSortKey,
  CreativesPayload,
  CreativesResult,
  CustomDateRange,
  DailyMetaMetricsResult,
  DailyMetaMetricsRow,
  DailySpendRow,
  DatePreset,
  EventInsightsPayload,
  InsightsError,
  InsightsResult,
  MetaCampaignRow,
  MetaTotals,
  SpendByDayResult,
} from "@/lib/insights/types";

/**
 * lib/insights/meta.ts
 *
 * Read-side Meta Graph helpers for the public report (Slice U). Wraps
 * `graphGetWithToken` from the existing (read-only) lib/meta/client.ts —
 * we never modify the lib/meta surface, only consume it.
 *
 * Aggregation strategy
 *   Migration 009 set the contract: an event maps to its Meta campaigns by
 *   bracketed event_code in the campaign name (e.g. `[UTB0042-New]`).
 *   This file fetches all campaigns under the client's ad account, filters
 *   by name CONTAINS `[event_code]`, then pulls insights per matched
 *   campaign + per ad for the lazy creative load.
 *
 *   Why CONTAIN on name and not campaign_id join? Externally-created
 *   campaigns (built directly in Ads Manager, not via this app) carry no
 *   campaign_drafts row. Substring match catches both. False-positive risk
 *   is low — event_codes are unique-ish 6-8 char strings the agency
 *   controls.
 *
 * Caching
 *   This module performs no caching of its own. Callers (route handlers)
 *   set `export const revalidate = 300` so the entire payload is reused
 *   for 5 minutes per token.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CAMPAIGN_FETCH_LIMIT = 100;
const ADS_PER_CAMPAIGN_LIMIT = 25;

/**
 * Insights time window default. Meta's `date_preset=maximum` returns
 * lifetime numbers for the campaign — exactly what an event report wants
 * (campaigns are typically launched per-event, so "lifetime" == "for this
 * event"). Each fetch entrypoint accepts an optional `datePreset` for the
 * timeframe selector on the report.
 */
const DEFAULT_DATE_PRESET: DatePreset = "maximum";

/**
 * Attribution windows applied to every /insights call.
 *
 * Matches Meta Ads Manager's UI default ("7-day click + 1-day view")
 * exactly. Without this parameter the API can fall back to its
 * documentation default which differs from what an agency sees in
 * Ads Manager — leading to small but real discrepancies on
 * conversion-side numbers (purchases / regs / value).
 *
 * Locked to a constant rather than per-event configurable: every
 * client comparing the report to Ads Manager has the same expectation.
 *
 * https://developers.facebook.com/docs/marketing-api/insights/parameters
 */
const ATTRIBUTION_WINDOWS = JSON.stringify(["7d_click", "1d_view"]);

// ─── Public entrypoint: aggregate insights ─────────────────────────────────

export interface FetchEventInsightsArgs {
  /** Bracket-naked event code, e.g. "UTB0042". The matcher wraps it. */
  eventCode: string;
  /** "act_…" prefixed ad account id (the form Meta expects in URLs). */
  adAccountId: string;
  /** OAuth token of the event owner. */
  token: string;
  /**
   * Meta `date_preset` to query against. Defaults to "maximum"
   * (lifetime). Routes narrow the inbound `?datePreset=` query param
   * against `DATE_PRESETS` before passing it here, so this value is
   * always trusted.
   */
  datePreset?: DatePreset;
  /**
   * Required when `datePreset === "custom"`; ignored otherwise. Both
   * dates are validated by `validateCustomRange` before any Graph
   * call — invalid ranges return an `invalid_custom_range` error
   * result rather than silently falling back to a preset.
   */
  customRange?: CustomDateRange;
  /**
   * Optional resolver for the windowed `tickets_sold` rollup sum.
   * The caller (share page or internal route) supplies the closure
   * already bound to `eventId` + `supabase`, so this module stays
   * dep-free w.r.t. our DB layer. Errors are caught + downgraded
   * to `null` so a Supabase blip never fails the whole insights
   * fetch — the consumer falls back to the legacy mount-time
   * tickets number in that case.
   *
   * Signature mirrors `sumTicketsSoldInWindow`:
   *   - returns `null`  → no rollup data → consumer uses fallback.
   *   - returns `0`     → rollups exist, no tickets in window.
   *   - returns `> 0`   → windowed sum.
   */
  ticketsInWindowResolver?: (
    datePreset: DatePreset,
    customRange: CustomDateRange | undefined,
  ) => Promise<number | null>;
}

export async function fetchEventInsights(
  args: FetchEventInsightsArgs,
): Promise<InsightsResult> {
  const { eventCode, adAccountId, token } = args;
  const datePreset = args.datePreset ?? DEFAULT_DATE_PRESET;
  if (!eventCode.trim()) {
    return errorResult("no_event_code", "Event has no event_code set.");
  }
  if (!adAccountId.trim()) {
    return errorResult(
      "no_ad_account",
      "Client has no Meta ad account linked.",
    );
  }

  const rangeValidation = resolveCustomRange(datePreset, args.customRange);
  if (!rangeValidation.ok) return rangeValidation;
  const customRange = rangeValidation.range;

  try {
    const matchedCampaigns = await listCampaignsForEvent({
      adAccountId: ensureActPrefix(adAccountId),
      eventCode,
      token,
    });

    if (matchedCampaigns.length === 0) {
      return errorResult(
        "no_campaigns_matched",
        `No Meta campaigns found whose name contains [${eventCode}].`,
      );
    }

    const campaignRows = await Promise.all(
      matchedCampaigns.map((c) =>
        fetchCampaignInsights({
          campaignId: c.id,
          token,
          datePreset,
          customRange,
        }).then((insights) => mapCampaignRow(c, insights)),
      ),
    );

    const filteredRows = campaignRows
      .filter((r): r is MetaCampaignRow => r != null)
      .sort((a, b) => b.spend - a.spend);

    const totals = aggregateTotals(filteredRows);

    let ticketsSoldInWindow: number | null = null;
    if (args.ticketsInWindowResolver) {
      try {
        ticketsSoldInWindow = await args.ticketsInWindowResolver(
          datePreset,
          customRange,
        );
      } catch (resolverErr) {
        // Never fail the whole report on a rollup-sum hiccup —
        // log + fall back to `null` so the consumer renders the
        // legacy mount-time tickets number.
        console.warn(
          "[insights] ticketsInWindowResolver threw; falling back to null",
          resolverErr,
        );
        ticketsSoldInWindow = null;
      }
    }

    const payload: EventInsightsPayload = {
      fetchedAt: new Date().toISOString(),
      datePreset,
      ...(customRange ? { customRange } : {}),
      totals,
      totalSpend: totals.spend,
      channelBreakdown: {
        meta: totals.spend,
        tiktok: null,
        google: null,
      },
      campaigns: filteredRows,
      matchedCampaignCount: filteredRows.length,
      ticketsSoldInWindow,
    };
    return { ok: true, data: payload };
  } catch (err) {
    return handleMetaError(err);
  }
}

// ─── Campaign listing ──────────────────────────────────────────────────────

interface RawCampaign {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
}

interface GraphPaged<T> {
  data: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/**
 * Fetch every campaign under an ad account whose name contains the
 * bracket-wrapped event code. Pages through Graph until all matches are
 * collected; capped at CAMPAIGN_FETCH_LIMIT pages defensively.
 */
async function listCampaignsForEvent(args: {
  adAccountId: string;
  eventCode: string;
  token: string;
}): Promise<RawCampaign[]> {
  const { adAccountId, eventCode, token } = args;
  const needle = `[${eventCode}]`;
  const fields = "id,name,status,effective_status";

  // Use Meta's server-side filter so we don't drag every campaign back.
  // CONTAIN is case-sensitive on Meta's side; event codes are stored
  // upper-case by convention so this is fine.
  const filtering = JSON.stringify([
    { field: "name", operator: "CONTAIN", value: needle },
  ]);

  const matched: RawCampaign[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params: Record<string, string> = {
      fields,
      filtering,
      limit: String(CAMPAIGN_FETCH_LIMIT),
    };
    if (after) params.after = after;

    const res = await graphGetWithToken<GraphPaged<RawCampaign>>(
      `/${adAccountId}/campaigns`,
      params,
      token,
    );
    matched.push(...(res.data ?? []));
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }
  return matched;
}

// ─── Insights per campaign ────────────────────────────────────────────────

interface ActionRow {
  action_type: string;
  value: string;
}

interface RawInsights {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  frequency?: string;
  cpm?: string;
  actions?: ActionRow[];
  action_values?: ActionRow[];
}

const INSIGHTS_FIELDS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "frequency",
  "cpm",
  "actions",
  "action_values",
].join(",");

/**
 * Build the time-window param object passed to a Meta /insights call.
 * Always exactly one of `date_preset` / `time_range` is set, plus the
 * shared attribution windows. Centralised so campaign + ad endpoints
 * stay in sync.
 *
 * Exported (rather than file-private) because
 * `lib/reporting/active-creatives-fetch.ts` reuses this exact shape
 * for the per-campaign /{campaignId}/insights call after PR #47
 * decoupled creative insights from the /{campaignId}/ads nested
 * fetch. Keeping the time-param logic single-sourced means a future
 * preset addition flows through both paths without divergence.
 */
export function buildTimeParams(
  datePreset: DatePreset,
  customRange: CustomDateRange | undefined,
): Record<string, string> {
  if (datePreset === "custom" && customRange) {
    return {
      time_range: JSON.stringify({
        since: customRange.since,
        until: customRange.until,
      }),
      action_attribution_windows: ATTRIBUTION_WINDOWS,
    };
  }
  return {
    date_preset: datePreset,
    action_attribution_windows: ATTRIBUTION_WINDOWS,
  };
}

async function fetchCampaignInsights(args: {
  campaignId: string;
  token: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
}): Promise<RawInsights | null> {
  const { campaignId, token, datePreset, customRange } = args;
  try {
    const res = await graphGetWithToken<GraphPaged<RawInsights>>(
      `/${campaignId}/insights`,
      {
        fields: INSIGHTS_FIELDS,
        level: "campaign",
        ...buildTimeParams(datePreset, customRange),
      },
      token,
    );
    return res.data?.[0] ?? null;
  } catch (err) {
    // TEMP diagnostic — remove once PR #43 chunked fallback confirmed firing.
    // Surfaces the exact error shape so we can verify isReduceDataError is
    // matching against fields that actually exist on the production payload.
    logRawErrorShape("campaign", campaignId, err);
    if (isReduceDataError(err)) {
      console.warn(
        `[insights/meta] reduce-data fallback firing for campaign=${campaignId} preset=${datePreset}`,
      );
      return fetchInsightsChunked({
        path: `/${campaignId}/insights`,
        level: "campaign",
        token,
        datePreset,
        customRange,
      });
    }
    throw err;
  }
}

/**
 * TEMP diagnostic helper — remove once PR #43 chunked fallback
 * confirmed firing in production logs. Exists so the next
 * production trip reveals the exact error shape if the classifier
 * still misses (e.g. Meta ships yet another wrapping).
 *
 * Single console.error call so a future grep for the marker phrase
 * cleans up cleanly.
 */
function logRawErrorShape(scope: string, id: string, err: unknown): void {
  console.error(
    `[insights/meta] raw error shape (${scope}=${id})`,
    JSON.stringify({
      name: err instanceof Error ? err.name : typeof err,
      ctor: (err as { constructor?: { name?: string } })?.constructor?.name,
      code: (err as { code?: unknown })?.code,
      subcode: (err as { subcode?: unknown })?.subcode,
      message: err instanceof Error ? err.message : String(err),
      userMsg: (err as { userMsg?: unknown })?.userMsg,
      rawErrorData: (err as { rawErrorData?: unknown })?.rawErrorData,
    }),
  );
}

// ─── Day-chunked fallback ──────────────────────────────────────────────────
//
// Meta's per-account compute cap on /insights kicks in on
// `date_preset=last_7d` (and wider) for accounts with deep ad
// trees + action-level breakdowns. The single-shot call returns
// "Please reduce the amount of data you're asking for". Retrying
// with a longer backoff doesn't help — the QUERY is the problem,
// not the upstream load.
//
// Workaround: split the requested window into per-day calls
// (`time_range={since:D, until:D}`) and aggregate locally. Each
// per-day call sits comfortably under the cap. Concurrency is
// capped at the same 3 we use elsewhere on Meta — leaves headroom
// for parallel calls (e.g. share page's active-creatives fan-out).
//
// Trade-off: a 7-day window becomes 7 sequential-ish calls, which
// adds ~6-10s to first-byte. We absorb it because the alternative
// is a "report unavailable" page.

const MAX_CHUNK_DAYS = 31;
const CHUNK_CONCURRENCY = 3;

interface FetchInsightsChunkedArgs {
  /** e.g. `/123456/insights` */
  path: string;
  level: "campaign" | "ad";
  token: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
}

/**
 * Per-day fan-out for a single Meta /insights endpoint, summed
 * back into a `RawInsights` row that downstream `mapCampaignRow`
 * / `mapCreativeRow` can consume unchanged.
 *
 * Returns null on:
 *   - "maximum" preset (which doesn't hit the cap for this data
 *     shape, so chunking would just slow it down for no benefit)
 *   - empty per-day result set
 *
 * Throws when the per-day fan-out itself fails for a non-cap
 * reason — caller wraps for `data_too_large` if the fallback also
 * trips the same error.
 */
async function fetchInsightsChunked(
  args: FetchInsightsChunkedArgs,
): Promise<RawInsights | null> {
  const { path, level, token, datePreset, customRange } = args;
  const days = resolvePresetToDays(datePreset, customRange);
  if (!days || days.length === 0) return null;
  // Defensive ceiling — last_30d should fan out to 30 calls; if a
  // future preset somehow blew past 31 we'd rather refuse than
  // open a 90-call storm.
  if (days.length > MAX_CHUNK_DAYS) {
    throw new MetaApiError(
      `Day-chunked fallback exceeded ${MAX_CHUNK_DAYS} days (got ${days.length}); narrow the timeframe.`,
    );
  }

  // Tiny semaphore to cap parallel fans-out at CHUNK_CONCURRENCY.
  // Same shape as `lib/reporting/active-creatives-fetch.ts` — kept
  // local so this module stays self-contained.
  const semaphore = createChunkSemaphore(CHUNK_CONCURRENCY);
  const perDay = await Promise.all(
    days.map((day) =>
      semaphore(async () => {
        const res = await graphGetWithToken<GraphPaged<RawInsights>>(
          path,
          {
            fields: INSIGHTS_FIELDS,
            level,
            time_range: JSON.stringify({ since: day, until: day }),
            action_attribution_windows: ATTRIBUTION_WINDOWS,
          },
          token,
        );
        return res.data?.[0] ?? null;
      }),
    ),
  );
  return aggregateRawInsights(perDay);
}

/**
 * Sum a list of per-day RawInsights rows back into one row matching
 * the shape Meta would have returned for the full window.
 *
 * Numerics: straight addition for spend / impressions / reach /
 * clicks / actions / action_values. Reach is summed across days
 * — same caveat as `MetaTotals.reachSum`: a unique user reached on
 * 3 different days counts 3 times. UI already labels this honestly
 * everywhere it matters.
 *
 * Frequency is recomputed at the end as `impressions / reach`,
 * mirroring the formula `aggregateTotals` uses (the consumer
 * doesn't trust per-row frequency anyway). CPM is dropped — none
 * of the downstream mappers read it.
 */
function aggregateRawInsights(
  rows: ReadonlyArray<RawInsights | null>,
): RawInsights | null {
  const valid = rows.filter((r): r is RawInsights => r != null);
  if (valid.length === 0) return null;

  let spend = 0;
  let impressions = 0;
  let reach = 0;
  let clicks = 0;
  const actionTotals = new Map<string, number>();
  const actionValueTotals = new Map<string, number>();

  for (const row of valid) {
    spend += parseNum(row.spend);
    impressions += parseNum(row.impressions);
    reach += parseNum(row.reach);
    clicks += parseNum(row.clicks);
    for (const a of row.actions ?? []) {
      const v = Number(a.value);
      if (!Number.isFinite(v)) continue;
      actionTotals.set(
        a.action_type,
        (actionTotals.get(a.action_type) ?? 0) + v,
      );
    }
    for (const a of row.action_values ?? []) {
      const v = Number(a.value);
      if (!Number.isFinite(v)) continue;
      actionValueTotals.set(
        a.action_type,
        (actionValueTotals.get(a.action_type) ?? 0) + v,
      );
    }
  }

  const frequency = reach > 0 ? impressions / reach : 0;

  return {
    spend: String(spend),
    impressions: String(impressions),
    reach: String(reach),
    clicks: String(clicks),
    frequency: String(frequency),
    // CPM is read by nothing downstream — emit a derived value so
    // the shape stays honest if a future caller starts consuming it.
    cpm: String(impressions > 0 ? spend / (impressions / 1000) : 0),
    actions: [...actionTotals.entries()].map(([action_type, value]) => ({
      action_type,
      value: String(value),
    })),
    action_values: [...actionValueTotals.entries()].map(
      ([action_type, value]) => ({
        action_type,
        value: String(value),
      }),
    ),
  };
}

function createChunkSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= limit || queue.length === 0) return;
    active += 1;
    const run = queue.shift()!;
    run();
  };
  return async function acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          active -= 1;
          next();
        }
      };
      queue.push(run);
      next();
    });
  };
}

// ─── Mapping ───────────────────────────────────────────────────────────────

/**
 * Map a Meta /insights row → our `MetaCampaignRow`.
 *
 * Action-type sets are deliberately narrowed to pixel-only events to
 * match Meta Ads Manager's default columns:
 *   - "Purchases" / "Purchases conversion value" both use
 *     `offsite_conversion.fb_pixel_purchase` ONLY. Meta's `purchase` and
 *     `omni_purchase` action types are roll-ups that ALREADY include
 *     the pixel rows (omni_* spans pixel + on-Meta + cross-surface),
 *     so summing all three reported 2–3× the real number on
 *     conversion campaigns. Pixel-only mirrors the Ads Manager UI.
 *   - "Leads" / Registrations: same story — `lead` is a roll-up that
 *     contains `offsite_conversion.fb_pixel_lead` plus Meta lead-form
 *     leads; summing both was double-counting.
 *   - "Clicks (all)" in Ads Manager is the raw `clicks` field, NOT
 *     `inline_link_clicks` (which is "Link clicks", a strict subset).
 *     Reading the inline_link_clicks fallback was undercounting clicks.
 *
 * If a future objective needs to surface non-pixel conversions
 * (e.g. Meta-hosted lead forms), add a new metric column rather than
 * adding the action type back here.
 */
function mapCampaignRow(
  campaign: RawCampaign,
  insights: RawInsights | null,
): MetaCampaignRow {
  const spend = parseNum(insights?.spend);
  const impressions = parseNum(insights?.impressions);
  const reach = parseNum(insights?.reach);
  const clicks = parseNum(insights?.clicks);
  const lpv = sumActions(insights?.actions, ["landing_page_view"]);
  const regs = sumActions(insights?.actions, [
    "offsite_conversion.fb_pixel_lead",
  ]);
  const purchases = sumActions(insights?.actions, [
    "offsite_conversion.fb_pixel_purchase",
  ]);
  const purchaseValue = sumActions(insights?.action_values, [
    "offsite_conversion.fb_pixel_purchase",
  ]);

  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.effective_status ?? campaign.status ?? "UNKNOWN",
    spend,
    impressions,
    reach,
    clicks,
    landingPageViews: lpv,
    registrations: regs,
    purchases,
    purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    cpr: regs > 0 ? spend / regs : 0,
    cplpv: lpv > 0 ? spend / lpv : 0,
  };
}

function aggregateTotals(rows: MetaCampaignRow[]): MetaTotals {
  const sum = rows.reduce(
    (acc, r) => {
      acc.spend += r.spend;
      acc.impressions += r.impressions;
      // Per-campaign `reach` is Meta's deduped reach for that single
      // campaign — correct at the row level. Summing across campaigns
      // inflates the total because users overlap. We label the result
      // `reachSum` (not `reach`) so callers can't mistake it for true
      // unique reach across the event.
      acc.reachSum += r.reach;
      acc.clicks += r.clicks;
      acc.lpv += r.landingPageViews;
      acc.regs += r.registrations;
      acc.purchases += r.purchases;
      acc.purchaseValue += r.purchaseValue;
      return acc;
    },
    {
      spend: 0,
      impressions: 0,
      reachSum: 0,
      clicks: 0,
      lpv: 0,
      regs: 0,
      purchases: 0,
      purchaseValue: 0,
    },
  );

  return {
    spend: sum.spend,
    impressions: sum.impressions,
    reachSum: sum.reachSum,
    clicks: sum.clicks,
    landingPageViews: sum.lpv,
    registrations: sum.regs,
    purchases: sum.purchases,
    purchaseValue: sum.purchaseValue,
    roas: sum.spend > 0 ? sum.purchaseValue / sum.spend : 0,
    cpm: sum.impressions > 0 ? sum.spend / (sum.impressions / 1000) : 0,
    // Frequency derived from reachSum is therefore UNDER-stated when
    // there's overlap between campaigns. JSDoc on `MetaTotals.frequency`
    // calls this out — UI surfaces it as a coarse signal only.
    frequency: sum.reachSum > 0 ? sum.impressions / sum.reachSum : 0,
    cpr: sum.regs > 0 ? sum.spend / sum.regs : 0,
    cplpv: sum.lpv > 0 ? sum.spend / sum.lpv : 0,
    cpp: sum.purchases > 0 ? sum.spend / sum.purchases : 0,
  };
}

// ─── Public entrypoint: creative performance ──────────────────────────────

export interface FetchEventCreativesArgs {
  eventCode: string;
  adAccountId: string;
  token: string;
  sortBy: CreativeSortKey;
  /**
   * Date preset for per-ad insights. Creative previews themselves are
   * not time-windowed (Meta's `/{creative}/previews` endpoint takes no
   * date arg) so this only narrows the numeric metrics.
   */
  datePreset?: DatePreset;
  /**
   * Required when `datePreset === "custom"`. Validated up front; an
   * invalid range returns a `CreativesResult` error rather than
   * silently widening the query.
   */
  customRange?: CustomDateRange;
}

export async function fetchEventCreatives(
  args: FetchEventCreativesArgs,
): Promise<CreativesResult> {
  const { eventCode, adAccountId, token, sortBy } = args;
  const datePreset = args.datePreset ?? DEFAULT_DATE_PRESET;
  if (!eventCode.trim()) {
    return errorResult("no_event_code", "Event has no event_code set.");
  }
  if (!adAccountId.trim()) {
    return errorResult(
      "no_ad_account",
      "Client has no Meta ad account linked.",
    );
  }

  const rangeValidation = resolveCustomRange(datePreset, args.customRange);
  if (!rangeValidation.ok) return rangeValidation;
  const customRange = rangeValidation.range;

  try {
    const campaigns = await listCampaignsForEvent({
      adAccountId: ensureActPrefix(adAccountId),
      eventCode,
      token,
    });
    if (campaigns.length === 0) {
      return errorResult(
        "no_campaigns_matched",
        `No Meta campaigns found whose name contains [${eventCode}].`,
      );
    }

    // For each campaign, list ads + insights, then resolve creative previews.
    const adRows: CreativeRow[] = [];
    for (const campaign of campaigns) {
      const ads = await listAdsForCampaign({
        campaignId: campaign.id,
        token,
      });
      for (const ad of ads) {
        try {
          const [insights, previews] = await Promise.all([
            fetchAdInsights({ adId: ad.id, token, datePreset, customRange }),
            fetchCreativePreviews({ creativeId: ad.creative?.id, token }),
          ]);
          adRows.push(mapCreativeRow(ad, campaign, insights, previews));
        } catch (err) {
          // Per-ad failure must not abort the whole creative pull — log
          // and skip so the public report still renders the working ones.
          console.warn(
            `[insights/meta] ad ${ad.id} (${ad.name}) failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    // Collapse same-named ads into a single card BEFORE sorting so the
    // "Top 5" filter on the UI side counts groups, not raw ads.
    const grouped = groupCreativesByName(adRows);
    const sorted = sortCreatives(grouped, sortBy);
    const payload: CreativesPayload = {
      fetchedAt: new Date().toISOString(),
      sortBy,
      rows: sorted,
    };
    return { ok: true, data: payload };
  } catch (err) {
    return handleMetaError(err);
  }
}

interface RawAd {
  id: string;
  name: string;
  status?: string;
  effective_status?: string;
  creative?: { id: string };
}

async function listAdsForCampaign(args: {
  campaignId: string;
  token: string;
}): Promise<RawAd[]> {
  const { campaignId, token } = args;
  const fields = "id,name,status,effective_status,creative{id}";
  const res = await graphGetWithToken<GraphPaged<RawAd>>(
    `/${campaignId}/ads`,
    {
      fields,
      limit: String(ADS_PER_CAMPAIGN_LIMIT),
      // Skip ARCHIVED + DELETED — they pollute the creative list with
      // long-dead variants.
      effective_status: JSON.stringify([
        "ACTIVE",
        "PAUSED",
        "PENDING_REVIEW",
        "PREAPPROVED",
        "DISAPPROVED",
        "CAMPAIGN_PAUSED",
        "ADSET_PAUSED",
      ]),
    },
    token,
  );
  return res.data ?? [];
}

async function fetchAdInsights(args: {
  adId: string;
  token: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
}): Promise<RawInsights | null> {
  const { adId, token, datePreset, customRange } = args;
  try {
    const res = await graphGetWithToken<GraphPaged<RawInsights>>(
      `/${adId}/insights`,
      {
        fields: INSIGHTS_FIELDS,
        level: "ad",
        ...buildTimeParams(datePreset, customRange),
      },
      token,
    );
    return res.data?.[0] ?? null;
  } catch (err) {
    // TEMP diagnostic — remove once PR #43 chunked fallback confirmed firing.
    logRawErrorShape("ad", adId, err);
    if (isReduceDataError(err)) {
      console.warn(
        `[insights/meta] reduce-data fallback firing for ad=${adId} preset=${datePreset}`,
      );
      return fetchInsightsChunked({
        path: `/${adId}/insights`,
        level: "ad",
        token,
        datePreset,
        customRange,
      });
    }
    throw err;
  }
}

interface RawPreview {
  body: string;
}

const PREVIEW_FORMATS = {
  facebookFeed: "DESKTOP_FEED_STANDARD",
  instagramFeed: "INSTAGRAM_STANDARD",
  instagramStory: "INSTAGRAM_STORY",
  instagramReels: "INSTAGRAM_REELS",
} as const;

async function fetchCreativePreviews(args: {
  creativeId: string | undefined;
  token: string;
}): Promise<CreativeRow["previews"]> {
  const empty: CreativeRow["previews"] = {
    facebookFeed: null,
    instagramFeed: null,
    instagramStory: null,
    instagramReels: null,
  };
  if (!args.creativeId) return empty;

  const out = { ...empty };
  await Promise.all(
    (Object.entries(PREVIEW_FORMATS) as Array<
      [keyof typeof PREVIEW_FORMATS, (typeof PREVIEW_FORMATS)[keyof typeof PREVIEW_FORMATS]]
    >).map(async ([key, adFormat]) => {
      try {
        const res = await graphGetWithToken<GraphPaged<RawPreview>>(
          `/${args.creativeId}/previews`,
          { ad_format: adFormat },
          args.token,
        );
        out[key] = res.data?.[0]?.body ?? null;
      } catch {
        // Some creatives don't have all four placement variants (e.g.
        // Reels-only creatives won't render a desktop feed preview).
        // Swallow per-format failures — null is the right empty state.
        out[key] = null;
      }
    }),
  );
  return out;
}

// Per-creative narrowing mirrors `mapCampaignRow` — see the dedupe
// rationale in the JSDoc above that function.
function mapCreativeRow(
  ad: RawAd,
  campaign: RawCampaign,
  insights: RawInsights | null,
  previews: CreativeRow["previews"],
): CreativeRow {
  const spend = parseNum(insights?.spend);
  const impressions = parseNum(insights?.impressions);
  const reach = parseNum(insights?.reach);
  const clicks = parseNum(insights?.clicks);
  const lpv = sumActions(insights?.actions, ["landing_page_view"]);
  const regs = sumActions(insights?.actions, [
    "offsite_conversion.fb_pixel_lead",
  ]);
  const purchases = sumActions(insights?.actions, [
    "offsite_conversion.fb_pixel_purchase",
  ]);
  const purchaseValue = sumActions(insights?.action_values, [
    "offsite_conversion.fb_pixel_purchase",
  ]);
  return {
    adId: ad.id,
    adName: ad.name,
    campaignName: campaign.name,
    // `effective_status` is the shipped one (e.g. ACTIVE / PAUSED /
    // CAMPAIGN_PAUSED). Fall back to plain `status` then UNKNOWN so the
    // "All active" filter on the UI side has something to compare.
    effectiveStatus: ad.effective_status ?? ad.status ?? "UNKNOWN",
    mergedCount: 1,
    adIds: [ad.id],
    campaignNames: [campaign.name],
    previews,
    spend,
    impressions,
    reach,
    clicks,
    landingPageViews: lpv,
    registrations: regs,
    purchases,
    purchaseValue,
    cplpv: lpv > 0 ? spend / lpv : 0,
    cpr: regs > 0 ? spend / regs : 0,
    cpp: purchases > 0 ? spend / purchases : 0,
  };
}

/**
 * Collapse rows that share an `adName` into a single card.
 *
 * Same-named creatives are extremely common — agency convention is to
 * reuse a single creative across every ad set in a campaign (and often
 * across multiple campaigns: awareness vs conversion variants of the
 * same event). Pre-grouping each row mapped 1:1 to a Meta ad, which
 * meant the report could render ten cards for what is, visually, one
 * creative. The group merges by ad name, sums numerics, and picks
 * the first non-null preview per placement.
 *
 * Cost-per metrics are recomputed from the SUMS — averaging the per-row
 * cost-per values would double-weight a low-spend dupe (e.g. one £5 ad
 * with £0.50 CPLPV and one £500 ad with £2 CPLPV would average to
 * £1.25, but the true blended is much closer to £2). Recomputing from
 * the totals always reflects spend-weighted cost.
 */
function groupCreativesByName(rows: CreativeRow[]): CreativeRow[] {
  const groups = new Map<string, CreativeRow>();
  for (const row of rows) {
    const existing = groups.get(row.adName);
    if (!existing) {
      // First occurrence — clone defensively so subsequent merges don't
      // mutate the caller's source row through shared references.
      groups.set(row.adName, {
        ...row,
        adIds: [...row.adIds],
        campaignNames: [...row.campaignNames],
        previews: { ...row.previews },
      });
      continue;
    }

    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.reach += row.reach;
    existing.clicks += row.clicks;
    existing.landingPageViews += row.landingPageViews;
    existing.registrations += row.registrations;
    existing.purchases += row.purchases;
    existing.purchaseValue += row.purchaseValue;
    existing.mergedCount += row.mergedCount;
    existing.adIds.push(...row.adIds);

    for (const name of row.campaignNames) {
      if (!existing.campaignNames.includes(name)) {
        existing.campaignNames.push(name);
      }
    }

    // First non-null preview per placement wins (encounter order). Same-
    // named creatives are visually identical by convention — picking
    // any one is fine, and "first non-null" gracefully handles
    // placement gaps (e.g. a Reels-only variant slotted in beside a
    // Feed-only one).
    for (const key of [
      "facebookFeed",
      "instagramFeed",
      "instagramStory",
      "instagramReels",
    ] as const) {
      if (existing.previews[key] == null) {
        existing.previews[key] = row.previews[key];
      }
    }

    // ACTIVE wins. Otherwise keep the first encountered status.
    if (row.effectiveStatus === "ACTIVE") {
      existing.effectiveStatus = "ACTIVE";
    }
  }

  // Recompute cost-per from the summed totals (see JSDoc above).
  return [...groups.values()].map((row) => ({
    ...row,
    cplpv: row.landingPageViews > 0 ? row.spend / row.landingPageViews : 0,
    cpr: row.registrations > 0 ? row.spend / row.registrations : 0,
    cpp: row.purchases > 0 ? row.spend / row.purchases : 0,
  }));
}

function sortCreatives(rows: CreativeRow[], by: CreativeSortKey): CreativeRow[] {
  const score = (r: CreativeRow): number => {
    switch (by) {
      case "lpv":
        return r.landingPageViews;
      case "registrations":
        return r.registrations;
      case "purchases":
        return r.purchases;
      case "spend":
        return r.spend;
      case "cplpv":
        // Cost-per metrics: lower is better, so invert. Zero → push to
        // the bottom (treat as "no data").
        return r.cplpv > 0 ? -r.cplpv : -Infinity;
      case "cpr":
        return r.cpr > 0 ? -r.cpr : -Infinity;
      case "cpp":
        return r.cpp > 0 ? -r.cpp : -Infinity;
    }
  };
  return [...rows].sort((a, b) => score(b) - score(a));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function sumActions(
  actions: ActionRow[] | undefined,
  matchTypes: string[],
): number {
  if (!actions?.length) return 0;
  const matchSet = new Set(matchTypes);
  let total = 0;
  for (const row of actions) {
    if (matchSet.has(row.action_type)) {
      const v = Number(row.value);
      if (Number.isFinite(v)) total += v;
    }
  }
  return total;
}

function ensureActPrefix(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

function errorResult(
  reason: InsightsError["reason"],
  message: string,
): { ok: false; error: InsightsError } {
  return { ok: false, error: { reason, message } };
}

// ─── Custom range validation ───────────────────────────────────────────────

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Meta enforces a 37-month retention window on insights. */
const META_RETENTION_DAYS = 37 * 31;

type CustomRangeResolution =
  | { ok: true; range: CustomDateRange | undefined }
  | { ok: false; error: InsightsError };

/**
 * Resolve the customRange for a fetch entrypoint.
 *
 * - Non-"custom" preset: returns `{ ok: true, range: undefined }` even if
 *   a customRange was supplied (it's ignored — preset wins).
 * - "custom" preset: validates both bounds; returns the range or a
 *   typed `invalid_custom_range` error.
 */
function resolveCustomRange(
  datePreset: DatePreset,
  range: CustomDateRange | undefined,
): CustomRangeResolution {
  if (datePreset !== "custom") return { ok: true, range: undefined };
  if (!range) {
    return {
      ok: false,
      error: {
        reason: "invalid_custom_range",
        message:
          "Custom timeframe selected but no date range was provided.",
      },
    };
  }

  const since = parseIsoDate(range.since);
  const until = parseIsoDate(range.until);
  if (!since || !until) {
    return {
      ok: false,
      error: {
        reason: "invalid_custom_range",
        message: "Both 'since' and 'until' must be YYYY-MM-DD dates.",
      },
    };
  }
  if (since > until) {
    return {
      ok: false,
      error: {
        reason: "invalid_custom_range",
        message: "'since' must be on or before 'until'.",
      },
    };
  }

  // Compare against today UTC at 00:00 so the "future end date" check
  // doesn't reject a same-day range due to clock drift between regions.
  const todayUtc = startOfTodayUtc();
  if (until.getTime() > todayUtc.getTime()) {
    return {
      ok: false,
      error: {
        reason: "invalid_custom_range",
        message: "'until' cannot be in the future.",
      },
    };
  }

  const minSince = new Date(todayUtc);
  minSince.setUTCDate(minSince.getUTCDate() - META_RETENTION_DAYS);
  if (since.getTime() < minSince.getTime()) {
    return {
      ok: false,
      error: {
        reason: "invalid_custom_range",
        message: "'since' is older than Meta's 37-month retention window.",
      },
    };
  }

  return { ok: true, range };
}

function parseIsoDate(raw: string): Date | null {
  if (typeof raw !== "string") return null;
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return null;
  const [, y, mo, d] = m;
  // UTC midnight — both bounds compare against `startOfTodayUtc` below.
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  // Round-trip guard against e.g. "2026-02-31" → Mar 3.
  if (
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() !== Number(mo) - 1 ||
    dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return dt;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// ─── Public entrypoint: per-day spend (V.3, plan internal) ─────────────────

export interface FetchEventSpendByDayArgs {
  /** Bracket-naked event code, e.g. "UTB0042". The matcher wraps it. */
  eventCode: string;
  /** "act_…" prefixed ad account id (the form Meta expects in URLs). */
  adAccountId: string;
  /** OAuth token of the event owner. */
  token: string;
  /** YYYY-MM-DD inclusive lower bound. */
  since: string;
  /** YYYY-MM-DD inclusive upper bound. */
  until: string;
}

/**
 * Per-day spend totals for every campaign whose name contains
 * `[eventCode]`, between `since` and `until` inclusive.
 *
 * Uses Meta's `time_increment=1` to get one row per day, plus
 * `level=campaign` so the matched campaigns are aggregated server-side
 * (we still re-sum locally because Meta returns one row PER (campaign,
 * day) and the plan tracker only cares about the (day) total). Mirrors
 * the bracket-wrap matching convention that `listCampaignsForEvent`
 * uses everywhere else — campaigns built directly in Ads Manager
 * (no campaign_drafts row) still get caught by the substring match.
 *
 * Distinct from `fetchEventInsights` (one row per campaign, lifetime
 * or preset window) and `fetchEventCreatives` (per-ad). Internal-only:
 * the plan tab consumes this for actual-vs-planned; the public share
 * report does not.
 */
export async function fetchEventSpendByDay(
  args: FetchEventSpendByDayArgs,
): Promise<SpendByDayResult> {
  const { eventCode, adAccountId, token, since, until } = args;
  if (!eventCode.trim()) {
    return errorResult("no_event_code", "Event has no event_code set.");
  }
  if (!adAccountId.trim()) {
    return errorResult(
      "no_ad_account",
      "Client has no Meta ad account linked.",
    );
  }

  // Reuse the same custom-range validator the report path uses, so
  // the plan endpoint rejects the same out-of-bounds windows
  // (since > until / future until / pre-retention since) with the
  // typed `invalid_custom_range` reason. Validation happens before
  // any Meta call to avoid spending a Graph hit on a bad request.
  const validation = resolveCustomRange("custom", { since, until });
  if (!validation.ok) return validation;

  const account = ensureActPrefix(adAccountId);
  const filtering = JSON.stringify([
    { field: "campaign.name", operator: "CONTAIN", value: `[${eventCode}]` },
  ]);
  const timeRange = JSON.stringify({ since, until });

  try {
    // Aggregate per-day spend across pages. Meta returns one row per
    // (campaign, day) at level=campaign + time_increment=1; we sum
    // by day so the caller gets a single number per calendar date.
    const totals = new Map<string, number>();

    let after: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const params: Record<string, string> = {
        fields: "spend,date_start",
        level: "campaign",
        time_increment: "1",
        time_range: timeRange,
        filtering,
        action_attribution_windows: ATTRIBUTION_WINDOWS,
        limit: "500",
      };
      if (after) params.after = after;

      const res = await graphGetWithToken<
        GraphPaged<{ spend?: string; date_start?: string }>
      >(`/${account}/insights`, params, token);

      for (const row of res.data ?? []) {
        const day = row.date_start;
        if (!day) continue;
        const spend = parseNum(row.spend);
        totals.set(day, (totals.get(day) ?? 0) + spend);
      }

      after = res.paging?.cursors?.after;
      if (!res.paging?.next || !after) break;
    }

    // Sort ascending so the consumer can zip against the plan's days
    // array in order without an extra Map lookup per day.
    const days: DailySpendRow[] = [...totals.entries()]
      .map(([day, spend]) => ({ day, spend }))
      .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    return { ok: true, days };
  } catch (err) {
    return handleMetaError(err);
  }
}

// ─── Daily spend + link clicks (daily-tracker table) ───────────────────────

export interface FetchEventDailyMetaMetricsArgs {
  /** Bracket-naked event code, e.g. "LEEDS26-FACUP". The matcher wraps it. */
  eventCode: string;
  /** "act_…" prefixed ad account id. */
  adAccountId: string;
  /** OAuth token of the event owner. */
  token: string;
  /** YYYY-MM-DD inclusive lower bound. */
  since: string;
  /** YYYY-MM-DD inclusive upper bound. */
  until: string;
}

/**
 * Per-day spend + inline link clicks for every campaign whose name
 * contains `[eventCode]`. Backs the <DailyTracker /> table on the
 * event detail Overview tab.
 *
 * Sibling to `fetchEventSpendByDay` — kept distinct so the marketing-
 * plan tab's existing call site doesn't have to grow a wider shape it
 * doesn't need. Both helpers share the same bracket-wrap matching
 * convention (`[event_code]` substring on `campaign.name`) so a
 * campaign that shows up in one tracker shows up in the other.
 *
 * Case sensitivity:
 *   Meta's `CONTAIN` filter operator is case-INsensitive at the API
 *   level. To prevent `[leeds26-facup-v2]` from leaking into a
 *   `LEEDS26-FACUP` event we ALSO add `campaign_name` to the
 *   requested fields and re-apply a case-sensitive `String.includes`
 *   check client-side before aggregating. The API filter still helps
 *   because it dramatically narrows the set of rows pulled down
 *   (~1 campaign vs. all campaigns in the account).
 *
 * Returns one row per calendar day in the [since, until] window that
 * had at least one matching-campaign row. Days with no Meta activity
 * are NOT padded — the upsert layer creates rollup rows for the
 * Eventbrite side independently.
 */
export async function fetchEventDailyMetaMetrics(
  args: FetchEventDailyMetaMetricsArgs,
): Promise<DailyMetaMetricsResult> {
  const { eventCode, adAccountId, token, since, until } = args;
  if (!eventCode.trim()) {
    return errorResult("no_event_code", "Event has no event_code set.");
  }
  if (!adAccountId.trim()) {
    return errorResult(
      "no_ad_account",
      "Client has no Meta ad account linked.",
    );
  }

  const validation = resolveCustomRange("custom", { since, until });
  if (!validation.ok) return validation;

  const account = ensureActPrefix(adAccountId);
  const codeBracketed = `[${eventCode}]`;
  const filtering = JSON.stringify([
    { field: "campaign.name", operator: "CONTAIN", value: codeBracketed },
  ]);
  const timeRange = JSON.stringify({ since, until });

  try {
    // Aggregate per-day across pages. Meta returns one row per
    // (campaign, day) at level=campaign + time_increment=1; we sum
    // by day so the caller gets a single number per calendar date.
    const totalsSpend = new Map<string, number>();
    const totalsClicks = new Map<string, number>();
    // Track which distinct campaigns survived the case-sensitive
    // post-filter — surfaced in the result for diagnostic logging
    // (rollup-sync prints these so we can confirm at a glance the
    // sync saw the same campaigns the live block sees).
    const matchedCampaigns = new Set<string>();

    let after: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const params: Record<string, string> = {
        // campaign_name comes back so we can re-filter case-sensitively
        // before aggregating (Meta's CONTAIN is case-INsensitive).
        fields: "spend,inline_link_clicks,date_start,campaign_name",
        level: "campaign",
        time_increment: "1",
        time_range: timeRange,
        filtering,
        action_attribution_windows: ATTRIBUTION_WINDOWS,
        limit: "500",
      };
      if (after) params.after = after;

      const res = await graphGetWithToken<
        GraphPaged<{
          spend?: string;
          inline_link_clicks?: string;
          date_start?: string;
          campaign_name?: string;
        }>
      >(`/${account}/insights`, params, token);

      for (const row of res.data ?? []) {
        const day = row.date_start;
        if (!day) continue;
        // Case-sensitive post-filter: Meta's CONTAIN matched
        // case-insensitively, but the spec requires exact-case
        // matching so `LEEDS26-FACUP-RT` matches and
        // `leeds26-facup-v2` doesn't. Plain `includes` does the
        // case-sensitive substring check we want.
        const name = row.campaign_name ?? "";
        if (!name.includes(codeBracketed)) continue;
        matchedCampaigns.add(name);
        totalsSpend.set(
          day,
          (totalsSpend.get(day) ?? 0) + parseNum(row.spend),
        );
        totalsClicks.set(
          day,
          (totalsClicks.get(day) ?? 0) + parseNum(row.inline_link_clicks),
        );
      }

      after = res.paging?.cursors?.after;
      if (!res.paging?.next || !after) break;
    }

    const days: DailyMetaMetricsRow[] = [...totalsSpend.keys()]
      .sort()
      .map((day) => ({
        day,
        spend: totalsSpend.get(day) ?? 0,
        linkClicks: totalsClicks.get(day) ?? 0,
      }));

    return {
      ok: true,
      days,
      campaignNames: [...matchedCampaigns].sort(),
    };
  } catch (err) {
    return handleMetaError(err);
  }
}

function handleMetaError(err: unknown): { ok: false; error: InsightsError } {
  // Reduce-data check first, BEFORE the generic MetaApiError branch:
  // a reduce-data error is a code 1 / 2 with a specific message, so
  // without the early branch it'd silently get classified as a
  // generic `meta_api_error` and the UI would auto-retry forever.
  // Reaching this point means the day-chunked fallback also failed
  // (or the preset wasn't chunkable) — genuinely terminal for this
  // query.
  if (isReduceDataError(err)) {
    console.error(
      "[insights/meta] reduce-data fallback also failed — surfacing as data_too_large",
    );
    return errorResult(
      "data_too_large",
      err instanceof Error ? err.message : "Meta data window too large.",
    );
  }
  if (err instanceof MetaApiError) {
    // OAuth token expired = code 190. Surface as a distinct reason so the
    // public page renders the "report temporarily unavailable" copy
    // without revealing the underlying Meta error to the visitor.
    if (err.code === 190) {
      return errorResult(
        "owner_token_expired",
        "Owner Facebook token expired or revoked.",
      );
    }
    console.error(
      `[insights/meta] Meta API error code=${err.code} msg=${err.message}`,
    );
    return errorResult("meta_api_error", err.message);
  }
  console.error("[insights/meta] unexpected error:", err);
  return errorResult(
    "meta_api_error",
    err instanceof Error ? err.message : "Unknown error",
  );
}
