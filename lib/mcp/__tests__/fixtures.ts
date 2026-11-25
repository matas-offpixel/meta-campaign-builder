/** Fixture tables for the MCP tool tests. Codes and counts only; no person data. */
import { fakeDb } from "./fake-db.ts";
import type { McpReaders, ToolContext } from "../tool-types.ts";

export const TODAY = "2026-11-24";
export const NOW = new Date("2026-11-24T09:00:00Z");
export const CLIENT_NX = "c0000000-0000-4000-8000-000000000001";
export const CLIENT_OLD = "c0000000-0000-4000-8000-000000000002";
export const EV_DOD = "e0000000-0000-4000-8000-000000000001";
export const EV_PAST = "e0000000-0000-4000-8000-000000000002";
export const EV_ARCH = "e0000000-0000-4000-8000-000000000003";
export const EV_SOON = "e0000000-0000-4000-8000-000000000004";
export const DRAFT_1 = "d0000000-0000-4000-8000-000000000001";

const ev = (over: Record<string, unknown>) => ({
  name: "Show",
  venue_name: "Venue",
  venue_city: "Newcastle",
  status: "on_sale",
  meta_campaign_id: null,
  cirqlin_page_id: null,
  announcement_at: null,
  presale_at: null,
  general_sale_at: null,
  ...over,
});

export function tables() {
  return {
    clients: [
      { id: CLIENT_NX, name: "NX Live", status: "active" },
      { id: CLIENT_OLD, name: "Old Promoter", status: "archived" },
    ],
    events: [
      ev({
        id: EV_DOD,
        event_code: "NX26-DOD",
        name: "D.O.D",
        client_id: CLIENT_NX,
        client: { name: "NX Live" },
        event_date: "2026-12-20",
        announcement_at: "2026-10-01T17:00:00Z",
        presale_at: "2026-10-08T09:00:00Z",
        general_sale_at: "2026-10-10T09:00:00Z",
        meta_campaign_id: "120001, 120002",
        cirqlin_page_id: "p0000000-0000-4000-8000-000000000001",
      }),
      ev({ id: EV_PAST, event_code: "NX25-OLD", client_id: CLIENT_NX, client: { name: "NX Live" }, event_date: "2025-12-01" }),
      ev({ id: EV_ARCH, event_code: "OLD26-X", client_id: CLIENT_OLD, client: { name: "Old Promoter" }, event_date: "2026-12-30" }),
      ev({
        id: EV_SOON,
        event_code: "NX26-SOON",
        name: "Soon",
        client_id: CLIENT_NX,
        client: { name: "NX Live" },
        event_date: "2027-02-01",
        status: "upcoming",
        announcement_at: "2026-11-25T17:00:00Z",
      }),
    ],
    event_daily_rollups: [
      { event_id: EV_DOD, date: "2026-11-23", ad_spend: 40.5 },
      { event_id: EV_DOD, date: "2026-11-22", ad_spend: 30 },
      { event_id: EV_DOD, date: "2026-11-10", ad_spend: 99 },
    ],
    signup_source_snapshots: [
      { id: "s1", event_id: EV_DOD, source: "cirqlin", day: "2026-11-23", signups_day: 12, signups_total: 840, snapshot_at: "2026-11-23T23:00:00Z", raw_json: null },
      { id: "s2", event_id: EV_DOD, source: "cirqlin", day: "2026-11-22", signups_day: 9, signups_total: 828, snapshot_at: "2026-11-22T23:00:00Z", raw_json: null },
    ],
    cirqlin_page_audience: [
      { page_id: "p0000000-0000-4000-8000-000000000001", fetch_day: "2026-11-23", event_id: EV_DOD, is_umbrella: false, signups: 845, consent_marketing: 700, community_joined: 120 },
    ],
    launched_ad_sets: [
      { id: "l1", meta_adset_id: "2301", meta_campaign_id: "120001", draft_id: DRAFT_1, event_id: EV_DOD },
      { id: "l2", meta_adset_id: "2302", meta_campaign_id: "120001", draft_id: DRAFT_1, event_id: EV_DOD },
    ],
    campaign_drafts: [
      {
        id: DRAFT_1,
        name: "NX26-DOD · On sale",
        status: "published",
        objective: "sales",
        event_id: EV_DOD,
        client_id: CLIENT_NX,
        ad_account_id: "act_606252931141334",
        updated_at: "2026-11-20T10:00:00Z",
        draft_json: {
          settings: { adAccountId: "act_606252931141334", pixelId: "2763", campaignCode: "NX26-DOD", objective: "sales" },
          audiences: { pageGroups: [{ name: "Fans" }], customAudienceGroups: [], interestGroups: [{ name: "Techno" }], selectedPagesLookalikeGroups: [], savedAudiences: { audienceIds: [] } },
          creatives: [{ name: "Teaser 9x16", mediaType: "video", headline: "D.O.D", destinationUrl: "https://www.skiddle.com/e/123", assetVariations: [{}, {}] }],
          budgetSchedule: {
            budgetLevel: "ad_set",
            budgetType: "daily",
            budgetAmount: 50,
            currency: "GBP",
            startDate: "2026-11-01",
            endDate: "2026-12-20",
            timezone: "Europe/London",
            locationGroups: [{ id: "g1", label: "Newcastle +40", selections: [{ label: "Newcastle", mode: "include" }] }],
          },
          adSetSuggestions: [{ name: "Fans · 18-35", enabled: true, budgetPerDay: 20, ageMin: 18, ageMax: 35, sourceName: "Fans", locationGroupId: "g1" }],
        },
      },
    ],
    learning_findings: [
      {
        id: "f1",
        kind: "test_verdict",
        scope: "event",
        scope_id: "NX26-DOD",
        event_id: EV_DOD,
        client_id: CLIENT_NX,
        subject: "2301",
        verdict: "ready_to_call",
        confidence: "ok",
        evidence: { adsetName: "NX26-DOD · AB copy test", text: "B wins at £1.20 per signup" },
        recommendation: null,
        computed_at: "2026-11-23T04:15:00Z",
      },
      {
        id: "f2",
        kind: "axis_rollup",
        scope: "all",
        scope_id: null,
        event_id: null,
        client_id: null,
        stage: "registration",
        subject: "tests|copy",
        value_a: 3,
        value_b: 5,
        n_shows: 6,
        confidence: "ok",
        evidence: { testKind: "copy" },
        recommendation: null,
        computed_at: "2026-11-23T04:15:00Z",
      },
      { id: "f3", kind: "show_week", scope: "event", scope_id: "OLD26-X", event_id: EV_ARCH, client_id: CLIENT_OLD, evidence: {}, computed_at: "2026-11-23T04:15:00Z" },
    ],
    ad_daily_insights: [
      { meta_ad_id: "a1", date: "2026-11-23", spend: 25, campaign_name: "[NX26-DOD] On sale", meta_campaign_id: "120001", actions: [{ action_type: "omni_initiated_checkout", value: "4" }] },
      { meta_ad_id: "a2", date: "2026-11-23", spend: 10, campaign_name: "[NX26-D0D] Typo", meta_campaign_id: "120002", actions: [] },
      { meta_ad_id: "a1", date: "2026-11-20", spend: 21, campaign_name: "[NX26-DOD] On sale", meta_campaign_id: "120001", actions: [{ action_type: "omni_initiated_checkout", value: "7" }] },
      { meta_ad_id: "a9", date: "2026-11-23", spend: 99, campaign_name: "[OLD26-X] Gone", meta_campaign_id: "999", actions: [] },
    ],
  };
}

export const fakeReaders: McpReaders = {
  async ticketSnapshots(_db, eventId) {
    if (eventId !== EV_DOD) return [];
    return [
      { snapshot_at: "2026-11-21T08:00:00Z", tickets_sold: 400, source: "eventbrite" },
      { snapshot_at: "2026-11-23T08:00:00Z", tickets_sold: 431, source: "eventbrite" },
    ];
  },
  migrateDraft(raw) {
    return raw;
  },
};

export function ctx(over: Partial<ToolContext> = {}): ToolContext & { db: ReturnType<typeof fakeDb> } {
  return { db: fakeDb(tables()), readers: fakeReaders, userId: "b3ee4e5c-44e6-4684-acf6-efefbecd5858", seesClientNames: true, today: TODAY, now: NOW, ...over } as never;
}
