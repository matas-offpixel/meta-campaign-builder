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

/**
 * Why a campaign is in (or out of) this event's list.
 *
 * The four `CampaignClaimReason`s answer "whose code does this name
 * carry". These three answer the question that used to have no answer at
 * all: what to do when Meta's insights edge says nothing about a campaign
 * we already hold.
 *
 *   coded_no_delivery      a campaign object carrying this event's
 *                          `[CODE]` that has no rows in the window. It is
 *                          ours; it simply has not spent lately.
 *   retained_no_delivery   a stored id with no rows in the window whose
 *                          name still does not belong to another event.
 *                          Kept, and said out loud.
 *   retained_read_failed   the name read itself failed. Kept, because a
 *                          failed read is not evidence of anything.
 */
export type CampaignDecisionReason =
  | CampaignClaimReason
  | "coded_no_delivery"
  | "retained_no_delivery"
  | "retained_read_failed";

export interface CampaignClaimDecision {
  campaignId: string;
  campaignName: string;
  adAccountId: string;
  reason: CampaignDecisionReason;
  /** True when the stored hint did not already name this campaign. */
  added: boolean;
  movedTo?: string;
  /** For a retained-without-delivery id: what its name says it is. */
  claim?: CampaignClaimReason;
  /** For `retained_read_failed`: why the name read failed. */
  readError?: string;
}

/** Campaign objects carrying an event's `[CODE]`, delivery or not. */
export type CodedCampaignsResult =
  | { ok: true; campaigns: { id: string; name: string }[] }
  | { ok: false; error: { message: string } };

/** One campaign's current name — classification evidence, not spend. */
export type CampaignNameResult =
  | { ok: true; name: string }
  | { ok: false; error: { message: string } };

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
  /**
   * Campaign objects matching this event's `[CODE]` — the campaigns edge,
   * not insights, so a campaign that has not spent inside the window is
   * still found. This is what makes the list self-healing.
   */
  fetchCodedCampaigns: (args: {
    adAccountId: string;
    eventCode: string;
  }) => Promise<CodedCampaignsResult>;
  /**
   * One stored campaign's current name, for when insights is silent about
   * it. Required, not optional: falling back to "assume it left" is the
   * defect this argument exists to remove.
   */
  fetchCampaignName: (args: { campaignId: string }) => Promise<CampaignNameResult>;
}

export async function fetchEventDailyMetaMetricsUnion(
  args: DailyMetaUnionArgs,
): Promise<DailyMetaUnionResult> {
  const stored = new Set(args.storedCampaignIds.filter(Boolean));
  const rows: DailyMetaMetricsRow[] = [];
  const names = new Set<string>();
  const included = new Set<string>();
  const decisions: CampaignClaimDecision[] = [];
  const accountErrors: { adAccountId: string; message: string }[] = [];

  // Pass 0 — enumerate the campaign OBJECTS carrying this event's [CODE].
  //
  // Insights only answers for campaigns that delivered inside the window,
  // so discovering by insights alone makes a 60-day silence look like a
  // campaign that no longer exists. Modern Funktion's two lead-gen
  // campaigns (£596.96 and £370.30, last spend 5 Aug) fell out of the
  // stored list that way on 14 Oct. The campaigns edge is the same name
  // rule applied to objects, so it finds them whether they spent or not —
  // and brings them back on the next run without anyone typing an id.
  const codedFirstSeenIn = new Map<string, string>();
  // Pass 0 reads id and name together, so unlike the insights path it can
  // always name what it claims — the claim log is the audit trail for
  // which event owns what, so an empty name there is a real loss.
  const nameById = new Map<string, string>();
  for (const adAccountId of args.adAccountIds) {
    const res = await args.fetchCodedCampaigns({ adAccountId, eventCode: args.eventCode });
    if (!res.ok) {
      // Treated exactly like a failed insights read: without a complete
      // enumeration we must not be allowed to shrink the stored list.
      accountErrors.push({ adAccountId, message: res.error.message });
      continue;
    }
    for (const campaign of res.campaigns) {
      included.add(campaign.id);
      names.add(campaign.name);
      if (!codedFirstSeenIn.has(campaign.id)) {
        codedFirstSeenIn.set(campaign.id, adAccountId);
      }
      if (campaign.name) nameById.set(campaign.id, campaign.name);
    }
  }

  // Pass 1 — the daily numbers, every account. Also discovers by name, so
  // a coded campaign still joins the event if Pass 0's account read failed.
  const delivered = new Set<string>();
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
    // `campaignIds` and `campaignNames` are built from separate Sets by
    // the fetcher, so their order does NOT correspond. Pairing them by
    // index logged the wrong (or an empty) name — a cosmetic bug, but the
    // claim log is the audit trail for which event owns what, so it has
    // to be right. Carry the name only where the fetcher gives one id.
    const soleName = res.campaignIds.length === 1 ? res.campaignNames[0] ?? "" : "";
    res.campaignIds.forEach((id) => {
      delivered.add(id);
      included.add(id);
      if (soleName && !nameById.has(id)) nameById.set(id, soleName);
      if (!codedFirstSeenIn.has(id)) codedFirstSeenIn.set(id, adAccountId);
    });
  }

  // One line per coded campaign, delivery or not.
  for (const [campaignId, adAccountId] of codedFirstSeenIn) {
    decisions.push({
      campaignId,
      campaignName: nameById.get(campaignId) ?? "",
      adAccountId,
      reason: delivered.has(campaignId) ? "coded" : "coded_no_delivery",
      added: !stored.has(campaignId),
    });
  }

  // Pass 2 — stored ids neither pass claimed: an uncoded campaign, one
  // renamed into another event, or one in an account that failed to read.
  for (const campaignId of stored) {
    if (included.has(campaignId)) continue;

    // Insights first: if it delivered, we want its days as well as its name.
    let classified = false;
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
      classified = true;
      break;
    }
    if (classified) continue;

    // No insights row anywhere. That is an absence of evidence, not a
    // campaign disowning its code — so ask the campaign its name and
    // decide on that. It leaves this event only if the name says another
    // event now owns it.
    const nameRead = await args.fetchCampaignName({ campaignId });
    if (!nameRead.ok) {
      // A failed read is not evidence either. Keep it, and say so: the
      // id is only ever removed on a positive answer.
      included.add(campaignId);
      decisions.push({
        campaignId,
        campaignName: "",
        adAccountId: "",
        reason: "retained_read_failed",
        added: false,
        readError: nameRead.error.message,
      });
      continue;
    }
    const claim = classifyCampaignClaim(nameRead.name, args.eventCode, true);
    if (claim.include) {
      included.add(campaignId);
      names.add(nameRead.name);
    }
    decisions.push({
      campaignId,
      campaignName: nameRead.name,
      adAccountId: "",
      reason: claim.include ? "retained_no_delivery" : claim.reason,
      added: false,
      claim: claim.reason,
      ...(claim.movedTo ? { movedTo: claim.movedTo } : {}),
    });
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
  const claim = d.claim ? ` claim=${d.claim}` : "";
  const readError = d.readError ? ` read_error=${JSON.stringify(d.readError)}` : "";
  const acct = d.adAccountId ? ` acct=${d.adAccountId}` : "";
  return `[rollup-sync] claim ${eventCode} ${d.reason}${added} id=${d.campaignId}${acct} name=${JSON.stringify(d.campaignName)}${claim}${suffix}${readError}`;
}

export interface TodaySnapshotUnionArgs {
  eventCode: string;
  adAccountIds: string[];
  /** Campaigns this run claimed. Empty means "no filter", same as before. */
  claimedCampaignIds: string[];
  excludeCampaignIds?: string[];
  fetchToday: (args: {
    adAccountId: string;
    eventCode: string;
    knownCampaignIds?: string[];
    excludeCampaignIds?: string[];
  }) => Promise<DailyMetaMetricsResult>;
}

export interface TodaySnapshotUnionResult {
  /** Merged single day, or null when no account returned a row. */
  day: DailyMetaMetricsRow | null;
  accountErrors: { adAccountId: string; message: string }[];
  /** Accounts that answered with a row — for the "is zero plausible" check. */
  accountsWithRow: number;
}

/**
 * Today's row, summed across every account the client owns.
 *
 * The historical leg has scanned all accounts since #1062, but this one
 * still read a single account, so an event whose spend spans two of them
 * had a correct history and an under-counted today. Fever 105's sibling
 * campaigns are paused so the gap was £0 on the day, but it would bite any
 * live cross-account show — which is why this is the first thing fixed
 * after that PR rather than a later cleanup.
 */
export async function fetchEventTodayMetaSnapshotUnion(
  args: TodaySnapshotUnionArgs,
): Promise<TodaySnapshotUnionResult> {
  const rows: DailyMetaMetricsRow[] = [];
  const accountErrors: { adAccountId: string; message: string }[] = [];
  let accountsWithRow = 0;

  for (const adAccountId of args.adAccountIds) {
    const res = await args.fetchToday({
      adAccountId,
      eventCode: args.eventCode,
      ...(args.claimedCampaignIds.length > 0
        ? { knownCampaignIds: args.claimedCampaignIds }
        : {}),
      ...(args.excludeCampaignIds ? { excludeCampaignIds: args.excludeCampaignIds } : {}),
    });
    if (!res.ok) {
      accountErrors.push({ adAccountId, message: res.error.message });
      continue;
    }
    if (res.days.length > 0) {
      accountsWithRow += 1;
      rows.push(...res.days);
    }
  }

  const merged = mergeDailyRows(rows);
  return { day: merged[0] ?? null, accountErrors, accountsWithRow };
}
