import { strict as assert } from "node:assert";
import { test } from "node:test";

import { enrichActiveCreativesSnapshotThumbnails } from "../active-creatives-thumbnail-enrichment.ts";
import type {
  ActiveCreativeThumbnailSource,
  ConceptGroupRow,
} from "../group-creatives.ts";

function source(
  overrides: Partial<ActiveCreativeThumbnailSource>,
): ActiveCreativeThumbnailSource {
  return {
    video_id: null,
    image_hash: null,
    ...overrides,
  };
}

function group(
  thumbnailSource: ActiveCreativeThumbnailSource,
): ConceptGroupRow {
  return {
    group_key: "group-1",
    display_name: "Static 1",
    creative_id_count: 1,
    ad_count: 1,
    adsets: [],
    campaigns: [],
    representative_ad_id: "ad-1",
    representative_thumbnail: "https://cdn.example/original-160.jpg",
    representative_thumbnail_ad_id: "ad-1",
    representative_thumbnail_source: thumbnailSource,
    representative_headline: "Headline",
    representative_body_preview: "Body",
    representative_preview: {
      image_url: "https://cdn.example/original-160.jpg",
      video_id: thumbnailSource.video_id,
      instagram_permalink_url: null,
      headline: null,
      body: null,
      call_to_action_type: null,
      link_url: null,
      is_low_res_fallback: true,
    },
    spend: 100,
    impressions: 1000,
    clicks: 10,
    reach: 800,
    registrations: 0,
    purchases: 0,
    landingPageViews: 0,
    ctr: 1,
    cpm: 100,
    cpc: 10,
    cpr: null,
    cpp: null,
    cplpv: null,
    frequency: 1.25,
    fatigueScore: "ok",
    inline_link_clicks: 10,
    any_ad_active: true,
    ad_names: ["Static 1"],
    underlying_creative_ids: ["creative-1"],
    reasons: ["creative_id"],
  };
}

function payload(g: ConceptGroupRow) {
  return {
    kind: "ok" as const,
    groups: [g],
  };
}

test("video creative stores the preferred thumbnail uri", async () => {
  const out = await enrichActiveCreativesSnapshotThumbnails({
    payload: payload(group(source({ video_id: "video-1" }))),
    adAccountId: "act_1",
    token: "token",
    graphGet: async (path, params) => {
      assert.equal(path, "/video-1/thumbnails");
      assert.equal(params.fields, "uri,width,is_preferred");
      return {
        data: [
          { uri: "https://cdn.example/wide.jpg", width: 1920 },
          {
            uri: "https://cdn.example/preferred.jpg",
            width: 640,
            is_preferred: true,
          },
        ],
      };
    },
  });

  assert.equal(out.groups[0].representative_thumbnail, "https://cdn.example/preferred.jpg");
});

test("video creative without preferred thumbnail stores the highest-width uri", async () => {
  const out = await enrichActiveCreativesSnapshotThumbnails({
    payload: payload(group(source({ video_id: "video-2" }))),
    adAccountId: "act_1",
    token: "token",
    graphGet: async () => ({
      data: [
        { uri: "https://cdn.example/640.jpg", width: 640 },
        { uri: "https://cdn.example/1280.jpg", width: 1280 },
      ],
    }),
  });

  assert.equal(out.groups[0].representative_thumbnail, "https://cdn.example/1280.jpg");
});

test("static creative with image_hash stores adimages permalink_url", async () => {
  const out = await enrichActiveCreativesSnapshotThumbnails({
    payload: payload(group(source({ image_hash: "hash-1" }))),
    adAccountId: "act_1",
    token: "token",
    graphGet: async (path, params) => {
      assert.equal(path, "/act_1/adimages");
      assert.equal(params.hashes, JSON.stringify(["hash-1"]));
      assert.equal(params.fields, "permalink_url,url");
      return {
        data: [
          {
            permalink_url: "https://cdn.example/full-res.jpg",
            url: "https://cdn.example/proxy.jpg",
          },
        ],
      };
    },
  });

  assert.equal(out.groups[0].representative_thumbnail, "https://cdn.example/full-res.jpg");
});

test("enrichment API failure falls back to original thumbnail", async () => {
  const out = await enrichActiveCreativesSnapshotThumbnails({
    payload: payload(group(source({ video_id: "deleted-video" }))),
    adAccountId: "act_1",
    token: "token",
    graphGet: async () => {
      throw new Error("Meta deleted this video");
    },
  });

  assert.equal(
    out.groups[0].representative_thumbnail,
    "https://cdn.example/original-160.jpg",
  );
});
