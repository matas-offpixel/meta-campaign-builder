import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FUNNEL_STAGE_PRESETS } from "../funnel-presets.ts";

describe("FUNNEL_STAGE_PRESETS", () => {
  it("keeps the signed-off top-of-funnel preset shape", () => {
    assert.deepEqual(
      FUNNEL_STAGE_PRESETS.top_of_funnel.map((preset) => [
        preset.audienceSubtype,
        preset.retentionDays,
        preset.defaultSourceMeta,
      ]),
      [
        ["page_engagement_fb", 365, { subtype: "page_engagement_fb" }],
        ["page_engagement_ig", 365, { subtype: "page_engagement_ig" }],
        ["page_followers_fb", 365, { subtype: "page_followers_fb" }],
        ["page_followers_ig", 365, { subtype: "page_followers_ig" }],
        [
          "video_views",
          365,
          { subtype: "video_views", threshold: 50, videoIds: [] },
        ],
        ["website_pixel", 180, { subtype: "website_pixel", pixelEvent: "PageView" }],
      ],
    );
  });

  it("keeps the signed-off mid-funnel preset shape", () => {
    assert.deepEqual(
      FUNNEL_STAGE_PRESETS.mid_funnel.map((preset) => [
        preset.audienceSubtype,
        preset.retentionDays,
        preset.defaultSourceMeta,
      ]),
      [
        ["page_engagement_fb", 60, { subtype: "page_engagement_fb" }],
        ["page_engagement_ig", 60, { subtype: "page_engagement_ig" }],
        [
          "video_views",
          60,
          { subtype: "video_views", threshold: 75, videoIds: [] },
        ],
        [
          "website_pixel",
          60,
          {
            subtype: "website_pixel",
            pixelEvent: "ViewContent",
            urlContains: "",
          },
        ],
      ],
    );
  });

  it("keeps the signed-off bottom-funnel preset shape", () => {
    assert.deepEqual(
      FUNNEL_STAGE_PRESETS.bottom_funnel.map((preset) => [
        preset.audienceSubtype,
        preset.retentionDays,
        preset.defaultSourceMeta,
      ]),
      [
        ["page_engagement_fb", 30, { subtype: "page_engagement_fb" }],
        ["page_engagement_ig", 30, { subtype: "page_engagement_ig" }],
        [
          "video_views",
          30,
          { subtype: "video_views", threshold: 95, videoIds: [] },
        ],
        [
          "website_pixel",
          30,
          { subtype: "website_pixel", pixelEvent: "InitiateCheckout" },
        ],
      ],
    );
  });
});
