/**
 * Regression test for task #93 — the main wizard's Step 4 (Creatives) /
 * Step 7 (Review & Launch) did not hard-block a Dual/Full mode creative
 * using CTA=BOOK_NOW, unlike the bulk-attach Configure Creatives step
 * (PR #574/#575/#719). The inline warning banner in
 * components/steps/creatives.tsx said "Can't launch" but nothing actually
 * blocked "Continue" or "Launch" — Meta silently drops the Feed asset
 * (subcode 1885396) instead. This closes that gap by wiring
 * `creativeHasBookNowMultiPlacementConflict` into `validateCreatives`.
 *
 * Byte-diffs the exact `errors` array for a Dual mode + BOOK_NOW creative
 * against the same creative with a non-BOOK_NOW CTA, to prove the CTA is
 * the only variable that flips `valid`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateStep } from "../validation.ts";
import { createDefaultDraft } from "../campaign-defaults.ts";
import type { AdCreativeDraft, AssetVariation, CampaignDraft } from "../types.ts";

const baseEnhancements = {
  enabled: false,
  textOptimizations: false,
  visualEnhancements: false,
  musicEnhancements: false,
  autoVariations: false,
} as const;

function dualVariation(id: string, feedHash: string, verticalHash: string): AssetVariation {
  return {
    id,
    name: id,
    assets: [
      { id: `${id}_45`, aspectRatio: "4:5", uploadStatus: "uploaded", assetHash: feedHash },
      { id: `${id}_916`, aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: verticalHash },
    ],
  };
}

function dualModeCreative(overrides: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "cr_book_now_dual",
    name: "WC26 Retarget",
    sourceType: "new",
    mediaType: "image",
    assetMode: "dual",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [dualVariation("v1", "feed_hash", "vert_hash")],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Buy tickets now",
    description: "Limited availability",
    destinationUrl: "https://example.com/tickets",
    cta: "book_now",
    enhancements: baseEnhancements,
    ...overrides,
  };
}

function draftWithCreative(creative: AdCreativeDraft): CampaignDraft {
  const draft = createDefaultDraft();
  draft.creatives = [creative];
  return draft;
}

describe("validateStep(4) — BOOK_NOW multi-placement hard block (task #93)", () => {
  it("is invalid with exactly the BOOK_NOW conflict message for a Dual mode + BOOK_NOW creative", () => {
    const draft = draftWithCreative(dualModeCreative());
    const result = validateStep(4, draft);

    assert.deepEqual(result, {
      valid: false,
      errors: [
        `"WC26 Retarget": Can't launch with "Book Now" CTA across multiple asset placements — switch CTA to Buy Tickets (or another non-Book Now CTA) to preserve per-placement asset routing`,
      ],
    });
  });

  it("is valid (no errors at all) for the identical creative with CTA switched to Buy Tickets", () => {
    const draft = draftWithCreative(dualModeCreative({ cta: "buy_tickets" }));
    const result = validateStep(4, draft);

    assert.deepEqual(result, { valid: true, errors: [] });
  });

  it("is valid for the identical creative switched to Single asset mode (no multi-placement conflict possible)", () => {
    const draft = draftWithCreative(
      dualModeCreative({
        assetMode: "single",
        assetVariations: [
          {
            id: "v1",
            name: "v1",
            assets: [{ id: "v1_916", aspectRatio: "9:16", uploadStatus: "uploaded", assetHash: "vert_hash" }],
          },
        ],
      }),
    );
    const result = validateStep(4, draft);

    assert.deepEqual(result, { valid: true, errors: [] });
  });

  it("surfaces through validateStep(7) review aggregation too, so Launch is blocked without extra wiring", () => {
    const draft = draftWithCreative(dualModeCreative());
    // Review step needs an ad account + campaign name to isolate this one
    // failure from unrelated required-field errors elsewhere in the wizard.
    draft.settings.metaAdAccountId = "act_123";
    draft.settings.campaignName = "WC26 Retarget Campaign";
    draft.settings.campaignCode = "WC26-RT";
    draft.audiences.pageGroups = [{ id: "pg1", name: "Group 1", pageIds: ["pg_123"] }];
    draft.budgetSchedule.startDate = "2026-08-01";
    draft.budgetSchedule.endDate = "2026-08-31";
    draft.adSetSuggestions = [
      { id: "as_1", name: "Ad set 1", enabled: true, budget: 50, targeting: {} } as CampaignDraft["adSetSuggestions"][number],
    ];
    draft.creativeAssignments = { as_1: ["cr_book_now_dual"] };

    const result = validateStep(7, draft);
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes("Can't launch with \"Book Now\" CTA")),
      `expected review errors to include the BOOK_NOW conflict message, got: ${JSON.stringify(result.errors)}`,
    );
  });
});
