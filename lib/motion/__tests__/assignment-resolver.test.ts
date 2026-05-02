import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { resolveMotionAssignments } from "../assignment-resolver.ts";

const EVENTS = [
  { id: "event-manchester", event_code: "WC26-MANCHESTER" },
  { id: "event-brighton", event_code: "WC26-BRIGHTON" },
];

describe("resolveMotionAssignments", () => {
  it("maps glossary creative ids to event-scoped creative tag assignments", () => {
    const glossary = {
      data: [
        {
          name: "Messaging theme",
          values: [
            {
              name: "Optimal Viewing Experience",
              creativeIds: ["creative-happy-video", "creative-missing-event"],
            },
            {
              name: "Promotional Offer / Discount",
              creativeIds: ["creative-missing-insight", "creative-empty-name"],
            },
          ],
        },
        {
          name: "Visual Format",
          values: [
            {
              name: "Reaction Video",
              creativeIds: ["creative-happy-video"],
            },
            {
              name: "Headline",
              creativeIds: ["creative-happy-image"],
            },
          ],
        },
      ],
    };
    const insights = {
      data: {
        data: {
          insightsResult: {
            data: {
              insights: [
                {
                  creativeKey: "motion-key-1",
                  ad: {
                    adName: "[WC26-MANCHESTER] Hero   Video",
                    campaignName: "[WC26-MANCHESTER] Presale",
                    creativeAssetId: "creative-happy-video",
                  },
                },
                {
                  creativeKey: "motion-key-2",
                  ad: {
                    adName: "Artwork 2",
                    campaignName: "[WC26-BRIGHTON] Presale",
                    primaryCreativeAssetIds: ["creative-happy-image"],
                  },
                },
                {
                  creativeKey: "motion-key-3",
                  ad: {
                    adName: "Unknown event",
                    campaignName: "[WC26-UNKNOWN] Presale",
                    creativeAssetId: "creative-missing-event",
                  },
                },
                {
                  creativeKey: "motion-key-4",
                  ad: {
                    adName: "   ",
                    campaignName: "[WC26-MANCHESTER] Presale",
                    creativeAssetId: "creative-empty-name",
                  },
                },
              ],
            },
          },
        },
      },
    };

    const result = resolveMotionAssignments(glossary, insights, EVENTS);

    assert.deepEqual(result.assignments, [
      {
        event_id: "event-manchester",
        creative_name: "Hero Video",
        dimension: "messaging_angle",
        value_key: "optimal_viewing_experience",
        source: "manual",
      },
      {
        event_id: "event-manchester",
        creative_name: "Hero Video",
        dimension: "visual_format",
        value_key: "reaction_video",
        source: "manual",
      },
      {
        event_id: "event-brighton",
        creative_name: "Artwork 2",
        dimension: "visual_format",
        value_key: "headline",
        source: "manual",
      },
    ]);
    assert.equal(result.report.mapped_creatives, 2);
    assert.equal(result.report.dropped_creatives, 3);
    assert.deepEqual(result.report.dropped_by_reason, {
      missing_motion_insight: 1,
      missing_campaign_event_code: 0,
      unknown_event_code: 1,
      missing_creative_name: 1,
    });
  });

  it("drops creatives whose campaign name does not expose an event code", () => {
    const result = resolveMotionAssignments(
      {
        data: [
          {
            name: "Asset Type",
            values: [{ name: "UGC", creativeIds: ["creative-no-code"] }],
          },
        ],
      },
      {
        data: {
          data: {
            insightsResult: {
              data: {
                insights: [
                  {
                    creativeKey: "motion-key-5",
                    ad: {
                      adName: "UGC 1",
                      campaignName: "No bracketed code",
                      creativeAssetId: "creative-no-code",
                    },
                  },
                ],
              },
            },
          },
        },
      },
      EVENTS,
    );

    assert.deepEqual(result.assignments, []);
    assert.equal(result.report.dropped_by_reason.missing_campaign_event_code, 1);
  });
});
