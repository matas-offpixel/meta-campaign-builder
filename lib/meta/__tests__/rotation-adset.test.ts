/**
 * A rotation creative (Single mode, 2+ variations) makes its ad set dynamic,
 * and Meta allows one ad there (subcode 1885553).
 *
 * Run: node --test.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { validateStep } from "../../validation.ts";
import { creativeLaunchPath } from "../creative.ts";
import {
  ROTATION_HAS_AD_MESSAGE,
  ROTATION_NOT_DYNAMIC_MESSAGE,
  ROTATION_SHARE_MESSAGE,
  bulkAttachRotationMessage,
  dynamicAdSetIdsForDraft,
  existingRotationRefusal,
  rotationAssignmentErrors,
  rotationShareRefusal,
} from "../rotation-adset.ts";
import { splitRotationOntoOwnAdSet } from "../../wizard/split-rotation-adset.ts";
import type { AdCreativeDraft, AdSetSuggestion, CampaignDraft } from "../../types.ts";

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

function creative(id: string, variations: number): AdCreativeDraft {
  return {
    id,
    name: id,
    sourceType: "new",
    mediaType: "image",
    assetMode: "single",
    identity: { pageId: "pg", instagramAccountId: "" },
    assetVariations: Array.from({ length: variations }, (_, i) => ({
      id: `${id}-v${i}`,
      name: `Variation ${i + 1}`,
      assets: [
        { id: `${id}-a${i}`, aspectRatio: "9:16" as const, uploadStatus: "uploaded" as const, assetHash: `h${i}` },
      ],
    })),
    captions: [{ id: "c", text: "On sale" }],
    headline: "Show",
    description: "",
    destinationUrl: "https://example.com",
    cta: "book_now",
    rotateVariations: true,
    enhancements: enhancementsOff,
  };
}

function adSet(id: string, name: string): AdSetSuggestion {
  return {
    id,
    name,
    sourceType: "blank",
    sourceId: "",
    sourceName: "",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 5,
    advantagePlus: true,
    enabled: true,
  };
}

function draftWith(creatives: AdCreativeDraft[], assignments: Record<string, string[]>): CampaignDraft {
  const draft = createDefaultDraft();
  draft.creatives = creatives;
  draft.adSetSuggestions = [adSet("as-broad", "Broad")];
  draft.creativeAssignments = assignments;
  return draft;
}

describe("rotation creative sharing an ad set", () => {
  it("blocks Continue", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const draft = draftWith(
      [creative("rotation", 2), creative("static", 1)],
      { "as-broad": ["rotation", "static"] },
    );
    const result = validateStep(6, draft);
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, [ROTATION_SHARE_MESSAGE]);
    assert.equal(rotationShareRefusal(draft)?.startsWith(ROTATION_SHARE_MESSAGE), true);
    assert.deepEqual(dynamicAdSetIdsForDraft(draft), []);
  });

  it("after the split, the rotation creative's ad set is the dynamic one", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const draft = draftWith(
      [creative("rotation", 2), creative("static", 1)],
      { "as-broad": ["rotation", "static"] },
    );
    const next = splitRotationOntoOwnAdSet({
      adSets: draft.adSetSuggestions,
      assignments: draft.creativeAssignments,
      adSetId: "as-broad",
      creativeId: "rotation",
      creativeName: "rotation",
      newId: "as-rotation",
    });
    draft.adSetSuggestions = next.adSets;
    draft.creativeAssignments = next.assignments;

    assert.deepEqual(validateStep(6, draft), { valid: true, errors: [] });
    assert.equal(draft.adSetSuggestions[1]?.name, "Broad — rotation");
    assert.deepEqual(draft.creativeAssignments["as-broad"], ["static"]);
    assert.deepEqual(draft.creativeAssignments["as-rotation"], ["rotation"]);
    assert.deepEqual(dynamicAdSetIdsForDraft(draft), ["as-rotation"]);
    assert.equal(rotationShareRefusal(draft), null);
  });

  it("a rotation creative on its own is not a share", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const draft = draftWith([creative("rotation", 2)], { "as-broad": ["rotation"] });
    assert.deepEqual(rotationAssignmentErrors(draft), []);
    assert.deepEqual(dynamicAdSetIdsForDraft(draft), ["as-broad"]);
  });
});

describe("attach into an existing ad set", () => {
  const rotation = () => creative("rotation", 2);

  it("blocks a non-dynamic ad set", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const message = existingRotationRefusal(
      [{ metaId: "120", name: "Broad", creativeIds: ["rotation"] }],
      [rotation()],
      new Map([["120", { isDynamicCreative: false, adCount: 0 }]]),
    );
    assert.equal(message?.includes(ROTATION_NOT_DYNAMIC_MESSAGE), true);
  });

  it("blocks a dynamic ad set that already has an ad", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const message = existingRotationRefusal(
      [{ metaId: "120", name: "Broad", creativeIds: ["rotation"] }],
      [rotation()],
      new Map([["120", { isDynamicCreative: true, adCount: 1 }]]),
    );
    assert.equal(message?.includes(ROTATION_HAS_AD_MESSAGE), true);
  });

  it("allows a dynamic ad set with no ads when it is the only creative", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const message = existingRotationRefusal(
      [{ metaId: "120", name: "Broad", creativeIds: ["rotation"] }],
      [rotation()],
      new Map([["120", { isDynamicCreative: true, adCount: 0 }]]),
    );
    assert.equal(message, null);
  });

  it("the assign step blocks attach_adset before the live read", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    const draft = createDefaultDraft();
    draft.settings.wizardMode = "attach_adset";
    draft.settings.existingMetaAdSets = [
      { id: "120", name: "Broad", campaignId: "cmp", status: "ACTIVE", capturedAt: "2026-10-09T00:00:00Z" },
    ];
    draft.creatives = [creative("rotation", 2)];
    draft.creativeAssignments = { "attached:120": ["rotation"] };
    const result = validateStep(6, draft);
    assert.equal(result.valid, false);
    assert.ok(result.errors.includes(ROTATION_NOT_DYNAMIC_MESSAGE));
  });
});

describe("bulk-attach", () => {
  it("refuses a rotation creative plus another creative with no live read", () => {
    process.env.ENABLE_MULTI_PLACEMENT_ASSETS = "1";
    assert.equal(
      bulkAttachRotationMessage([creative("rotation", 2), creative("static", 1)], ["120"], null),
      ROTATION_SHARE_MESSAGE,
    );
  });
});

describe("launch path log", () => {
  it("names a rotation payload variation_rotation", () => {
    assert.equal(
      creativeLaunchPath({ name: "ad", asset_feed_spec: { images: [{ hash: "h" }] } }),
      "variation_rotation",
    );
    assert.equal(
      creativeLaunchPath({
        name: "ad",
        asset_feed_spec: { asset_customization_rules: [{ customization_spec: {} }] },
      }),
      "multi_placement",
    );
    assert.equal(creativeLaunchPath({ name: "ad", object_story_spec: { page_id: "p" } }), "single_asset");
  });
});

describe("assign step renders the block and the split button", () => {
  it("shows the message and Give it its own ad set", () => {
    const root = join(import.meta.dirname, "../../..");
    const out = execFileSync(
      process.execPath,
      ["--import", "tsx", join(import.meta.dirname, "render-rotation-adset.tsx")],
      { cwd: root, encoding: "utf8", env: { ...process.env, ENABLE_MULTI_PLACEMENT_ASSETS: "1" } },
    );
    assert.ok(out.includes(ROTATION_SHARE_MESSAGE), out.slice(-400));
    assert.ok(out.includes("Give it its own ad set"));
    assert.ok(out.includes('role="alert"'));
  });
});

describe("launch preflight is before any Meta call", () => {
  it("the share refusal returns before the campaign create and before the live ad set read", () => {
    const source = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const share = source.indexOf("if (rotationShare)");
    const accountRead = source.indexOf("await foreignAccountLaunchError(");
    const create = source.indexOf("createMetaCampaign(campaignPayload)");
    const liveRead = source.indexOf("fetchAdSetGuardInfo(attachAdSetIds");
    assert.ok(share > 0, "share refusal missing");
    assert.ok(accountRead > share, "account Graph read runs before the share refusal");
    assert.ok(create > share, "campaign create runs before the share refusal");
    assert.ok(liveRead > share, "live ad set read runs before the share refusal");
    assert.equal(source.includes('path: isMultiPlacement ? "multi_placement" : "single_asset"'), false);
    assert.ok(source.includes("creativeLaunchPath(creativePayload)"));
  });
});
