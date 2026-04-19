import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import type {
  CreativeRow,
  CreativeSortKey,
  CreativesPayload,
  CreativesResult,
  DatePreset,
  EventInsightsPayload,
  InsightsError,
  InsightsResult,
  MetaCampaignRow,
  MetaTotals,
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
        fetchCampaignInsights({ campaignId: c.id, token, datePreset }).then(
          (insights) =>
            mapCampaignRow(c, insights),
        ),
      ),
    );

    const filteredRows = campaignRows
      .filter((r): r is MetaCampaignRow => r != null)
      .sort((a, b) => b.spend - a.spend);

    const totals = aggregateTotals(filteredRows);
    const payload: EventInsightsPayload = {
      fetchedAt: new Date().toISOString(),
      datePreset,
      totals,
      totalSpend: totals.spend,
      channelBreakdown: {
        meta: totals.spend,
        tiktok: null,
        google: null,
      },
      campaigns: filteredRows,
      matchedCampaignCount: filteredRows.length,
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
  inline_link_clicks?: string;
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
  "inline_link_clicks",
  "frequency",
  "cpm",
  "actions",
  "action_values",
].join(",");

async function fetchCampaignInsights(args: {
  campaignId: string;
  token: string;
  datePreset: DatePreset;
}): Promise<RawInsights | null> {
  const { campaignId, token, datePreset } = args;
  const res = await graphGetWithToken<GraphPaged<RawInsights>>(
    `/${campaignId}/insights`,
    {
      fields: INSIGHTS_FIELDS,
      date_preset: datePreset,
      level: "campaign",
    },
    token,
  );
  return res.data?.[0] ?? null;
}

// ─── Mapping ───────────────────────────────────────────────────────────────

function mapCampaignRow(
  campaign: RawCampaign,
  insights: RawInsights | null,
): MetaCampaignRow {
  const spend = parseNum(insights?.spend);
  const impressions = parseNum(insights?.impressions);
  const reach = parseNum(insights?.reach);
  const clicks = parseNum(insights?.inline_link_clicks ?? insights?.clicks);
  const lpv = sumActions(insights?.actions, ["landing_page_view"]);
  const regs = sumActions(insights?.actions, [
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
  ]);
  const purchases = sumActions(insights?.actions, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
  ]);
  const purchaseValue = sumActions(insights?.action_values, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
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
            fetchAdInsights({ adId: ad.id, token, datePreset }),
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
}): Promise<RawInsights | null> {
  const { adId, token, datePreset } = args;
  const res = await graphGetWithToken<GraphPaged<RawInsights>>(
    `/${adId}/insights`,
    {
      fields: INSIGHTS_FIELDS,
      date_preset: datePreset,
      level: "ad",
    },
    token,
  );
  return res.data?.[0] ?? null;
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

function mapCreativeRow(
  ad: RawAd,
  campaign: RawCampaign,
  insights: RawInsights | null,
  previews: CreativeRow["previews"],
): CreativeRow {
  const spend = parseNum(insights?.spend);
  const impressions = parseNum(insights?.impressions);
  const reach = parseNum(insights?.reach);
  const lpv = sumActions(insights?.actions, ["landing_page_view"]);
  const regs = sumActions(insights?.actions, [
    "lead",
    "offsite_conversion.fb_pixel_lead",
    "complete_registration",
    "offsite_conversion.fb_pixel_complete_registration",
  ]);
  const purchases = sumActions(insights?.actions, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
  ]);
  const purchaseValue = sumActions(insights?.action_values, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
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

function handleMetaError(err: unknown): { ok: false; error: InsightsError } {
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
