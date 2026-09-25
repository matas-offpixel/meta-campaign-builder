import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultAssetVariation, createDefaultCreative } from "../campaign-defaults.ts";
import {
  CREATIVE_NAME_MAX_LENGTH,
  creativeNameFromFilename,
  META_AD_NAME_LIMIT,
  nameMetaCreativeFromAssets,
  TIKTOK_AD_NAME_LIMIT,
} from "../creative-name-from-filename.ts";
import { nextDuplicateName } from "../duplicate-name.ts";
import { mergeRoutedTikTokCreatives } from "../plan/asset-routing.ts";
import { uniqueTikTokFileName } from "../tiktok/upload.ts";
import { appendUploadedTikTokCreatives } from "../tiktok-wizard/creative-items.ts";
import { createDefaultTikTokDraft } from "../types/tiktok-draft.ts";

/**
 * Mirrors `coverFileName` in lib/tiktok/write/cover-image.ts: sanitise, slice
 * to 80, then `uniqueTikTokFileName`, which appends the uniqueness stamp
 * after that slice. This test must not grow a second naming rule.
 */
function coverFileNameFromCreativeName(creativeName: string, now: number): string {
  const base =
    creativeName.trim().replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") || "cover";
  return uniqueTikTokFileName(`${base.slice(0, 80)}.jpg`, now);
}

describe("creativeNameFromFilename", () => {
  it("strips one extension and leaves the operator's separators", () => {
    assert.equal(
      creativeNameFromFilename("CamelPhat_Ironworks_9x16.mp4", "TikTok creative"),
      "CamelPhat_Ironworks_9x16",
    );
  });

  it("falls back when the stem is empty", () => {
    assert.equal(creativeNameFromFilename(".mp4", "TikTok creative"), "TikTok creative");
    assert.equal(creativeNameFromFilename(".mp4", "Ad 1"), "Ad 1");
  });

  it("caps below the lower of the Meta and TikTok ad-name limits", () => {
    assert.ok(CREATIVE_NAME_MAX_LENGTH < META_AD_NAME_LIMIT);
    assert.ok(CREATIVE_NAME_MAX_LENGTH < TIKTOK_AD_NAME_LIMIT);
    assert.equal(CREATIVE_NAME_MAX_LENGTH, Math.min(META_AD_NAME_LIMIT, TIKTOK_AD_NAME_LIMIT) - 1);
    const under = creativeNameFromFilename(`${"a".repeat(300)}.mp4`, "TikTok creative");
    assert.equal(under.length, 300);
    const over = creativeNameFromFilename(`${"a".repeat(500)}.mp4`, "TikTok creative");
    assert.equal(over.length, CREATIVE_NAME_MAX_LENGTH);
  });

  it("keeps #975's cover uniqueness stamp outside the 80-character slice", () => {
    const name = creativeNameFromFilename(`${"b".repeat(300)}.mp4`, "TikTok creative");
    assert.equal(name.length, 300);
    const now = 1_700_000_000_000;
    const stamp = now.toString(36);
    const cover = coverFileNameFromCreativeName(name, now);
    const again = coverFileNameFromCreativeName(name, now + 1);
    assert.ok(cover.endsWith(`-${stamp}.jpg`));
    assert.ok(cover.length <= 100);
    assert.notEqual(cover, again);
    assert.ok(again.endsWith(`-${(now + 1).toString(36)}.jpg`));
  });

  it("names the canvas creative and the wizard creative with the same helper", () => {
    const filename = "CamelPhat_Ironworks_9x16.mp4";
    const expected = creativeNameFromFilename(filename, "TikTok creative");

    const routed = mergeRoutedTikTokCreatives({
      draft: createDefaultTikTokDraft("tt-1"),
      routed: [
        {
          assetId: "a1",
          videoId: "tt_1",
          filename,
          thumbnailUrl: null,
          durationSeconds: 12,
          adText: "Book",
          landingPageUrl: "https://tickets.example.com",
        },
      ],
      launched: false,
    });
    const canvas = routed.draft.creatives.items.find((item) => item.videoId === "tt_1");
    assert.equal(canvas?.name, expected);

    const wizard = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [{ videoId: "v1", thumbnailUrl: null, durationSeconds: 12, fileName: filename }],
      baseName: "TikTok creative",
      adText: "Book",
      displayName: "Brand",
      landingPageUrl: "https://tickets.example.com",
      cta: "LEARN_MORE",
      newId: () => "id-1",
    });
    assert.equal(wizard[0]?.name, expected);
    assert.equal(wizard[0]?.name, canvas?.name);
  });
});

describe("nameMetaCreativeFromAssets", () => {
  it("sets the creative name from the uploaded file and leaves a typed name", () => {
    const creative = createDefaultCreative();
    creative.name = "Ad 1";
    creative.assetVariations[0]!.assets[0]!.fileName = "CamelPhat_Ironworks_9x16.mp4";
    const named = nameMetaCreativeFromAssets(creative);
    assert.equal(named.name, "CamelPhat_Ironworks_9x16");
    assert.equal(
      named.name,
      creativeNameFromFilename("CamelPhat_Ironworks_9x16.mp4", "TikTok creative"),
    );

    const typed = nameMetaCreativeFromAssets({ ...named, name: "Operator cut" });
    assert.equal(typed.name, "Operator cut");
  });

  it("keeps today's name when no asset has a fileName", () => {
    const creative = createDefaultCreative();
    creative.name = "Ad 4";
    assert.equal(nameMetaCreativeFromAssets(creative).name, "Ad 4");
    assert.equal(nameMetaCreativeFromAssets(creative), creative);
  });

  it("names a 4:5 and 9:16 pair once, from the 4:5 slot", () => {
    const creative = createDefaultCreative();
    creative.name = "Ad 1";
    creative.assetMode = "dual";
    const variation = createDefaultAssetVariation(["4:5", "9:16"]);
    variation.assets[0]!.fileName = "cut_4x5.mp4";
    variation.assets[1]!.fileName = "cut_9x16.mp4";
    creative.assetVariations = [variation];
    const named = nameMetaCreativeFromAssets(creative);
    assert.equal(named.name, "cut_4x5");
    assert.equal(named.assetVariations.length, 1);
    assert.deepEqual(
      named.assetVariations[0]!.assets.map((asset) => asset.fileName),
      ["cut_4x5.mp4", "cut_9x16.mp4"],
    );
  });

  it("does not change duplicate naming", () => {
    assert.equal(nextDuplicateName("Operator cut", ["Operator cut"]), "Operator cut 2");
  });
});
