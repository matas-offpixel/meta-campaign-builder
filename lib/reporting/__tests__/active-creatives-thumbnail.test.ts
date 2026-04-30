import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  groupAdsByCreative,
  type AdInput,
  type CreativePreview,
} from "../active-creatives-group.ts";
import { groupByAssetSignature } from "../group-creatives.ts";
import { resolveActiveCreativeModalImage } from "../active-creatives-thumbnail.ts";

function preview(overrides: Partial<CreativePreview> = {}): CreativePreview {
  return {
    image_url: null,
    video_id: null,
    instagram_permalink_url: null,
    headline: null,
    body: null,
    call_to_action_type: null,
    link_url: null,
    ...overrides,
  };
}

function ad(overrides: Partial<AdInput>): AdInput {
  const base: AdInput = {
    ad_id: "ad-default",
    ad_name: "Static 1",
    status: "ACTIVE",
    campaign_id: "campaign-1",
    campaign_name: "Campaign 1",
    adset_id: "adset-1",
    adset_name: "Adset 1",
    creative_id: "creative-1",
    creative_name: "Creative 1",
    headline: "Headline",
    body: "Body",
    thumbnail_url: "https://cdn.example/default.jpg",
    effective_object_story_id: "post-1",
    object_story_id: null,
    primary_asset_signature: null,
    preview: preview({
      image_url: "https://cdn.example/default-modal.jpg",
      is_low_res_fallback: true,
    }),
    insights: {
      spend: 10,
      impressions: 100,
      clicks: 5,
      reach: 80,
      frequency: 1.25,
      actions: [],
    },
  };
  return { ...base, ...overrides };
}

function conceptFromAds(ads: AdInput[]) {
  const creativeRows = groupAdsByCreative(ads);
  const groups = groupByAssetSignature(creativeRows);
  assert.equal(groups.length, 1);
  return groups[0];
}

function assertCardAndModalUseSameThumbnail(ads: AdInput[], expected: {
  thumbnail: string | null;
  adId: string | null;
}) {
  const group = conceptFromAds(ads);
  const cardThumbnail = group.representative_thumbnail;
  const modalThumbnail = resolveActiveCreativeModalImage(
    group.representative_preview,
    group.representative_thumbnail,
  );

  assert.equal(cardThumbnail, expected.thumbnail);
  assert.equal(modalThumbnail, expected.thumbnail);
  assert.equal(group.representative_thumbnail_ad_id, expected.adId);
}

test("concept with 3 ads uses highest-spend ad thumbnail for card and modal", () => {
  assertCardAndModalUseSameThumbnail(
    [
      ad({
        ad_id: "ad-low",
        thumbnail_url: "https://cdn.example/low.jpg",
        preview: preview({
          image_url: "https://cdn.example/low-modal.jpg",
          is_low_res_fallback: true,
        }),
        insights: { spend: 10, impressions: 100, clicks: 1, reach: 80, frequency: 1.25, actions: [] },
      }),
      ad({
        ad_id: "ad-high",
        thumbnail_url: "https://cdn.example/high.jpg",
        preview: preview({
          image_url: "https://cdn.example/high-modal-different.jpg",
          is_low_res_fallback: true,
        }),
        insights: { spend: 90, impressions: 900, clicks: 9, reach: 700, frequency: 1.29, actions: [] },
      }),
      ad({
        ad_id: "ad-mid",
        thumbnail_url: "https://cdn.example/mid.jpg",
        preview: preview({
          image_url: "https://cdn.example/mid-modal.jpg",
          is_low_res_fallback: true,
        }),
        insights: { spend: 50, impressions: 500, clicks: 5, reach: 400, frequency: 1.25, actions: [] },
      }),
    ],
    { thumbnail: "https://cdn.example/high.jpg", adId: "ad-high" },
  );
});

test("highest-spend null thumbnail falls through to next thumbnail for both paths", () => {
  assertCardAndModalUseSameThumbnail(
    [
      ad({
        ad_id: "ad-high-null",
        thumbnail_url: null,
        preview: preview({
          image_url: null,
          is_low_res_fallback: true,
        }),
        insights: { spend: 100, impressions: 1000, clicks: 10, reach: 800, frequency: 1.25, actions: [] },
      }),
      ad({
        ad_id: "ad-mid-fallback",
        thumbnail_url: "https://cdn.example/fallback.jpg",
        preview: preview({
          image_url: "https://cdn.example/fallback-modal.jpg",
          is_low_res_fallback: true,
        }),
        insights: { spend: 60, impressions: 600, clicks: 6, reach: 450, frequency: 1.33, actions: [] },
      }),
      ad({
        ad_id: "ad-low",
        thumbnail_url: "https://cdn.example/low.jpg",
        preview: preview({
          image_url: "https://cdn.example/low-modal.jpg",
          is_low_res_fallback: true,
        }),
        insights: { spend: 20, impressions: 200, clicks: 2, reach: 150, frequency: 1.33, actions: [] },
      }),
    ],
    { thumbnail: "https://cdn.example/fallback.jpg", adId: "ad-mid-fallback" },
  );
});

test("single-ad concept uses that ad thumbnail for card and modal", () => {
  assertCardAndModalUseSameThumbnail(
    [
      ad({
        ad_id: "ad-only",
        thumbnail_url: "https://cdn.example/only.jpg",
        preview: preview({
          image_url: "https://cdn.example/only-modal-different.jpg",
          is_low_res_fallback: true,
        }),
        insights: { spend: 15, impressions: 150, clicks: 3, reach: 100, frequency: 1.5, actions: [] },
      }),
    ],
    { thumbnail: "https://cdn.example/only.jpg", adId: "ad-only" },
  );
});
