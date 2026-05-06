import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildAudienceDraftInputs } from "../api.ts";
import type { Database } from "../../db/database.types.ts";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const CLIENT_ID = "00000000-0000-0000-0000-000000000002";
const EVENT_ID = "00000000-0000-0000-0000-000000000003";

describe("POST /api/audiences payload expansion", () => {
  it("builds a single draft audience insert", async () => {
    const inputs = await buildAudienceDraftInputs(makeSupabase(), USER_ID, {
      clientId: CLIENT_ID,
      eventId: EVENT_ID,
      funnelStage: "bottom_funnel",
      audienceSubtype: "website_pixel",
      retentionDays: 30,
      sourceId: "pixel_1",
      sourceMeta: { subtype: "website_pixel", pixelEvent: "InitiateCheckout" },
    });

    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].name, "[EVT] Website pixel 30d");
    assert.equal(inputs[0].metaAdAccountId, "act_123");
    assert.deepEqual(inputs[0].sourceMeta, {
      subtype: "website_pixel",
      pixelEvent: "InitiateCheckout",
      pixelName: undefined,
    });
  });

  it("expands a top-of-funnel preset bundle", async () => {
    const inputs = await buildAudienceDraftInputs(makeSupabase(), USER_ID, {
      clientId: CLIENT_ID,
      presetBundle: "top_of_funnel",
      sourceIds: bundleSourceIds(),
    });

    assert.equal(inputs.length, 6);
    assert.deepEqual(
      inputs.map((input) => [input.audienceSubtype, input.retentionDays]),
      [
        ["page_engagement_fb", 365],
        ["page_engagement_ig", 365],
        ["page_followers_fb", 365],
        ["page_followers_ig", 365],
        ["video_views", 365],
        ["website_pixel", 180],
      ],
    );
  });

  it("rejects video_views when campaigns are chosen but no videos selected", async () => {
    await assert.rejects(
      async () =>
        buildAudienceDraftInputs(makeSupabase(), USER_ID, {
          clientId: CLIENT_ID,
          eventId: EVENT_ID,
          funnelStage: "bottom_funnel",
          audienceSubtype: "video_views",
          retentionDays: 30,
          sourceId: "",
          sourceMeta: {
            subtype: "video_views",
            threshold: 95,
            campaignIds: ["camp_1"],
            videoIds: [],
          },
        }),
      /No video creatives selected/,
    );
  });

  it("accepts video_views when videoIds are set even if flat sourceId is empty", async () => {
    const inputs = await buildAudienceDraftInputs(makeSupabase(), USER_ID, {
      clientId: CLIENT_ID,
      eventId: EVENT_ID,
      funnelStage: "bottom_funnel",
      audienceSubtype: "video_views",
      retentionDays: 30,
      sourceId: "",
      sourceMeta: {
        subtype: "video_views",
        threshold: 95,
        campaignIds: ["camp_1"],
        videoIds: ["vid_1"],
      },
    });
    assert.equal(inputs[0].sourceId, "vid_1");
    assert.deepEqual((inputs[0].sourceMeta as { videoIds: string[] }).videoIds, [
      "vid_1",
    ]);
  });

  it("persists website_pixel urlContains as string array", async () => {
    const inputs = await buildAudienceDraftInputs(makeSupabase(), USER_ID, {
      clientId: CLIENT_ID,
      eventId: EVENT_ID,
      funnelStage: "bottom_funnel",
      audienceSubtype: "website_pixel",
      retentionDays: 30,
      sourceId: "pixel_1",
      sourceMeta: {
        subtype: "website_pixel",
        pixelEvent: "ViewContent",
        urlContains: ["/arsenal-cl-final", "/arsenal-cl-presale"],
      },
    });
    assert.deepEqual(inputs[0].sourceMeta, {
      subtype: "website_pixel",
      pixelEvent: "ViewContent",
      urlContains: ["/arsenal-cl-final", "/arsenal-cl-presale"],
      pixelName: undefined,
    });
  });

  it("coerces legacy string urlContains to array in merged sourceMeta", async () => {
    const inputs = await buildAudienceDraftInputs(makeSupabase(), USER_ID, {
      clientId: CLIENT_ID,
      eventId: EVENT_ID,
      funnelStage: "bottom_funnel",
      audienceSubtype: "website_pixel",
      retentionDays: 30,
      sourceId: "pixel_1",
      sourceMeta: {
        subtype: "website_pixel",
        pixelEvent: "ViewContent",
        urlContains: "/legacy-path",
      },
    });
    assert.deepEqual(
      (inputs[0].sourceMeta as { urlContains: string[] }).urlContains,
      ["/legacy-path"],
    );
  });

  it("expands mid and bottom preset bundles as four-row inserts", async () => {
    for (const presetBundle of ["mid_funnel", "bottom_funnel"] as const) {
      const inputs = await buildAudienceDraftInputs(makeSupabase(), USER_ID, {
        clientId: CLIENT_ID,
        presetBundle,
        sourceIds: bundleSourceIds(),
      });

      assert.equal(inputs.length, 4);
      assert.equal(inputs.every((input) => input.clientId === CLIENT_ID), true);
    }
  });
});

function bundleSourceIds() {
  return {
    page_engagement_fb: "fb_page_1",
    page_engagement_ig: "ig_account_1",
    page_followers_fb: "fb_page_1",
    page_followers_ig: "ig_account_1",
    video_views: "video_1,video_2",
    website_pixel: "pixel_1",
  };
}

function makeSupabase() {
  return {
    from(table: string) {
      return new Query(table);
    },
  } as unknown as SupabaseClient<Database>;
}

class Query {
  private readonly table: string;
  private filters: Record<string, unknown> = {};

  constructor(table: string) {
    this.table = table;
  }

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value;
    return this;
  }

  maybeSingle() {
    if (this.table === "clients" && this.filters.id === CLIENT_ID) {
      return Promise.resolve({
        data: {
          id: CLIENT_ID,
          name: "Client One",
          slug: "client-one",
          meta_ad_account_id: "act_123",
        },
        error: null,
      });
    }
    if (this.table === "events" && this.filters.id === EVENT_ID) {
      return Promise.resolve({
        data: {
          id: EVENT_ID,
          client_id: CLIENT_ID,
          name: "Event One",
          event_code: "EVT",
        },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  }
}
