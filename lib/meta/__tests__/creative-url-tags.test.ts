import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";

import { buildCreativePayload, sanitizeCreativeForStrictMode } from "../creative.ts";
import { URL_TAGS } from "../url-tags.ts";
import type { AdCreativeDraft, AssetVariation } from "../../types.ts";

const TAGGED_LITERAL =
  "utm_source=meta&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{adset.id}}&utm_term={{ad.id}}";
const DEST = "https://crqln.com/adam-ten-london";
const DEST_WITH_UTM = "https://crqln.com/adam-ten-london?utm_source=newsletter";

function creative(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "cr",
    name: "Adam Ten — Feed",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "835830913221115", instagramAccountId: "" },
    assetVariations: [image("v1", "hash_1")],
    captions: [{ id: "c1", text: "Sign up for presale" }],
    headline: "Adam Ten",
    description: "London",
    destinationUrl: DEST,
    cta: "sign_up",
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
    ...overrides,
  };
}

function image(id: string, hash: string, aspectRatio: "9:16" | "4:5" = "9:16"): AssetVariation {
  return { id, name: id, assets: [{ id: `${id}_a`, aspectRatio, uploadStatus: "uploaded", assetHash: hash }] };
}

const SHAPES: Record<string, () => AdCreativeDraft> = {
  "image link_data": () => creative(),
  video_data: () =>
    creative({
      mediaType: "video",
      assetVariations: [
        {
          id: "v1",
          name: "v1",
          assets: [{
            id: "a",
            aspectRatio: "9:16",
            uploadStatus: "uploaded",
            videoId: "vid_1",
            thumbnailUrl: "https://cdn/t.jpg",
          }],
        },
      ],
    }),
  "asset_feed_spec rotation": () => creative({ assetVariations: [image("v1", "hash_1"), image("v2", "hash_2")] }),
  "asset_feed_spec multi-placement": () =>
    creative({
      assetMode: "dual",
      assetVariations: [
        {
          id: "v1",
          name: "v1",
          assets: [
            { id: "f", aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: "hash_45" },
            { id: "s", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "hash_916" },
          ],
        },
      ],
    }),
  "existing_post instagram": () =>
    creative({
      sourceType: "existing_post",
      assetVariations: [],
      cta: "buy_tickets",
      existingPost: {
        source: "instagram",
        postId: "18149952778529453",
        instagramAccountId: "17841401050136820",
        mediaKind: "video",
      },
    }),
  "existing_post facebook": () =>
    creative({
      sourceType: "existing_post",
      assetVariations: [],
      cta: "buy_tickets",
      existingPost: { source: "facebook", postId: "111_222", mediaKind: "video" },
    }),
};

const EXPECTED_SHAPE: Record<string, (p: Awaited<ReturnType<typeof buildCreativePayload>>) => boolean> = {
  "image link_data": (p) => !!p.object_story_spec?.link_data?.image_hash,
  video_data: (p) => p.object_story_spec?.video_data?.video_id === "vid_1",
  "asset_feed_spec rotation": (p) =>
    (p.asset_feed_spec?.images?.length ?? 0) === 2 && !p.asset_feed_spec?.asset_customization_rules,
  "asset_feed_spec multi-placement": (p) => (p.asset_feed_spec?.asset_customization_rules?.length ?? 0) >= 2,
  "existing_post instagram": (p) => p.source_instagram_media_id === "18149952778529453",
  "existing_post facebook": (p) => p.object_story_id === "111_222",
};

const ORIG_FLAG = process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
  else process.env.ENABLE_MULTI_PLACEMENT_ASSETS = ORIG_FLAG;
});

describe("buildCreativePayload url_tags", () => {
  for (const [shape, make] of Object.entries(SHAPES)) {
    it(`${shape}: carries the exact tag string`, async () => {
      process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
      const payload = await buildCreativePayload(make());
      assert.ok(EXPECTED_SHAPE[shape](payload), `fixture builds the ${shape} shape`);
      assert.equal(payload.url_tags, TAGGED_LITERAL);
      assert.equal(payload.url_tags, URL_TAGS);
    });

    it(`${shape}: omits url_tags when the destination URL has its own utm`, async () => {
      process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
      const payload = await buildCreativePayload({ ...make(), destinationUrl: DEST_WITH_UTM });
      assert.ok(EXPECTED_SHAPE[shape](payload), `fixture builds the ${shape} shape`);
      assert.ok(!("url_tags" in payload), "no url_tags key at all");
    });
  }

  it("survives the strict-mode sanitizer", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    for (const make of Object.values(SHAPES)) {
      const payload = await buildCreativePayload(make());
      sanitizeCreativeForStrictMode(payload);
      assert.equal(payload.url_tags, TAGGED_LITERAL);
    }
  });

  it("does not move the destination link — Meta appends the tags itself", async () => {
    const payload = await buildCreativePayload(creative());
    assert.equal(payload.object_story_spec?.link_data?.link, DEST);
  });

  it("reaches the wire with the macros literal (JSON body, not URL-encoded)", async () => {
    const payload = await buildCreativePayload(creative());
    const wire = JSON.stringify(payload);
    assert.ok(wire.includes(`"url_tags":"${TAGGED_LITERAL}"`));
    assert.ok(!wire.includes("%7B"), "no percent-encoded braces");

    const client = readFileSync(new URL("../client.ts", import.meta.url), "utf8");
    const post = client.slice(
      client.indexOf("export async function graphPostWithToken"),
      client.indexOf("async function graphPost<T>"),
    );
    assert.match(post, /"Content-Type": "application\/json"/);
    assert.match(post, /body: JSON\.stringify\(body\)/);
  });
});
