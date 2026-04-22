/**
 * lib/meta/creative-insights.ts
 *
 * Server-only Meta Graph API helper for the creative heatmap. Pulls every
 * ad under an ad account along with insights for a given date preset and
 * maps the wire shape into our internal CreativeInsightRow.
 *
 * Uses the existing graphGetWithToken helper from lib/meta/client.ts —
 * no new HTTP layer. Sequential paging is intentional: this fetcher
 * feeds the cache table behind /api/cron/refresh-creative-insights, so
 * the user-facing read path no longer waits on Meta. Optimising the
 * fetcher itself (parallel paging, GraphQL batching, etc.) is a
 * separate follow-up.
 */

import { graphGetWithToken } from "@/lib/meta/client";
import type {
  CreativeDatePreset,
  CreativeInsightRow,
} from "@/lib/types/intelligence";

interface RawAd {
  id: string;
  name: string;
  status?: string;
  campaign_id?: string;
  // Added in H1 — `campaign{name,objective}` field expansion.
  campaign?: {
    name?: string;
    objective?: string;
  };
  adset_id?: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
  };
  insights?: {
    data?: Array<{
      spend?: string;
      impressions?: string;
      clicks?: string;
      cpm?: string;
      cpc?: string;
      ctr?: string;
      frequency?: string;
      reach?: string;
      actions?: Array<{ action_type: string; value: string }>;
    }>;
  };
}

interface PagedResponse<T> {
  data: T[];
  paging?: { cursors?: { after: string }; next?: string };
}

interface FetchOptions {
  /**
   * Meta `date_preset` value. Defaults to `last_30d` (matches the
   * pre-H1 hardcoded behaviour).
   */
  datePreset?: CreativeDatePreset;
  /**
   * Reserved. The route currently accepts these for backwards-compat
   * with in-flight clients but does NOT translate them into Meta's
   * `time_range` parameter — that swap is a future change. Passed
   * through here purely so callers can keep their existing typing.
   */
  since?: string;
  until?: string;
  /** Optional list of campaign IDs to filter ads by. */
  campaignIds?: string[];
}

const DEFAULT_DATE_PRESET: CreativeDatePreset = "last_30d";

/**
 * Meta addresses ad accounts as `act_<numeric>`. The live UI reaches
 * us through `/api/intelligence/creatives` which 400s on missing
 * prefix, so callers down that path are always canonical. The cron
 * (and any future server-side caller that pulls IDs out of the
 * `clients` table) sees the raw numeric form persisted by the seed
 * scripts + the client form (no normalisation at write time). Without
 * this prefix Meta resolves `/<numeric>/ads` against the wrong node
 * type and returns "(#100) Tried accessing nonexisting field (ads)".
 * Belt-and-suspenders normalisation here keeps `fetchCreativeInsights`
 * safe for any caller; the data layer also normalises so cache rows
 * key consistently.
 */
function ensureActPrefix(adAccountId: string): string {
  const trimmed = adAccountId.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function num(v: string | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumAction(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
): number {
  if (!actions || actions.length === 0) return 0;
  let total = 0;
  for (const a of actions) {
    if (types.includes(a.action_type)) total += num(a.value);
  }
  return total;
}

function fatigueFromFrequency(freq: number): CreativeInsightRow["fatigueScore"] {
  if (!Number.isFinite(freq) || freq < 3) return "ok";
  if (freq <= 5) return "warning";
  return "critical";
}

/**
 * Registration-flavoured Meta action types. Different ad accounts
 * surface registrations under different action_type strings depending
 * on whether they're using lead-gen forms, pixel events, or off-Meta
 * conversions — summing the lot here means H3's `cpr` derivation
 * works consistently across them. If a Matas account turns out to
 * double-count, tune this list rather than adding a column.
 */
const REGISTRATION_ACTION_TYPES = [
  "complete_registration",
  "lead",
  "registration",
  "view_content",
  "offsite_conversion.fb_pixel_complete_registration",
  "offsite_conversion.fb_pixel_lead",
];

/**
 * Fetch every ad under the given ad account along with its insights for
 * `options.datePreset` (defaults to `last_30d`). Returns one
 * CreativeInsightRow per ad — empty array if Meta returns no rows or
 * the call fails (caller decides how to surface that to the UI).
 *
 * Uses Meta's nested insights expansion so we get one round-trip per
 * page rather than fetching ads then insights serially.
 */
export async function fetchCreativeInsights(
  adAccountId: string,
  accessToken: string,
  options: FetchOptions,
): Promise<CreativeInsightRow[]> {
  const datePreset = options.datePreset ?? DEFAULT_DATE_PRESET;
  const accountPath = ensureActPrefix(adAccountId);

  const fields = [
    "id",
    "name",
    "status",
    "campaign_id",
    // H1: pull campaign name + objective so the cache table is
    // self-sufficient and H3's objective filter doesn't need a
    // second join.
    "campaign{name,objective}",
    "adset_id",
    "creative{id,name,thumbnail_url}",
    `insights.date_preset(${datePreset}){spend,impressions,clicks,actions,cpm,cpc,ctr,frequency,reach}`,
  ].join(",");

  // Page size lowered from 100 → 50 because two production accounts
  // (act_901661116878308, act_210578427) returned Meta's "Please reduce
  // the amount of data" error on last_7d. The expensive piece of the
  // payload is the nested `insights{...,actions}` expansion — busy
  // accounts surface dozens of action_type rows per ad, so 100 ads ×
  // full insights × actions[] blows past Meta's per-response cap.
  // Halving the page size halves the response body and roughly doubles
  // the number of round-trips, which we already pay for via cursor
  // pagination. Same fields, same totals, just smaller pages.
  const params: Record<string, string> = { fields, limit: "50" };
  if (options.campaignIds?.length) {
    params.filtering = JSON.stringify([
      { field: "campaign.id", operator: "IN", value: options.campaignIds },
    ]);
  }

  const rows: CreativeInsightRow[] = [];
  let after: string | undefined;
  let safetyCounter = 0;

  do {
    if (after) params.after = after;
    const res = await graphGetWithToken<PagedResponse<RawAd>>(
      `/${accountPath}/ads`,
      params,
      accessToken,
    );

    for (const ad of res.data ?? []) {
      const insight = ad.insights?.data?.[0];
      const spend = num(insight?.spend);
      const impressions = num(insight?.impressions);
      const clicks = num(insight?.clicks);
      const ctr = num(insight?.ctr);
      const cpm = num(insight?.cpm);
      const cpc = num(insight?.cpc);
      const frequency = num(insight?.frequency);
      const reach = num(insight?.reach);
      const linkClicks = sumAction(insight?.actions, ["link_click"]);
      const purchases = sumAction(insight?.actions, [
        "omni_purchase",
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
      ]);
      const registrations = sumAction(
        insight?.actions,
        REGISTRATION_ACTION_TYPES,
      );
      const cpl = linkClicks > 0 ? Number((spend / linkClicks).toFixed(2)) : null;
      // H3: derive cpr at fetch time so the cache row + UI agree without
      // a second column on `creative_insight_snapshots`. Null when no
      // registrations so the lead-preset summary doesn't show £Infinity.
      const cpr =
        registrations > 0 ? Number((spend / registrations).toFixed(2)) : null;

      rows.push({
        adId: ad.id,
        adName: ad.name,
        status: ad.status ?? null,
        campaignId: ad.campaign_id ?? null,
        campaignName: ad.campaign?.name ?? null,
        campaignObjective: ad.campaign?.objective ?? null,
        adsetId: ad.adset_id ?? null,
        creativeId: ad.creative?.id ?? null,
        creativeName: ad.creative?.name ?? null,
        thumbnailUrl: ad.creative?.thumbnail_url ?? null,
        spend,
        impressions,
        clicks,
        ctr,
        cpm,
        cpc,
        frequency,
        reach,
        linkClicks,
        purchases,
        registrations,
        cpl,
        cpr,
        fatigueScore: fatigueFromFrequency(frequency),
        // Tags are merged in by the API route after fetching, so the Meta
        // client stays unaware of our local annotations table.
        tags: [],
      });
    }

    after = res.paging?.cursors?.after;
    safetyCounter += 1;
    // Cap stays at 2 000 ads regardless of page size — bumped from 20
    // to 40 to compensate for the page-size halving above (40 × 50 =
    // 2 000). More than that points at a runaway loop, bail rather
    // than hang the request.
    if (safetyCounter >= 40) break;
  } while (after);

  return rows;
}
