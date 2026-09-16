import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { collectTikTokLaunchPreflight } from "../../tiktok/write/preflight.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { reconcileTikTokAdGroups } from "../ad-group-reconcile.ts";
import {
  applyTikTokAdGroupBudgetChange,
  parseTikTokAdGroupBudgetInput,
  patchTikTokAdGroupBudget,
  persistTikTokAdGroupBudgetPatch,
  shouldPersistTikTokAdGroupBudget,
  shouldSkipDuplicateTikTokAdGroupBudgetPayload,
  tikTokAdGroupBudgetDiffersFromCampaign,
  tikTokAdGroupBudgetFieldDisabled,
  tikTokAdGroupBudgetFloorLine,
  tikTokAdGroupBudgetIssue,
  tikTokAdGroupMatchCampaignLine,
} from "../ad-group-budget.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const LONDON_ID = "1876044101888049";
const OTHER_ID = "1876044101888050";

function relaunch2Draft() {
  const draft = createDefaultTikTokDraft("937e9b11-relaunch-2");
  draft.eventId = "2d5a5485-bfec-4812-9fcc-2f6f89262f6c";
  draft.accountSetup.advertiserId = "advertiser_1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "Europe/London";
  draft.campaignSetup.campaignName =
    "[IRW0001]  Jamie Jones — On Sale — relaunch 2";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.dailyBudget = 50;
  draft.budgetSchedule.scheduleStartAt = "2027-09-01T09:00";
  draft.budgetSchedule.scheduleEndAt = "2027-09-08T09:00";
  draft.budgetSchedule.adGroups = [
    {
      id: LONDON_ID,
      name: "London",
      budget: 30,
      startAt: null,
      endAt: null,
    },
  ];
  draft.audiences.interestGroups = [];
  draft.creatives.items = [
    {
      id: "creative-1",
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
      cta: "LEARN_MORE",
      musicId: null,
    },
  ];
  draft.creativeAssignments.byAdGroupId = { [LONDON_ID]: ["creative-1"] };
  return draft;
}

describe("937e9b11 ad-group budget is the number that blocks", () => {
  it("editing the ad group to 50 clears adgroup-budget-* and leaves budgetAmount", () => {
    const draft = relaunch2Draft();
    const blocked = collectTikTokLaunchPreflight(draft);
    assert.ok(tikTokAdGroupBudgetIssue(blocked.issues, LONDON_ID));
    assert.match(
      tikTokAdGroupBudgetIssue(blocked.issues, LONDON_ID)!.message,
      /below TikTok's GBP minimum of 50/,
    );
    assert.equal(
      blocked.issues.some((issue) => issue.id === `adgroup-${LONDON_ID}-budget`),
      false,
      "payload must not emit a second budget issue for the same ad group",
    );
    assert.equal(
      blocked.issues.some((issue) => /\(\d+ ad groups\)/.test(issue.message)),
      false,
    );

    draft.budgetSchedule = persistTikTokAdGroupBudgetPatch(
      draft.budgetSchedule,
      LONDON_ID,
      50,
    );
    const cleared = collectTikTokLaunchPreflight(draft);
    assert.equal(tikTokAdGroupBudgetIssue(cleared.issues, LONDON_ID), undefined);
    assert.equal(
      cleared.issues.some((issue) => issue.id.startsWith("adgroup-budget-")),
      false,
    );
    assert.equal(draft.budgetSchedule.budgetAmount, 50);
    assert.equal(draft.budgetSchedule.dailyBudget, 50);
  });

  it("an ad group at exactly the floor passes; one a penny under does not", () => {
    const atFloor = relaunch2Draft();
    atFloor.budgetSchedule.adGroups[0]!.budget = 50;
    assert.equal(
      tikTokAdGroupBudgetIssue(
        collectTikTokLaunchPreflight(atFloor).issues,
        LONDON_ID,
      ),
      undefined,
    );

    const under = relaunch2Draft();
    under.budgetSchedule.adGroups[0]!.budget = 49.99;
    const issue = tikTokAdGroupBudgetIssue(
      collectTikTokLaunchPreflight(under).issues,
      LONDON_ID,
    );
    assert.ok(issue);
    assert.match(issue.message, /49\.99/);
  });

  it("a currency with no documented floor does not block on amount", () => {
    const draft = relaunch2Draft();
    draft.accountSetup.currency = "EUR";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(tikTokAdGroupBudgetIssue(result.issues, LONDON_ID), undefined);
    assert.equal(
      result.issues.some((issue) => issue.id.startsWith("adgroup-budget-")),
      false,
    );
    assert.equal(
      tikTokAdGroupBudgetFloorLine({
        budgetMode: "DAILY",
        startAt: draft.budgetSchedule.scheduleStartAt,
        endAt: draft.budgetSchedule.scheduleEndAt,
        currency: "EUR",
      }),
      "No TikTok minimum is documented for EUR — preflight will not block on amount",
    );
  });

  it("raising budgetAmount alone does not change any ad group's budget", () => {
    const draft = relaunch2Draft();
    const patched = {
      ...draft.budgetSchedule,
      budgetAmount: 80,
      dailyBudget: 80,
    };
    assert.equal(patched.adGroups[0]?.budget, 30);
    const reconciled = reconcileTikTokAdGroups({
      ...draft,
      budgetSchedule: patched,
    });
    assert.equal(reconciled.adGroups.length, 1);
    assert.equal(reconciled.adGroups[0]?.budget, 30);
    assert.equal(reconciled.changed, false);
  });

  it("the match-campaign write touches only the ad group it belongs to", () => {
    const draft = relaunch2Draft();
    draft.budgetSchedule.adGroups = [
      ...draft.budgetSchedule.adGroups,
      {
        id: OTHER_ID,
        name: "Manchester",
        budget: 40,
        startAt: null,
        endAt: null,
      },
    ];
    const next = patchTikTokAdGroupBudget(
      draft.budgetSchedule.adGroups,
      LONDON_ID,
      50,
    );
    assert.equal(next[0]?.budget, 50);
    assert.equal(next[1]?.budget, 40);
    assert.equal(draft.budgetSchedule.budgetAmount, 50);
    assert.equal(
      tikTokAdGroupBudgetDiffersFromCampaign(30, 50),
      true,
    );
    assert.equal(
      tikTokAdGroupBudgetDiffersFromCampaign(50, 50),
      false,
    );
    const line = tikTokAdGroupMatchCampaignLine({
      campaignAmount: 50,
      adGroupBudget: 30,
    });
    assert.equal(
      line.text,
      "Campaign budget is £50. This ad group is £30.",
    );
    assert.equal(line.action, "Set to £50");
  });
});

describe("payload budget skip is keyed on already-reported", () => {
  it("suppresses when an explicit budget issue exists for that ad group", () => {
    assert.equal(
      shouldSkipDuplicateTikTokAdGroupBudgetPayload(
        [{ id: `adgroup-budget-${LONDON_ID}` }],
        LONDON_ID,
      ),
      true,
    );
    assert.equal(
      shouldSkipDuplicateTikTokAdGroupBudgetPayload(
        [{ id: `adgroup-budget-floor-${LONDON_ID}` }],
        LONDON_ID,
      ),
      true,
    );
  });

  it("does not suppress a budget-field payload error for an ad group with no explicit issue", () => {
    assert.equal(
      shouldSkipDuplicateTikTokAdGroupBudgetPayload(
        [{ id: `adgroup-${LONDON_ID}-budget` }],
        LONDON_ID,
      ),
      false,
    );
    assert.equal(
      shouldSkipDuplicateTikTokAdGroupBudgetPayload(
        [{ id: `adgroup-budget-${OTHER_ID}` }],
        LONDON_ID,
      ),
      false,
    );
    assert.equal(
      shouldSkipDuplicateTikTokAdGroupBudgetPayload([], LONDON_ID),
      false,
    );
  });
});

describe("Assign ad-group budget field (task #139)", () => {
  it("N change events produce one write, on blur, and the field stays enabled", () => {
    const writes: string[] = [];
    const persist = (value: string) => {
      writes.push(value);
    };
    const segments = ["3", "30", "50"];
    for (const value of segments) {
      applyTikTokAdGroupBudgetChange({ persist }, "change", value);
      assert.equal(tikTokAdGroupBudgetFieldDisabled({ saving: true }), false);
    }
    applyTikTokAdGroupBudgetChange({ persist }, "blur", "50");
    assert.deepEqual(writes, ["50"]);
    assert.equal(shouldPersistTikTokAdGroupBudget("change"), false);
    assert.equal(shouldPersistTikTokAdGroupBudget("blur"), true);
  });

  it("Assign budget field is wired to persist-on-blur and stays enabled while saving", () => {
    // node:test cannot render React in this repo, so this is a grep
    // of the wiring, not coverage of the behaviour. The policy lives
    // on shouldPersistTikTokAdGroupBudget / applyTikTokAdGroupBudgetChange.
    const source = readFileSync(
      join(HERE, "../../../components/tiktok-wizard/steps/assign-creatives.tsx"),
      "utf8",
    );
    assert.match(source, /const \[budgetDraft, setBudgetDraft\]/);
    assert.match(source, /shouldPersistTikTokAdGroupBudget\("change"\)/);
    assert.match(source, /shouldPersistTikTokAdGroupBudget\("blur"\)/);
    const field = source.slice(
      source.indexOf("function AdGroupBudgetField"),
      source.indexOf("function AdGroupNameInput"),
    );
    assert.match(field, /tikTokAdGroupBudgetFieldDisabled\(\{ saving \}\)/);
    assert.equal(field.includes("disabled={saving}"), false);
    assert.match(field, /tikTokAdGroupBudgetFloorLine/);
    assert.match(source, /tikTokAdGroupMatchCampaignLine/);
    assert.match(source, /\{match\.action\}/);
  });

  it("parse accepts the same money strings as the campaign budget field", () => {
    assert.equal(parseTikTokAdGroupBudgetInput("50"), 50);
    assert.equal(parseTikTokAdGroupBudgetInput("£50"), 50);
    assert.equal(parseTikTokAdGroupBudgetInput(""), null);
  });

  it("GBP daily floor sentence names the target", () => {
    assert.equal(
      tikTokAdGroupBudgetFloorLine({
        budgetMode: "DAILY",
        startAt: "2027-09-01T09:00",
        endAt: "2027-09-08T09:00",
        currency: "GBP",
      }),
      "TikTok's GBP minimum for DAILY is 50",
    );
  });
});
