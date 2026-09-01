/**
 * Observer for the silent [CODE] miss class (FOLMAOUR / FOLAMOUR).
 *
 * The rollup matcher is event-centric: it starts from an event_code and
 * CONTAINs `[event_code]` on campaign names. A campaign whose parsed
 * prefix matches no event is dropped with no named state. This module
 * inverts that check (campaign → events) and proposes Slack + UI only.
 * It does not change attribution.
 */

import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";
import {
  campaignMatchesBracketedEventCode,
  parseBracketedEventCode,
} from "./meta-event-code-match.ts";

/** Same statuses the rollup-sync code-match eligibility uses. */
export const UNMATCHED_ACTIVE_EVENT_STATUSES = ["on_sale", "live", "upcoming"] as const;

/** Major units (GBP) in the insights window. Below this, test spend stays silent. */
export const UNMATCHED_CAMPAIGN_SPEND_FLOOR_MAJOR = 25;

/** Meta `date_preset` for the spend window. */
export const UNMATCHED_CAMPAIGN_SPEND_PRESET = "last_7d";

export const UNMATCHED_CAMPAIGN_SNAPSHOT_KEY = "unmatched_campaigns:last_scan";

export function unmatchedCampaignDedupeKey(campaignId: string, code: string): string {
  return `unmatched_campaign:${campaignId}:${code}`;
}

export function isActiveEventStatus(status: string | null | undefined): boolean {
  const normalised = (status ?? "").trim().toLowerCase();
  return (UNMATCHED_ACTIVE_EVENT_STATUSES as readonly string[]).includes(normalised);
}

export interface EventCodeCatalogRow {
  eventCode: string;
  status: string | null;
}

export interface CampaignSpendRow {
  campaignId: string;
  campaignName: string;
  adAccountId: string;
  spendMajor: number;
}

export interface UnmatchedCampaignFinding {
  campaignId: string;
  campaignName: string;
  parsedCode: string;
  adAccountId: string;
  spendMajor: number;
  nearestEventCodes: string[];
}

export function levenshtein(a: string, b: string): number {
  const left = a.toUpperCase();
  const right = b.toUpperCase();
  const rows = left.length + 1;
  const cols = right.length + 1;
  const grid: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) grid[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      grid[i]![j] = Math.min(
        grid[i - 1]![j]! + 1,
        grid[i]![j - 1]! + 1,
        grid[i - 1]![j - 1]! + cost,
      );
    }
  }
  return grid[left.length]![right.length]!;
}

export function nearestEventCodes(
  parsedCode: string,
  catalog: readonly EventCodeCatalogRow[],
  limit = 3,
): string[] {
  const unique = [...new Set(catalog.map((row) => row.eventCode.trim()).filter(Boolean))];
  return unique
    .map((code) => ({ code, distance: levenshtein(parsedCode, code) }))
    .filter((row) => row.code.toUpperCase() !== parsedCode.toUpperCase())
    .sort((a, b) => a.distance - b.distance || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((row) => row.code);
}

export function campaignMatchesActiveEvent(
  campaignName: string,
  catalog: readonly EventCodeCatalogRow[],
): boolean {
  return catalog.some(
    (row) =>
      isActiveEventStatus(row.status) &&
      campaignMatchesBracketedEventCode(campaignName, row.eventCode),
  );
}

export function evaluateUnmatchedCampaigns(
  campaigns: readonly CampaignSpendRow[],
  catalog: readonly EventCodeCatalogRow[],
  spendFloorMajor = UNMATCHED_CAMPAIGN_SPEND_FLOOR_MAJOR,
): UnmatchedCampaignFinding[] {
  const findings: UnmatchedCampaignFinding[] = [];
  for (const campaign of campaigns) {
    const parsedCode = parseBracketedEventCode(campaign.campaignName);
    if (!parsedCode) continue;
    if (!(campaign.spendMajor > 0)) continue;
    if (campaign.spendMajor < spendFloorMajor) continue;
    if (campaignMatchesActiveEvent(campaign.campaignName, catalog)) continue;
    findings.push({
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      parsedCode,
      adAccountId: campaign.adAccountId,
      spendMajor: campaign.spendMajor,
      nearestEventCodes: nearestEventCodes(parsedCode, catalog),
    });
  }
  return findings;
}

export function unmatchedCampaignAlarmText(finding: UnmatchedCampaignFinding): string {
  const nearest =
    finding.nearestEventCodes.length > 0
      ? ` Nearest event codes: ${finding.nearestEventCodes.join(", ")} (hint only — do not auto-rename).`
      : "";
  return (
    `Unmatched Meta campaign: "${finding.campaignName}" ` +
    `parsed [${finding.parsedCode}] matches no active event. ` +
    `Ad account ${finding.adAccountId}. ` +
    `Spend in ${UNMATCHED_CAMPAIGN_SPEND_PRESET}: £${finding.spendMajor.toFixed(2)} ` +
    `is contributing to nothing.` +
    nearest
  );
}

export async function notifyUnmatchedCampaigns(
  findings: readonly UnmatchedCampaignFinding[],
  notify: (opts: NotifyOptions) => Promise<NotifyResult>,
): Promise<{ alarmed: number; sent: number }> {
  let sent = 0;
  for (const finding of findings) {
    const result = await notify({
      channel: "ads_ops",
      text: unmatchedCampaignAlarmText(finding),
      dedupeKey: unmatchedCampaignDedupeKey(finding.campaignId, finding.parsedCode),
      respectBusinessHours: false,
    });
    if (result.sent) sent += 1;
  }
  return { alarmed: findings.length, sent };
}
