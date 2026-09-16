import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { collectTikTokLaunchPreflight } from "../../tiktok/write/preflight.ts";
import { buildTikTokAdPayload } from "../../tiktok/write/mapping.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  applyTikTokCreativeCtaChange,
  isTikTokCallToAction,
  patchTikTokCreativeCta,
  patchTikTokEveryCreativeCta,
  shouldPersistTikTokCreativeCta,
  tikTokCtaOptionsForDraft,
  tikTokCtaRequiredForObjective,
  tikTokCreativeCtaFieldDisabled,
  tikTokCreativeCtaMissingMessage,
  TIKTOK_CALL_TO_ACTIONS,
} from "../creative-cta.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const CREATIVE_A = "creative-a";
const CREATIVE_B = "creative-b";

function relaunch2Draft() {
  const draft = createDefaultTikTokDraft("937e9b11-relaunch-2");
  draft.eventId = "2d5a5485-bfec-4812-9fcc-2f6f89262f6c";
  draft.accountSetup.advertiserId = "advertiser_1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.campaignSetup.campaignName =
    "[IRW0001]  Jamie Jones — On Sale — relaunch 2";
  draft.campaignSetup.objective = "CONVERSIONS";
  draft.campaignSetup.optimisationGoal = "CONVERSION";
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2027-09-01T09:00";
  draft.budgetSchedule.scheduleEndAt = "2027-09-08T09:00";
  draft.budgetSchedule.adGroups = [
    {
      id: "1876044101888049",
      name: "London",
      budget: 50,
      startAt: null,
      endAt: null,
    },
  ];
  draft.creatives.items = [
    {
      id: CREATIVE_A,
      name: "Hero",
      mode: "VIDEO_REFERENCE",
      baseName: "Hero",
      videoId: "video_1",
      videoUrl: null,
      thumbnailUrl: null,
      coverImageId: "img_hero_1",
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: "Ad text",
      displayName: "Off/Pixel",
      landingPageUrl: "https://example.com",
      cta: null,
      musicId: null,
    },
    {
      id: CREATIVE_B,
      name: "Overlay",
      mode: "VIDEO_REFERENCE",
      baseName: "Overlay",
      videoId: "video_2",
      videoUrl: null,
      thumbnailUrl: null,
      coverImageId: "img_hero_2",
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: "Ad text",
      displayName: "Off/Pixel",
      landingPageUrl: "https://example.com",
      cta: null,
      musicId: null,
    },
  ];
  draft.creativeAssignments.byAdGroupId = {
    "1876044101888049": [CREATIVE_A, CREATIVE_B],
  };
  return draft;
}

describe("937e9b11 creative CTA is the value that launches", () => {
  it("setting a CTA on one creative writes only that creative", () => {
    const draft = relaunch2Draft();
    const next = patchTikTokCreativeCta(draft.creatives.items, CREATIVE_A, "LEARN_MORE");
    assert.equal(next[0]?.cta, "LEARN_MORE");
    assert.equal(next[1]?.cta, null);
  });

  it("the set-all action writes every creative and only when called", () => {
    const draft = relaunch2Draft();
    assert.equal(draft.creatives.items[0]?.cta, null);
    const next = patchTikTokEveryCreativeCta(draft.creatives.items, "SHOP_NOW");
    assert.equal(next[0]?.cta, "SHOP_NOW");
    assert.equal(next[1]?.cta, "SHOP_NOW");
    assert.equal(draft.creatives.items[0]?.cta, null);
  });

  it("a creative with a CTA sends call_to_action; one without sends no key", () => {
    const draft = relaunch2Draft();
    const without = buildTikTokAdPayload({
      advertiserId: "advertiser_1",
      adGroupId: "ag-1",
      draft,
      creative: draft.creatives.items[0]!,
    });
    assert.equal(without.ok, true);
    if (!without.ok) return;
    const empty = (without.value.creatives as Array<Record<string, unknown>>)[0];
    assert.equal("call_to_action" in empty!, false);

    const withCta = buildTikTokAdPayload({
      advertiserId: "advertiser_1",
      adGroupId: "ag-1",
      draft,
      creative: { ...draft.creatives.items[0]!, cta: "LEARN_MORE" },
    });
    assert.equal(withCta.ok, true);
    if (!withCta.ok) return;
    const filled = (withCta.value.creatives as Array<Record<string, unknown>>)[0];
    assert.equal(filled?.call_to_action, "LEARN_MORE");
  });

  it("preflight names a creative with no CTA and passes once it has one", () => {
    const draft = relaunch2Draft();
    const blocked = collectTikTokLaunchPreflight(draft);
    const issue = blocked.issues.find((entry) => entry.field === "call_to_action");
    assert.ok(issue);
    assert.match(issue.message, /Hero/);
    assert.equal(
      issue.message,
      tikTokCreativeCtaMissingMessage("Hero"),
    );

    draft.creatives.items = patchTikTokEveryCreativeCta(
      draft.creatives.items,
      "LEARN_MORE",
    );
    const cleared = collectTikTokLaunchPreflight(draft);
    assert.equal(
      cleared.issues.some((entry) => entry.field === "call_to_action"),
      false,
    );
  });
});

describe("TikTok CTA options are the documented enum", () => {
  it("does not invent BUY_TICKETS or DOWNLOAD", () => {
    assert.equal(isTikTokCallToAction("BUY_TICKETS"), false);
    assert.equal(isTikTokCallToAction("DOWNLOAD"), false);
    assert.equal(isTikTokCallToAction("LEARN_MORE"), true);
    assert.equal(isTikTokCallToAction("SHOP_NOW"), true);
    assert.ok(TIKTOK_CALL_TO_ACTIONS.includes("BOOK_NOW"));
    const options = tikTokCtaOptionsForDraft({
      objective: "CONVERSIONS",
      mode: "VIDEO_REFERENCE",
    });
    const values = options.map((option) => option.value);
    assert.equal(values.includes("WATCH_LIVE"), false);
    assert.equal(values.includes("SEND_MESSAGE"), false);
    assert.ok(values.includes("LEARN_MORE"));
    assert.ok(tikTokCtaRequiredForObjective("CONVERSIONS"));
    assert.ok(tikTokCtaRequiredForObjective("TRAFFIC"));
    assert.ok(tikTokCtaRequiredForObjective("LEAD_GENERATION"));
  });
});

describe("Step 5 CTA persist (task #139)", () => {
  it("N change events on a select produce one write each, and the field stays enabled", () => {
    const writes: Array<string | null> = [];
    const persist = (value: string | null) => {
      writes.push(value);
    };
    applyTikTokCreativeCtaChange({ persist }, "blur", "LEARN_MORE");
    applyTikTokCreativeCtaChange({ persist }, "change", "LEARN_MORE");
    applyTikTokCreativeCtaChange({ persist }, "change", "BOOK_NOW");
    assert.deepEqual(writes, ["LEARN_MORE", "BOOK_NOW"]);
    assert.equal(shouldPersistTikTokCreativeCta("change"), true);
    assert.equal(shouldPersistTikTokCreativeCta("blur"), false);
    assert.equal(tikTokCreativeCtaFieldDisabled({ saving: true }), false);
  });

  it("Step 5 rows are wired to persist-on-change and stay enabled while saving", () => {
    // node:test cannot render React in this repo, so this is a grep
    // of the wiring, not coverage of the behaviour. The policy lives on
    // shouldPersistTikTokCreativeCta / applyTikTokCreativeCtaChange.
    const source = readFileSync(
      join(HERE, "../../../components/tiktok-wizard/steps/creatives.tsx"),
      "utf8",
    );
    assert.match(source, /shouldPersistTikTokCreativeCta\("change"\)/);
    assert.match(source, /patchTikTokCreativeCta/);
    assert.match(source, /patchTikTokEveryCreativeCta/);
    assert.match(source, /tikTokCreativeCtaFieldDisabled\(\{ saving \}\)/);
    assert.match(source, /Set every creative/);
    assert.doesNotMatch(source, /item\.cta \?\? "No CTA"/);
  });

  it("the Smart+ linkage box is gone", () => {
    const source = readFileSync(
      join(HERE, "../../../components/tiktok-wizard/steps/campaign-setup.tsx"),
      "utf8",
    );
    assert.equal(source.includes("tiktok-smart-plus-note"), false);
    assert.equal(source.includes("Smart+ can be selected here"), false);
    assert.match(
      source,
      /Smart\+ is set in Step 2\. A Smart\+ draft cannot be launched by this writer\./,
    );
  });
});
