import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMetaCustomAudiencePayload } from "../audience-payload.ts";
import type { MetaCustomAudience } from "../../types/audience.ts";

describe("buildMetaCustomAudiencePayload", () => {
  it("builds FB page engagement at 365d", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_engagement_fb",
        retentionDays: 365,
        sourceId: "page_1",
        sourceMeta: { subtype: "page_engagement_fb", pageName: "4theFans" },
      }),
    );
    const rule = JSON.parse(payload.rule) as RuleShape;
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "page");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "page_1");
    assert.equal(rule.inclusions.rules[0].retention_seconds, "31536000");
    assert.equal(rule.inclusions.rules[0].filter.filters[0].value, "page_engaged");
  });

  it("builds IG followers at 365d", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "page_followers_ig",
        retentionDays: 365,
        sourceId: "ig_1",
        sourceMeta: { subtype: "page_followers_ig", pageName: "4theFans" },
      }),
    );
    const rule = JSON.parse(payload.rule) as RuleShape;
    assert.equal(payload.subtype, "ENGAGEMENT");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "ig_business");
    assert.equal(rule.inclusions.rules[0].event_sources[0].id, "ig_1");
    assert.equal(rule.inclusions.rules[0].filter.filters[0].value, "page_liked");
  });

  it("builds video views at 95% with three video IDs", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "video_views",
        retentionDays: 30,
        sourceId: "v1,v2,v3",
        sourceMeta: {
          subtype: "video_views",
          threshold: 95,
          campaignId: "camp_1",
          campaignName: "[4TF26-ARSENAL-CL] CL Promo",
          videoIds: ["v1", "v2", "v3"],
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as RuleShape;
    assert.equal(payload.subtype, "VIDEO_VIEWERS_VIEWED");
    assert.deepEqual(
      rule.inclusions.rules[0].event_sources.map((source) => source.id),
      ["v1", "v2", "v3"],
    );
    assert.equal(
      rule.inclusions.rules[0].filter.filters[0].value,
      "video_watched_95_percent",
    );
  });

  it("builds website pixel ViewContent with URL contains", () => {
    const payload = buildMetaCustomAudiencePayload(
      audience({
        audienceSubtype: "website_pixel",
        retentionDays: 60,
        sourceId: "pixel_1",
        sourceMeta: {
          subtype: "website_pixel",
          pixelEvent: "ViewContent",
          urlContains: "/arsenal",
        },
      }),
    );
    const rule = JSON.parse(payload.rule) as RuleShape;
    assert.equal(payload.subtype, "WEBSITE");
    assert.equal(rule.inclusions.rules[0].event_sources[0].type, "pixel");
    assert.equal(rule.inclusions.rules[0].filter.filters[0].value, "ViewContent");
    assert.equal(rule.inclusions.rules[0].filter.filters[1].field, "url");
    assert.equal(rule.inclusions.rules[0].filter.filters[1].value, "/arsenal");
  });
});

interface RuleShape {
  inclusions: {
    rules: Array<{
      event_sources: Array<{ type: string; id: string }>;
      retention_seconds: string;
      filter: { filters: Array<{ field: string; value: string }> };
    }>;
  };
}

function audience(
  patch: Partial<MetaCustomAudience>,
): MetaCustomAudience {
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
