import type { AdContextIndex } from "../ad-facts.ts";
import { currencyResolver } from "../currency.ts";
import { buildTagIndex, joinAdDay, type AdDayRow, type CreativeTag, type JoinContext, type LearningClient, type LearningFact, type TagAssignment } from "../joins.ts";

export const NOW = new Date("2026-10-07T03:30:00.000Z");

export function adDay(overrides: Partial<AdDayRow> & { meta_ad_id: string }): AdDayRow {
  return {
    ad_account_id: "act_111",
    meta_adset_id: null,
    date: "2026-10-01",
    ad_name: null,
    campaign_name: null,
    spend: 0,
    impressions: 0,
    reach: 0,
    link_clicks: 0,
    landing_page_views: 0,
    video_plays_3s: 0,
    video_plays_p100: 0,
    registrations: 0,
    purchases: 0,
    ...overrides,
  };
}

export const CLIENTS: LearningClient[] = [
  { id: "client-a", name: "Client A", vertical: "music", userId: "op" },
  { id: "client-b", name: "Client B", vertical: "music", userId: "op" },
  { id: "client-f", name: "Client F", vertical: "football", userId: "op" },
];

export const TAGS = new Map<string, CreativeTag>([
  ["t-motion", { id: "t-motion", dimension: "asset_type", value_key: "motion", value_label: "Motion" }],
  ["t-still", { id: "t-still", dimension: "asset_type", value_key: "still", value_label: "Still" }],
]);

export function joinContext(overrides: Partial<JoinContext> & { assignments?: TagAssignment[] } = {}): JoinContext {
  const context: AdContextIndex = {
    launchedAds: new Map([["ad-launched", { clientId: "client-a", eventId: "event-a" }]]),
    launchedAdSets: new Map([["adset-b", { clientId: null, eventId: "event-b" }]]),
    codedEvents: [{ eventId: "event-c", clientId: "client-a", eventCode: "CODE-C", adAccountId: "act_111" }],
  };
  return {
    context,
    events: new Map([
      ["event-a", { clientId: "client-a", generalSaleAt: "2026-10-03T09:00:00Z", presaleAt: "2026-09-30T09:00:00Z" }],
      ["event-b", { clientId: "client-b", generalSaleAt: null, presaleAt: "2026-10-02T09:00:00Z" }],
      ["event-c", { clientId: "client-a", generalSaleAt: null, presaleAt: null }],
    ]),
    adSetPhase: new Map([["adset-phase", "on_sale"]]),
    tags: buildTagIndex(overrides.assignments ?? [], new Set(TAGS.keys())),
    currency: currencyResolver(new Map()),
    ...overrides,
  };
}

/** A fact whose client, stage and tags are set directly. */
export function fact(
  overrides: Partial<AdDayRow> & { meta_ad_id: string },
  meta: { clientId: string | null; eventId?: string | null; stage?: LearningFact["stage"]; tagIds?: string[]; spendGbp?: number },
): LearningFact {
  const row = adDay(overrides);
  const stage = meta.stage ?? "registration";
  return {
    row,
    clientId: meta.clientId,
    eventId: meta.eventId ?? null,
    contextSource: "launched_ads",
    stage,
    stageSource: stage === "unknown" ? "unknown" : "event_dates",
    result: stage === "registration" ? row.registrations : stage === "ticket_sale" ? row.purchases : null,
    spendGbp: meta.spendGbp ?? row.spend,
    tagIds: meta.tagIds ?? [],
    tagVia: meta.tagIds?.length ? "name" : null,
  };
}

export { joinAdDay };
