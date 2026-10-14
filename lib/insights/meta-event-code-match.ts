/**
 * Meta Graph `filtering` uses CONTAIN on a prefix of `[EVENT_CODE` (no
 * closing bracket) so suffix variants (Relaunch, en-dash titles, etc.)
 * still download. We then enforce the exact `[EVENT_CODE]` substring
 * client-side (case-sensitive code portion + dash normalisation).
 */

export function metaCampaignFilterPrefix(eventCode: string): string {
  return `[${eventCode.trim()}`;
}

/** First `[CODE]` in a campaign name — the prefix the matcher keys on. */
export function parseBracketedEventCode(campaignName: string): string | null {
  const match = campaignName.match(/\[([^\]]+)\]/);
  const inner = match?.[1]?.trim();
  return inner ? inner : null;
}

export function campaignMatchesBracketedEventCode(
  campaignName: string,
  eventCode: string,
): boolean {
  const needle = `[${eventCode.trim()}]`;
  return normalizeInsightDashes(campaignName).includes(
    normalizeInsightDashes(needle),
  );
}

function normalizeInsightDashes(s: string): string {
  return s.replace(/[\u2013\u2014\u2212]/g, "-");
}

/**
 * Which event may count a campaign's spend, when the rollup unions
 * name-discovered campaigns with the IDs persisted on
 * `events.meta_campaign_id`.
 *
 * The persisted list used to be the ONLY source — written once on first
 * discovery and never refreshed (`rollup-sync-runner.ts`'s
 * `if (!metaCampaignId …)`), so every campaign created after that first
 * cron tick was invisible for the life of the event. Folamour's rollup
 * froze at its Signup campaign and missed £688.21 of on-sale spend;
 * GDS missed £530.63 the same way. Union fixes that, but a union needs a
 * tie-break or a renamed campaign would be counted by two events at once:
 *
 *   coded            name carries THIS event's `[CODE]` — count it.
 *   moved            name carries a DIFFERENT `[CODE]` — the other event
 *                    owns it now. Drop it here even if our stored list
 *                    still names it, so a renamed campaign is never
 *                    double-counted. (Nine campaigns were hand-renamed on
 *                    13 Oct 2026 — `[NX25-DJ EZ]` → `[NX26-DJEZ]`,
 *                    `[NX26-ROBBIEDOHERTY[` → `]` — exactly this case.)
 *   uncoded_retained name carries no `[CODE]` at all. Keep it with the
 *                    event that already claimed it, and say so in the log
 *                    rather than dropping real spend silently.
 *   foreign          no code and never ours — not our spend.
 */
export type CampaignClaimReason =
  | "coded"
  | "moved"
  | "uncoded_retained"
  | "foreign";

export interface CampaignClaim {
  include: boolean;
  reason: CampaignClaimReason;
  /** The other event's code, when `reason` is "moved". */
  movedTo?: string;
}

export function classifyCampaignClaim(
  campaignName: string,
  eventCode: string,
  isStored: boolean,
): CampaignClaim {
  if (campaignMatchesBracketedEventCode(campaignName, eventCode)) {
    return { include: true, reason: "coded" };
  }
  const other = parseBracketedEventCode(campaignName);
  if (other) return { include: false, reason: "moved", movedTo: other };
  return isStored
    ? { include: true, reason: "uncoded_retained" }
    : { include: false, reason: "foreign" };
}
