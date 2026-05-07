import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMetaCustomAudiencePayload } from "../audience-payload.ts";
import type { MetaCustomAudience } from "../../types/audience.ts";

/**
 * All assertions locked to VERIFIED shapes read from Graph API Explorer
 * on 2026-05-07 against reference audiences in act_10151014958791885:
 *   6984467206665  "Off/Pixel TEST FB engagement"
 *   6984477877465  "Off/Pixel TEST FB followers"
 *   6984477463665  "Off/Pixel TEST IG engagement"
 *   6984477683065  "Off/Pixel TEST IG followers"
 *   6984471975065  "Off/Pixel TEST 95% VV Manchester"
 *   6983230099865  "Arsenal CL Final Pixel"
 *
 * Structural corrections (PR after #328):
 *   - retention_seconds and event_sources.id are JSON numbers, not strings (rule JSON paths)
 *   - POST subtype="ENGAGEMENT" for ALL page/IG subtypes (Meta's #100 error
 *     confirms IG_BUSINESS is not a valid POST value)
 *   - Single-page engagement/followers: FLAT form fields (event_source_id,
 *     event_source_type, event) — no `rule` key (Meta POST rejects nested rule
 *     JSON for simple ENGAGEMENT audiences)
 *   - Multi-page (2+ pageIds): retains {inclusions:...} rule JSON (fallback)
 *   - Pixel URL rules carry a trailing {field:url,operator:i_contains,value:""}
 *     after the VISITORS_BY_URL OR-group (required by Meta, verified from
 *     working audience 6983230099865)
 */
describe("buildMetaCustomAudiencePayload", () => {
  // ─── FB page engagement ─────────────────────────────────────────────────────

  it("single-page FB engagement: flat POST — event_source_id, event_source_type=page, event=page_engaged; no rule", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "202868440480679",
        sourceMeta: { subtype: "page_engagement_fb", pageName: "4theFans" },
      }),
    );
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.ok(!("rule" in payload), "flat format must not include rule");
    assert.equal(payload.event_source_id, "202868440480679");
    assert.equal(payload.event_source_type, "page");
    assert.equal(payload.event, "page_engaged");
  });

  it("multi-page FB engagement: retains rule JSON with inclusions + numeric ids", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "100000001,100000002",
        sourceMeta: {
          subtype: "page_engagement_fb",
          pageIds: ["100000001", "100000002"],
          pageName: "Primary",
        },
      }),
    );
    assert.ok("rule" in payload && payload.rule);
    assert.ok(!("event_source_id" in payload));
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(rule.inclusions.rules.length, 2);
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, 100000001);
    assert.equal(rule.inclusions.rules[1].event_sources[0].id, 100000002);
    const ev = rule.inclusions.rules[0].filter.filters[0] as EventLeaf;
    assert.equal(ev.value, "page_engaged");
  });

  // ─── IG page engagement ─────────────────────────────────────────────────────

  it("single-page IG engagement: flat POST — event_source_type=ig_business, event=ig_business_profile_all; no rule", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_ig",
        retentionDays: 365,
        sourceId: "100000003",
        sourceMeta: { subtype: "page_engagement_ig", pageName: "4thefansevents" },
      }),
    );
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.ok(!("rule" in payload));
    assert.equal(payload.event_source_id, "100000003");
    assert.equal(payload.event_source_type, "ig_business");
    assert.equal(payload.event, "ig_business_profile_all");
  });

  // ─── FB page followers ──────────────────────────────────────────────────────

  it("single-page FB followers: flat POST — event=page_liked, type=page; no rule", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_fb",
        retentionDays: 365,
        sourceId: "202868440480679",
        sourceMeta: { subtype: "page_followers_fb", pageName: "4theFans" },
      }),
    );
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.ok(!("rule" in payload));
    assert.equal(payload.event_source_id, "202868440480679");
    assert.equal(payload.event_source_type, "page");
    assert.equal(payload.event, "page_liked");
  });

  // ─── IG followers ───────────────────────────────────────────────────────────

  it("single-page IG followers: flat POST — event=INSTAGRAM_PROFILE_FOLLOW, type=ig_business; no rule", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_ig",
        retentionDays: 365,
        sourceId: "100000004",
        sourceMeta: { subtype: "page_followers_ig", pageName: "4theFans" },
      }),
    );
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.ok(!("rule" in payload));
    assert.equal(payload.event_source_id, "100000004");
    assert.equal(payload.event_source_type, "ig_business");
    assert.equal(payload.event, "INSTAGRAM_PROFILE_FOLLOW");
  });

  // ─── Video views ─────────────────────────────────────────────────────────────
  // Rule is a BARE JSON ARRAY (not {inclusions:{...}}).
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
  // Verified 2026-05-07 from audience 6983230099865 ("Arsenal CL Final Pixel"):
  //   - event_sources.id is a JSON number
  //   - URL filter: VISITORS_BY_URL OR-group + TRAILING {field:url,i_contains,""} 
  //   - Without the trailing empty filter Meta rejects with #2654 subcode 1870053
  //   - URL scheme (https://) is preserved — Meta stores it as-is
  //   - No URL → event-only leaf, length 1 (no trailing empty)

  it("website pixel with URL: numeric sourceId, OR-group + trailing empty filter, scheme preserved", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
          urlContains: "https://wearefootballfestival.co.uk",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    assert.equal(payload.subtype, "WEBSITE");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "pixel");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, 6983230099865);
    assert.equal(typeof rule.inclusions.rules[0].event_sources[0].id, "number");
    assert.equal(typeof rule.inclusions.rules[0].retention_seconds, "number");
    assert.equal(rule.inclusions.rules[0].filter.operator, "and");
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 2, "OR-group + trailing empty filter");
    const urlGroup = filters[0] as UrlOrGroupWithTemplate;
    assert.equal(urlGroup.operator, "or");
    assert.equal(urlGroup.template, "VISITORS_BY_URL");
    assert.equal(urlGroup.filters.length, 1);
    assert.equal(urlGroup.filters[0].value, "https://wearefootballfestival.co.uk");
    assert.equal(urlGroup.filters[0].field, "url");
    const trailing = filters[1] as EventLeaf;
    assert.equal(trailing.field, "url");
    assert.equal(trailing.operator, "i_contains");
    assert.equal(trailing.value, "");
  });

  it("website pixel multi-URL: OR group + trailing empty, values unchanged", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "ViewContent",
          urlContains: ["/arsenal-cl-final", "/arsenal-cl-presale", "/extra"],
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 2);
    const urlGroup = filters[0] as UrlOrGroupWithTemplate;
    assert.equal(urlGroup.operator, "or");
    assert.equal(urlGroup.template, "VISITORS_BY_URL");
    assert.equal(urlGroup.filters.length, 3);
    assert.deepEqual(
      urlGroup.filters.map((f) => f.value),
      ["/arsenal-cl-final", "/arsenal-cl-presale", "/extra"],
    );
    const trailing = filters[1] as EventLeaf;
    assert.equal(trailing.field, "url");
    assert.equal(trailing.value, "");
  });

  it("website pixel https:// is NOT stripped from URL values (Meta stores scheme)", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
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

  it("website pixel with no URL: single event-only leaf, no trailing empty, operator=eq", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "6983230099865",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "PageView",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as EngagementRuleShape;
    const filters = rule.inclusions.rules[0].filter.filters;
    assert.equal(filters.length, 1, "no trailing empty when no URL filter");
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
      event_sources: Array<{ type: string; id: number | string }>;
      retention_seconds: number;
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
