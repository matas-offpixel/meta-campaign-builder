import { codesDisagree, isReplaceableEventCodePrefix } from "../campaign-event.ts";
import { parseBracketedEventCode } from "../insights/meta-event-code-match.ts";

import { accountDigits, venueDefaultsFromMap, venueKeyOf, venueMapRows } from "./venue-defaults.ts";

/**
 * R5, the nightly check (brief R5), as a pure function. For every campaign
 * that spent in the window: its name's `[CODE]`, the event its ad sets are
 * linked to, and the venue of its ad account must agree. Separately, every
 * Meta campaign id that two events claim (`events.meta_campaign_id`, a
 * comma list). DB facts in, rows out: no Meta call, no write. The alert
 * words come with the cron, once design rules on them.
 */

export interface LinkCheckEvent {
  id: string;
  code: string | null;
  clientId: string | null;
  venueKey: string | null;
  venueName: string | null;
  metaAdAccountId: string | null;
  /** `events.meta_campaign_id`, raw: one id or a comma list. */
  metaCampaignId: string | null;
}

export interface LinkCheckCampaign {
  campaignId: string;
  campaignName: string | null;
  adAccountId: string | null;
  spend: number;
  adSetIds: readonly string[];
}

export type LinkProblem =
  | "name_code_vs_linked_event"
  | "name_code_no_event"
  | "linked_to_two_events"
  | "account_not_event_venue";

export interface CampaignLinkRow {
  campaignId: string;
  campaignName: string | null;
  adAccountId: string | null;
  spend: number;
  nameCode: string | null;
  /** Event codes the ad sets are linked to (`launched_ad_sets.event_id`), else the event claiming the campaign id. */
  linkedEvents: string[];
  linkedVia: "ad_sets" | "meta_campaign_id" | "none";
  accountVenue: string | null;
  eventVenue: string | null;
  /** The account the event's venue (or the event's override) runs on. */
  rightAccount: string | null;
  problems: LinkProblem[];
}

export function splitCampaignIds(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id));
}

export interface DuplicateCampaignClaim {
  campaignId: string;
  /** Distinct event codes claiming the id (two or more). */
  eventCodes: string[];
  /** How many event rows claim it. */
  events: number;
}

/**
 * Campaign ids two shows claim. Events that share one code (a multi-fixture
 * show such as WC26-MANCHESTER, one event row per fixture) claiming the same
 * id are one show, so they are counted apart in `sameCode`, not flagged.
 */
export function duplicateCampaignClaims(events: readonly LinkCheckEvent[]): {
  claims: DuplicateCampaignClaim[];
  sameCode: number;
} {
  const byCampaign = new Map<string, LinkCheckEvent[]>();
  for (const event of events) {
    for (const id of new Set(splitCampaignIds(event.metaCampaignId))) {
      byCampaign.set(id, [...(byCampaign.get(id) ?? []), event]);
    }
  }
  const claims: DuplicateCampaignClaim[] = [];
  let sameCode = 0;
  for (const [campaignId, claimants] of byCampaign) {
    if (claimants.length < 2) continue;
    const codes = [...new Set(claimants.map((event) => (event.code ?? event.id).trim().toUpperCase()))].sort();
    if (codes.length > 1) claims.push({ campaignId, eventCodes: codes, events: claimants.length });
    else sameCode += 1;
  }
  claims.sort((a, b) => a.campaignId.localeCompare(b.campaignId));
  return { claims, sameCode };
}

export function checkCampaignLinks(input: {
  campaigns: readonly LinkCheckCampaign[];
  events: readonly LinkCheckEvent[];
  /** `launched_ad_sets.meta_adset_id` → `event_id`. */
  adSetEvent: ReadonlyMap<string, string>;
}): CampaignLinkRow[] {
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const eventByCode = new Map<string, LinkCheckEvent>();
  for (const event of input.events) {
    if (event.code) eventByCode.set(event.code.trim().toUpperCase(), event);
  }
  const claimedBy = new Map<string, LinkCheckEvent[]>();
  for (const event of input.events) {
    for (const id of splitCampaignIds(event.metaCampaignId)) {
      claimedBy.set(id, [...(claimedBy.get(id) ?? []), event]);
    }
  }
  const venueByAccount = new Map<string, string>();
  for (const venue of venueMapRows()) {
    if (venue.adAccountId) venueByAccount.set(venue.adAccountId, venue.name);
  }

  return input.campaigns.map((campaign) => {
    const prefix = campaign.campaignName ? parseBracketedEventCode(campaign.campaignName) : null;
    const nameCode = prefix && isReplaceableEventCodePrefix(prefix) ? prefix : null;
    const linkedIds = [
      ...new Set(campaign.adSetIds.map((id) => input.adSetEvent.get(id)).filter((id): id is string => Boolean(id))),
    ];
    let linked = linkedIds.map((id) => eventById.get(id)).filter((event): event is LinkCheckEvent => Boolean(event));
    let linkedVia: CampaignLinkRow["linkedVia"] = linked.length > 0 ? "ad_sets" : "none";
    if (linked.length === 0) {
      linked = claimedBy.get(campaign.campaignId) ?? [];
      if (linked.length > 0) linkedVia = "meta_campaign_id";
    }
    const account = accountDigits(campaign.adAccountId);
    const accountVenue = account ? venueByAccount.get(account) ?? null : null;
    const subject = linked[0] ?? (nameCode ? eventByCode.get(nameCode.toUpperCase()) : undefined) ?? null;
    const venue = subject
      ? venueDefaultsFromMap({
          id: subject.id,
          clientId: subject.clientId,
          venueKey: subject.venueKey,
          venueName: subject.venueName,
          metaAdAccountId: subject.metaAdAccountId,
        })
      : null;
    const rightAccount = venue ? venue.override.adAccountId ?? venue.eventVenue?.adAccountId ?? null : null;

    const problems: LinkProblem[] = [];
    if (nameCode && linked.length > 0 && linked.every((event) => codesDisagree(nameCode, event.code))) {
      problems.push("name_code_vs_linked_event");
    }
    if (nameCode && linked.length === 0 && !eventByCode.has(nameCode.toUpperCase())) {
      problems.push("name_code_no_event");
    }
    if (linked.length > 1) problems.push("linked_to_two_events");
    if (account && rightAccount && account !== rightAccount) problems.push("account_not_event_venue");

    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.campaignName,
      adAccountId: campaign.adAccountId,
      spend: campaign.spend,
      nameCode,
      linkedEvents: linked.map((event) => event.code ?? event.id),
      linkedVia,
      accountVenue,
      eventVenue: venue?.eventVenue?.name ?? (subject ? venueKeyOf(subject.venueKey ?? subject.venueName) : null),
      rightAccount,
      problems,
    };
  });
}
