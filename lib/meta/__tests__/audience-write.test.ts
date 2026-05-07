import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMetaCustomAudiencePayload } from "../audience-payload.ts";
import type { MetaCustomAudience } from "../../types/audience.ts";

/**
 * All assertions below are locked to VERIFIED values read from Graph API
 * Explorer on 2026-05-07 against reference audiences in act_10151014958791885:
 *   6984467206665  "Off/Pixel TEST FB engagement"
 *   6984477877465  "Off/Pixel TEST FB followers"
 *   6984477463665  "Off/Pixel TEST IG engagement"
 *   6984477683065  "Off/Pixel TEST IG followers"
 *   6984471975065  "Off/Pixel TEST 95% VV Manchester"
 *   6983238099865  "Arsenal CL Final Pixel"
 */
describe("buildMetaCustomAudiencePayload", () => {
  // ─── FB page engagement ─────────────────────────────────────────────────────

  it("FB page engagement: subtype=ENGAGEMENT, operator=eq, event=page_engaged", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "page_1",
        sourceMeta: { subtype: "page_engagement_fb", pageName: "4theFans" },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "page");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "page_1");
    assert.equal(rule.inclusions.rules[0].retention_seconds, "31536000");
    assert.equal(rule.inclusions.rules[0].filter.operator, "and");
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.field, "event");
    assert.equal(ev.operator, "eq");
    assert.equal(ev.value, "page_engaged");
  });

  it("FB page engagement with multiple page IDs produces OR rules", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "p1,p2",
        sourceMeta: {
          subtype: "page_engagement_fb",
          pageIds: ["p1", "p2"],
          pageName: "Primary",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules.length, 2);
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "p1");
    assert.equal(rule.inclusions.rules[1].event_sources[0].id, "p2");
  });

  // ─── IG page engagement ─────────────────────────────────────────────────────

  it("IG page engagement: subtype=IG_BUSINESS, event=ig_business_profile_all (verified 2026-05-07)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_ig",
        retentionDays: 365,
        sourceId: "igbiz_1",
        sourceMeta: { subtype: "page_engagement_ig", pageName: "4thefansevents" },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(payload.subtype, "IG_BUSINESS");
    assert.notEqual(payload.subtype, "ENGAGEMENT");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.operator, "eq");
    assert.equal(ev.value, "ig_business_profile_all");
  });

  // ─── FB page followers ──────────────────────────────────────────────────────

  it("FB page followers: subtype=ENGAGEMENT, event=page_liked (verified 2026-05-07)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_fb",
        retentionDays: 365,
        sourceId: "page_9",
        sourceMeta: { subtype: "page_followers_fb", pageName: "4theFans" },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "page");
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.operator, "eq");
    assert.equal(ev.value, "page_liked");
  });

  // ─── IG followers ───────────────────────────────────────────────────────────

  it("IG followers: subtype=IG_BUSINESS, event=INSTAGRAM_PROFILE_FOLLOW (SHOUTING_CASE, verified 2026-05-07)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_ig",
        retentionDays: 365,
        sourceId: "ig_1",
        sourceMeta: { subtype: "page_followers_ig", pageName: "4theFans" },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(payload.subtype, "IG_BUSINESS");
    assert.notEqual(payload.subtype, "ENGAGEMENT");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "ig_1");
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.operator, "eq");
    assert.equal(ev.value, "INSTAGRAM_PROFILE_FOLLOW");
  });

  // ─── Video views ─────────────────────────────────────────────────────────────
  // Rule is a BARE JSON ARRAY (not an {inclusions:{...}} object).
  // Verified 2026-05-07 from audience 6984471975065.

  it("video views 95%: bare array, subtype=ENGAGEMENT, event_name=video_completed", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1,v2,v3",
        sourceMeta: {
          subtype: "video_views",
          threshold: 95,
          campaignId: "camp_1",
          campaignName: "[4TF26] Promo",
          videoIds: ["v1", "v2", "v3"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.notEqual(payload.subtype, "VIDEO");
    assert.notEqual(payload.subtype, "VIDEO_VIEWERS_VIEWED");
    assert.ok(Array.isArray(ruleArray), "rule must be a bare JSON array, not {inclusions:{...}}");
    assert.equal(ruleArray.length, 3);
    assert.equal(ruleArray[0].event_name, "video_completed");
    assert.notEqual(ruleArray[0].event_name, "video_watched_95_percent");
    assert.equal(ruleArray[0].object_id, "v1");
    assert.equal(ruleArray[0].context_id, "page_ctx_1");
    assert.equal(ruleArray[1].object_id, "v2");
    assert.equal(ruleArray[2].object_id, "v3");
    assert.equal(ruleArray[2].event_name, "video_completed");
  });

  it("video views 50%: event_name=video_view_50_percent (not video_watched_50_percent)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 50,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(ruleArray[0].event_name, "video_view_50_percent");
    assert.notEqual(ruleArray[0].event_name, "video_watched_50_percent");
  });

  it("video views 100%: event_name=video_completed (same as 95%)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 100,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(ruleArray[0].event_name, "video_completed");
  });

  it("video views 75%: event_name=video_view_75_percent", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1",
        sourceMeta: {
          subtype: "video_views",
          threshold: 75,
          videoIds: ["v1"],
          contextId: "page_ctx_1",
        },
      }),
    );
    const ruleArray = JSON.parse(payload.rule) as VideoRuleEntry[];
    assert.equal(ruleArray[0].event_name, "video_view_75_percent");
  });

  it("video views throws when contextId is absent", () => {
    assert.throws(
      () =>
        buildMetaCustomAudiencePayload(
          audience({
            audienceSubtype: "video_views",
            retentionDays: 30,
            sourceId: "v1",
            sourceMeta: {
              subtype: "video_views",
              threshold: 95,
              videoIds: ["v1"],
            },
          }),
        ),
      /contextId/,
    );
  });

  // ─── Website pixel ──────────────────────────────────────────────────────────
  // Verified 2026-05-07 from audience 6983238099865 ("Arsenal CL Final Pixel").
  //   - URL scheme (https://) is PRESERVED in filter values (Meta stores it as-is)
  //   - URL filter uses VISITORS_BY_URL template on the OR group
  //   - No event leaf when URLs are present
  //   - Event-only filter used only when no URL filter is set

  it("website pixel with URL: VISITORS_BY_URL OR-group, scheme preserved", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "pixel_1",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
          urlContains: "https://wearefootballfestival.co.uk",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(payload.subtype, "WEBSITE");
    assert.equal(rule.inclusions.rules[0].filter.operator, "and");
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 1, "no event leaf when URL filter present");
    const urlGroup = filters[0] as UrlOrGroupWithTemplate;
    assert.equal(urlGroup.operator, "or");
    assert.equal(urlGroup.template, "VISITORS_BY_URL");
    assert.equal(urlGroup.filters.length, 1);
    assert.equal(urlGroup.filters[0].value, "https://wearefootballfestival.co.uk");
    assert.equal(urlGroup.filters[0].field, "url");
  });

  it("website pixel multi-URL: OR group with VISITORS_BY_URL template, values unchanged", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "pixel_1",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "ViewContent",
          urlContains: ["/arsenal-cl-final", "/arsenal-cl-presale", "/extra"],
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 1);
    const urlGroup = filters[0] as UrlOrGroupWithTemplate;
    assert.equal(urlGroup.operator, "or");
    assert.equal(urlGroup.template, "VISITORS_BY_URL");
    assert.equal(urlGroup.filters.length, 3);
    assert.deepEqual(
      urlGroup.filters.map((f) => f.value),
      ["/arsenal-cl-final", "/arsenal-cl-presale", "/extra"],
    );
  });

  it("website pixel https:// is NOT stripped from URL values (verified: Meta stores scheme)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "pixel_1",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
          urlContains: [
            "https://wearefootballfestival.co.uk/final",
            "http://example.org/presale",
          ],
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const urlGroup = rule.inclusions.rules[0].filter.filters[0] as UrlOrGroupWithTemplate;
    assert.deepEqual(
      urlGroup.filters.map((f) => f.value),
      ["https://wearefootballfestival.co.uk/final", "http://example.org/presale"],
    );
  });

  it("website pixel with no URL: single event-only leaf, operator=eq", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "pixel_1",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 1);
    const only = filters[0] as EventLeaf;
    assert.equal(only.field, "event");
    assert.equal(only.operator, "eq");
    assert.equal(only.value, "PageView");
  });
});

// ─── Types ────────────────────────────────────────────────────────────────────

type EventLeaf = { field: string; operator: string; value: string };

type UrlOrGroupWithTemplate = {
  operator: "or";
  template?: string;
  filters: Array<{ field: string; operator: string; value: string }>;
};

type VideoRuleEntry = {
  event_name: string;
  object_id: string;
  context_id: string;
};

interface EngagementRuleShape {
  inclusions: {
    rules: Array<{
      event_sources: Array<{ type: string; id: string }>;
      retention_seconds: string;
      filter: {
        operator: string;
        filters: Array<
          | { field: string; operator?: string; value: string }
          | UrlOrGroupWithTemplate
        >;
      };
    }>;
  };
}

function audience(patch: Partial<MetaCustomAudience>): MetaCustomAudience {
  return {
    id: "audience_1",
    userId: "user_1",
    clientId: "client_1",
    eventId: null,
    name: "[EVT] Audience 365d",
    funnelStage: "top_of_funnel",
    audienceSubtype: "page_engagement_fb",
    retentionDays: 365,
    sourceId: "source_1",
    sourceMeta: { subtype: "page_engagement_fb" },
    metaAudienceId: null,
    metaAdAccountId: "act_123",
    status: "draft",
    statusError: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...patch,
  };
}
