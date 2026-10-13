/**
 * Union the campaigns an event owns across every ad account its client
 * owns, then merge their daily rows.
 *
 * Why this exists: `events.meta_campaign_id` was written once, on first
 * discovery, and never refreshed — `rollup-sync-runner.ts` guarded the
 * write with `if (!metaCampaignId …)` and the Meta leg used the stored
 * list as a `campaign.id` filter *instead of* re-discovering by name. So
 * every campaign created after an event's first cron tick was invisible
 * for the life of that event. Measured 13 Oct 2026: Folamour's rollup
 * held only its Signup campaign and missed £688.21 of on-sale spend; DJ EZ
 * showed £662.23 of a real £2,081.93.
 *
 * Two things this fixes at once:
 *
 *   1. Discovery runs EVERY tick, and the stored list is a hint to add to,
 *      never a replacement for it.
 *   2. Discovery runs across every ad account the client owns, not just
 *      the one the event resolves to. Fever 105's `[ES26-FEVER105]`
 *      campaigns are split across Sheffield (£1,346.86) and NX (£94.07);
 *      scanning one account can only ever see part of the show.
 *
 * Exclusivity is `classifyCampaignClaim` (meta-event-code-match.ts): a
 * campaign renamed into another event's code leaves this one rather than
 * being counted by both.
 *
 * Composition, not a rewrite: each per-account, per-id read goes through
 * the existing `fetchEventDailyMetaMetrics`, so the 380-line paging,
 * attribution and action-bucket logic is untouched and shared.
 */
import { classifyCampaignClaim, type CampaignClaimReason } from "./meta-event-code-match.ts";
import type { DailyMetaMetricsResult, DailyMetaMetricsRow } from "./types.ts";

export interface CampaignClaimDecision {
  campaignId: string;
  campaignName: string;
  adAccountId: string;
  reason: CampaignClaimReason;
  /** True when the stored hint did not already name this campaign. */
  added: boolean;
  movedTo?: string;
}

export interface DailyMetaUnionResult {
  ok: true;
  days: DailyMetaMetricsRow[];
  campaignNames: string[];
  campaignIds: string[];
  decisions: CampaignClaimDecision[];
  /** Per-account failures. A union succeeds on partial reads; the caller
   *  decides whether a missing account should block the write. */
  accountErrors: { adAccountId: string; message: string }[];
}

const NUMERIC_KEYS = [
  "spend", "presaleSpend", "linkClicks", "landingPageViews", "metaRegs",
  "metaPurchases", "metaLeads", "impressions", "reach", "videoPlays3s",
  "videoPlays15s", "videoPlaysP100", "engagements",
] as const;

/** Sum two days of the same date. Every numeric field adds; `day` is the key. */
export function mergeDailyRows(rows: DailyMetaMetricsRow[]): DailyMetaMetricsRow[] {
  const byDay = new Map<string, DailyMetaMetricsRow>();
  for (const row of rows) {
    const existing = byDay.get(row.day);
    if (!existing) {
      byDay.set(row.day, { ...row });
      continue;
    }
    for (const key of NUMERIC_KEYS) {
      existing[key] = (existing[key] ?? 0) + (row[key] ?? 0);
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export interface DailyMetaUnionArgs {
  eventCode: string;
  /** Every ad account the client owns, event's own account included. */
  adAccountIds: string[];
  /** `events.meta_campaign_id`, split and trimmed. The hint, not the truth. */
  storedCampaignIds: string[];
  excludeCampaignIds?: string[];
  /** Injected so this is testable without a Graph token. */
  fetchDaily: (args: {
    adAccountId: string;
    eventCode: string;
    knownCampaignIds?: string[];
    excludeCampaignIds?: string[];
  }) => Promise<DailyMetaMetricsResult>;
}

export async function fetchEventDailyMetaMetricsUnion(
  args: DailyMetaUnionArgs,
): Promise<DailyMetaUnionResult> {
  const stored = new Set(args.storedCampaignIds.filter(Boolean));
  const seen = new Set<string>();
  const rows: DailyMetaMetricsRow[] = [];
  const names = new Set<string>();
  const included = new Set<string>();
  const decisions: CampaignClaimDecision[] = [];
  const accountErrors: { adAccountId: string; message: string }[] = [];

  // Pass 1 — discovery by [CODE], every account.
  for (const adAccountId of args.adAccountIds) {
    const res = await args.fetchDaily({
      adAccountId,
      eventCode: args.eventCode,
      ...(args.excludeCampaignIds ? { excludeCampaignIds: args.excludeCampaignIds } : {}),
    });
    if (!res.ok) {
      accountErrors.push({ adAccountId, message: res.error.message });
      continue;
    }
    rows.push(...res.days);
    res.campaignNames.forEach((n) => names.add(n));
    res.campaignIds.forEach((id, index) => {
      seen.add(id);
      included.add(id);
      decisions.push({
        campaignId: id,
        campaignName: res.campaignNames[index] ?? "",
        adAccountId,
        reason: "coded",
        added: !stored.has(id),
      });
    });
  }

  // Pass 2 — stored IDs discovery did not return. One id at a time so a
  // single campaign can be classified (and dropped) on its own name.
  for (const campaignId of stored) {
    if (seen.has(campaignId)) continue;
    for (const adAccountId of args.adAccountIds) {
      const res = await args.fetchDaily({
        adAccountId,
        eventCode: args.eventCode,
        knownCampaignIds: [campaignId],
      });
      if (!res.ok || res.campaignIds.length === 0) continue;
      const campaignName = res.campaignNames[0] ?? "";
      const claim = classifyCampaignClaim(campaignName, args.eventCode, true);
      decisions.push({
        campaignId,
        campaignName,
        adAccountId,
        reason: claim.reason,
        added: false,
        ...(claim.movedTo ? { movedTo: claim.movedTo } : {}),
      });
      if (claim.include) {
        included.add(campaignId);
        names.add(campaignName);
        rows.push(...res.days);
      }
      seen.add(campaignId);
      break;
    }
  }

  return {
    ok: true,
    days: mergeDailyRows(rows),
    campaignNames: [...names],
    campaignIds: [...included],
    decisions,
    accountErrors,
  };
}

/** One line per decision, for the rollup-sync log. */
export function formatClaimDecision(eventCode: string, d: CampaignClaimDecision): string {
  const suffix = d.movedTo ? ` -> ${d.movedTo}` : "";
  const added = d.added ? " added" : "";
  return `[rollup-sync] claim ${eventCode} ${d.reason}${added} id=${d.campaignId} acct=${d.adAccountId} name=${JSON.stringify(d.campaignName)}${suffix}`;
}
