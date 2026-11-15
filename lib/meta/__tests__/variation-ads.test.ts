/**
 * Variations launch as one normal ad each. Rotation is the opt-in.
 *
 * Run: node --test.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { migrateDraft } from "../../autosave.ts";
import { validateStep } from "../../validation.ts";
import { buildCreativePayload, creativeTriggersVariationRotation } from "../creative.ts";
import { dynamicAdSetIdsForDraft, rotationShareRefusal } from "../rotation-adset.ts";
import {
  META_ADS_PER_AD_SET_LIMIT,
  adSetAdLimitMessage,
  adsThisCreativeLaunches,
  expandCreativesForLaunch,
  expandVariationAds,
  firstExistingPostByAdSet,
  variationLaunchName,
} from "../variation-ads.ts";
import type { AdCreativeDraft, AssetVariation } from "../../types.ts";

const ORIG_FLAG = process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.ENABLE_MULTI_PLACEMENT_ASSETS;
  else process.env.ENABLE_MULTI_PLACEMENT_ASSETS = ORIG_FLAG;
});

const enhancementsOff = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function imageVariation(id: string, hash: string, ratios: Array<"9:16" | "4:5"> = ["9:16"]): AssetVariation {
  return {
    id,
    name: id,
    assets: ratios.map((aspectRatio) => ({
      id: `${id}-${aspectRatio}`,
      aspectRatio,
      uploadStatus: "uploaded" as const,
      assetHash: `${hash}-${aspectRatio}`,
    })),
  };
}

function creative(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "poster",
    name: "Poster",
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg", instagramAccountId: "" },
    assetVariations: [
      imageVariation("v1", "h1"),
      imageVariation("v2", "h2"),
      imageVariation("v3", "h3"),
    ],
    captions: [{ id: "c", text: "On sale" }],
    headline: "Show",
    description: "",
    destinationUrl: "https://example.com",
    cta: "book_now",
    rotateVariations: false,
    enhancements: enhancementsOff,
    ...overrides,
  };
}

describe("toggle off — one ad per variation", () => {
  it("3 variations become 3 single-asset ads, in a new campaign and in attach", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const source = creative();
    assert.equal(adsThisCreativeLaunches(source), 3);
    assert.equal(creativeTriggersVariationRotation(source), false);

    const expanded = expandVariationAds([source, creative({ id: "static", name: "Static", assetVariations: [imageVariation("s", "hs")] })], {
      "as-broad": ["poster", "static"],
      "attached:120": ["poster"],
    });
    assert.deepEqual(
      expanded.creatives.map((c) => c.name),
      ["Poster — V1", "Poster — V2", "Poster — V3", "Static"],
    );
    assert.deepEqual(expanded.assignments["as-broad"], ["poster:v1", "poster:v2", "poster:v3", "static"]);
    assert.deepEqual(expanded.assignments["attached:120"], ["poster:v1", "poster:v2", "poster:v3"]);
    assert.equal(variationLaunchName("Poster", 2), "Poster — V2");

    for (const [index, slice] of expanded.creatives.slice(0, 3).entries()) {
      const payload = await buildCreativePayload(slice);
      assert.equal(payload.asset_feed_spec, undefined, slice.name);
      assert.equal(payload.object_story_spec?.link_data?.image_hash, `h${index + 1}-9:16`);
      assert.equal(payload.object_story_spec?.link_data?.call_to_action?.type, "BOOK_NOW");
    }

    const draft = createDefaultDraft();
    draft.creatives = [source];
    draft.adSetSuggestions = [{
      id: "as-broad",
      name: "Broad",
      sourceType: "blank",
      sourceId: "",
      sourceName: "",
      ageMin: 18,
      ageMax: 65,
      budgetPerDay: 5,
      advantagePlus: true,
      enabled: true,
    }];
    draft.creativeAssignments = { "as-broad": ["poster"] };
    assert.deepEqual(dynamicAdSetIdsForDraft(draft), []);
    assert.equal(rotationShareRefusal(draft), null);

    draft.settings.wizardMode = "attach_adset";
    draft.settings.existingMetaAdSets = [
      { id: "120", name: "Broad", campaignId: "cmp", status: "ACTIVE", capturedAt: "2026-10-09T00:00:00Z" },
    ];
    draft.creativeAssignments = { "attached:120": ["poster"] };
    assert.equal(validateStep(6, draft).errors.includes(
      "Ads with several variations can't go into this ad set. Meta can't switch an existing ad set to dynamic.",
    ), false);
  });

  it("a variation with Feed and 9:16 uses the multi-placement path and BOOK_TRAVEL", async () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const source = creative({
      assetMode: "dual",
      assetVariations: [
        imageVariation("v1", "h1", ["4:5", "9:16"]),
        imageVariation("v2", "h2", ["4:5", "9:16"]),
      ],
    });
    const slices = expandCreativesForLaunch([source]);
    assert.equal(slices.length, 2);
    const payload = await buildCreativePayload(slices[1]!);
    assert.equal(payload.asset_feed_spec?.call_to_action_types?.[0], "BOOK_TRAVEL");
    assert.ok((payload.asset_feed_spec?.asset_customization_rules?.length ?? 0) >= 2);
    assert.deepEqual(
      (payload.asset_feed_spec?.images ?? []).map((image) => image.hash).sort(),
      ["h2-4:5", "h2-9:16"],
    );
  });
});

describe("toggle on — #1049 rotation", () => {
  it("stays one dynamic ad and cannot share or attach", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const source = creative({ rotateVariations: true });
    assert.equal(adsThisCreativeLaunches(source), 1);
    assert.equal(expandCreativesForLaunch([source]).length, 1);
    assert.equal(creativeTriggersVariationRotation(source), true);

    const draft = createDefaultDraft();
    draft.creatives = [source, creative({ id: "static", name: "Static", assetVariations: [imageVariation("s", "hs")] })];
    draft.adSetSuggestions = [{
      id: "as-broad",
      name: "Broad",
      sourceType: "blank",
      sourceId: "",
      sourceName: "",
      ageMin: 18,
      ageMax: 65,
      budgetPerDay: 5,
      advantagePlus: true,
      enabled: true,
    }];
    draft.creativeAssignments = { "as-broad": ["poster", "static"] };
    assert.equal(rotationShareRefusal(draft)?.includes("need their own ad set"), true);
    assert.deepEqual(dynamicAdSetIdsForDraft(draft), []);

    draft.creatives = [source];
    draft.creativeAssignments = { "as-broad": ["poster"] };
    assert.deepEqual(dynamicAdSetIdsForDraft(draft), ["as-broad"]);
  });
});

describe("migrateDraft", () => {
  it("defaults rotateVariations to false and keeps an explicit true", () => {
    const missing = migrateDraft({
      id: "d",
      settings: { campaignName: "C", objective: "purchase" },
      creatives: [{ id: "c", name: "Poster" }],
    });
    assert.equal(missing.creatives[0]?.rotateVariations, false);

    const opted = migrateDraft({
      id: "d",
      settings: { campaignName: "C", objective: "purchase" },
      creatives: [{ id: "c", name: "Poster", rotateVariations: true }],
    });
    assert.equal(opted.creatives[0]?.rotateVariations, true);
  });
});

describe("ad set ad limit", () => {
  it("blocks only when existing ads plus the new ones would pass 50", () => {
    assert.equal(
      adSetAdLimitMessage([{ name: "Broad", existingAds: 0, newAds: 3 }]),
      null,
    );
    assert.equal(
      adSetAdLimitMessage([{ name: "Broad", existingAds: 47, newAds: 3 }]),
      null,
    );
    const over = adSetAdLimitMessage([{ name: "Broad", existingAds: 48, newAds: 3 }]);
    assert.equal(over?.includes("51"), true);
    assert.equal(over?.includes(String(META_ADS_PER_AD_SET_LIMIT)), true);
    assert.equal(
      adSetAdLimitMessage([{ name: "Broad", existingAds: 0, newAds: 51 }])?.includes("51"),
      true,
    );
  });
});

describe("existing-post assignment map", () => {
  it("reads ad set id → creative ids", () => {
    const post = creative({
      id: "post",
      name: "Post",
      sourceType: "existing_post",
      assetVariations: [],
      existingPost: { source: "facebook", postId: "pg_1" },
    });
    const other = creative({ id: "other", name: "Other", assetVariations: [imageVariation("s", "hs")] });
    const map = firstExistingPostByAdSet({ "as-1": ["post", "other"] }, [post, other]);
    assert.equal(map.get("as-1")?.id, "post");
    assert.equal(map.has("post"), false);
  });
});

describe("creatives step toggle", () => {
  it("shows the opt-in only for a single-mode creative with 2 or more variations", () => {
    const root = join(import.meta.dirname, "../../..");
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "render-variation-toggle.tsx")],
      { cwd: root, encoding: "utf8" },
    );
    const flags = JSON.parse(out.trim().split("\n").pop()!) as {
      shown: boolean;
      hiddenOne: boolean;
      hiddenDual: boolean;
      hiddenPost: boolean;
    };
    assert.equal(flags.shown, true);
    assert.equal(flags.hiddenOne, false);
    assert.equal(flags.hiddenDual, false);
    assert.equal(flags.hiddenPost, false);
  });
});

describe("launch route uses the expanded creatives and the corrected map", () => {
  it("expands before the campaign create, and the existing-post map is not inverted", () => {
    const source = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const expand = source.indexOf("expandVariationAds(launchCreatives");
    const create = source.indexOf("createMetaCampaign(campaignPayload)");
    assert.ok(expand > 0 && create > expand, "expansion runs before the campaign create");
    assert.equal(source.includes("firstExistingPostByAdSet(launchAssignments, launchCreatives)"), true);
    assert.equal(
      /for \(const \[creativeId, adSetIds\] of Object\.entries\(draft\.creativeAssignments/.test(source),
      false,
    );
    assert.equal(source.includes("invertAssignments(launchAssignments)"), true);
  });
});
