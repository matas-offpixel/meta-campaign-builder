import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTikTokAdGroupPayload } from "../../tiktok/write/mapping.ts";
import {
  createDefaultTikTokDraft,
  type TikTokCampaignDraft,
} from "../../types/tiktok-draft.ts";
import { reconcileTikTokAdGroups } from "../ad-group-reconcile.ts";
import {
  applyTikTokPresetTaxonomyToGroup,
  createTikTokInterestGroupFromPreset,
  formatTikTokPresetResolution,
} from "../apply-preset.ts";
import {
  resolveTikTokPresetTaxonomy,
  tikTokPresetById,
} from "../genre-presets.ts";
import { suggestTikTokAdGroups } from "../review.ts";
import {
  LIVE_BEHAVIOUR_CATALOG,
  LIVE_INTEREST_CATALOG,
} from "./live-catalog-fixture.ts";

const LIVE_CATALOG = {
  interests: LIVE_INTEREST_CATALOG,
  behaviours: LIVE_BEHAVIOUR_CATALOG,
};

function launchableDraft(): TikTokCampaignDraft {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.accountSetup.advertiserId = "adv-1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "America/New_York";
  draft.campaignSetup.campaignName = "Campaign";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 150;
  draft.budgetSchedule.scheduleStartAt = "2026-05-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2026-05-08T09:00:00Z";
  return draft;
}

function targetingByAdGroup(draft: TikTokCampaignDraft) {
  const out: Record<
    string,
    { interests: string[]; behaviours: string[]; name: string }
  > = {};
  for (const adGroup of suggestTikTokAdGroups(draft)) {
    const payload = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: { ...adGroup, budget: adGroup.budget ?? 50 },
    });
    assert.equal(payload.ok, true, `payload failed for ${adGroup.name}`);
    if (!payload.ok) continue;
    const actions = payload.value.actions as
      | Array<{ action_category_ids?: string[] }>
      | undefined;
    out[adGroup.id] = {
      name: adGroup.name,
      interests: (payload.value.interest_category_ids as string[]) ?? [],
      behaviours: actions?.[0]?.action_category_ids ?? [],
    };
  }
  return out;
}

describe("applyTikTokPresetTaxonomyToGroup", () => {
  it("adds preset taxonomy to existing selections instead of replacing them", () => {
    const preset = tikTokPresetById("electronic-music");
    assert.ok(preset);
    const taxonomy = resolveTikTokPresetTaxonomy(LIVE_CATALOG, preset);
    const existing = {
      id: "g-existing",
      name: "Operator picks",
      interestIds: [
        { id: "22", name: "Apparel & Accessories", kind: "category" as const },
        { id: "kw-keep", name: "keep-me", kind: "keyword" as const },
      ],
      hashtagIds: [{ id: "ht-1", name: "club", kind: "keyword" as const }],
      behaviourIds: [],
    };
    const next = applyTikTokPresetTaxonomyToGroup(existing, taxonomy);
    assert.deepEqual(
      next.interestIds.map((item) => item.id),
      ["22", "kw-keep", "23116107", "10106102"],
    );
    assert.deepEqual(
      next.behaviourIds.map((item) => item.id),
      ["1810101", "1101", "1101100"],
    );
    assert.deepEqual(next.hashtagIds, existing.hashtagIds);
    assert.equal(next.id, "g-existing");
    assert.equal(next.name, "Operator picks");
  });
});

describe("createTikTokInterestGroupFromPreset", () => {
  it("creates a named group whose targeting becomes its own ad group via reconcile", () => {
    const preset = tikTokPresetById("fashion-streetwear");
    assert.ok(preset);
    const taxonomy = resolveTikTokPresetTaxonomy(LIVE_CATALOG, preset);
    const group = createTikTokInterestGroupFromPreset({
      preset,
      taxonomy,
      id: "g-streetwear",
    });
    assert.equal(group.name, "Streetwear");
    assert.deepEqual(
      group.interestIds.map((item) => item.id),
      ["22108110", "22110103"],
    );

    const draft = launchableDraft();
    draft.audiences.interestGroups = [group];
    const result = reconcileTikTokAdGroups(draft);
    assert.equal(result.adGroups.length, 1);
    assert.equal(result.adGroups[0]?.interestGroupId, "g-streetwear");
    draft.budgetSchedule.adGroups = result.adGroups;
    const byAdGroup = targetingByAdGroup(draft);
    assert.deepEqual(byAdGroup["ig_g-streetwear"]?.interests, [
      "22108110",
      "22110103",
    ]);
  });
});

describe("composable presets across ad groups", () => {
  it("applies two presets to two groups and launches two differently-targeted ad groups", () => {
    const electronic = tikTokPresetById("electronic-music");
    const streetwear = tikTokPresetById("fashion-streetwear");
    assert.ok(electronic);
    assert.ok(streetwear);
    const musicGroup = createTikTokInterestGroupFromPreset({
      preset: electronic,
      taxonomy: resolveTikTokPresetTaxonomy(LIVE_CATALOG, electronic),
      id: "g-electronic",
    });
    const fashionGroup = createTikTokInterestGroupFromPreset({
      preset: streetwear,
      taxonomy: resolveTikTokPresetTaxonomy(LIVE_CATALOG, streetwear),
      id: "g-streetwear",
    });

    const draft = launchableDraft();
    draft.audiences.interestGroups = [musicGroup];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups.push(fashionGroup);
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;

    assert.deepEqual(
      draft.budgetSchedule.adGroups.map((adGroup) => adGroup.interestGroupId),
      ["g-electronic", "g-streetwear"],
    );

    const byAdGroup = targetingByAdGroup(draft);
    assert.deepEqual(byAdGroup["ig_g-electronic"]?.interests, [
      "23116107",
      "10106102",
    ]);
    assert.deepEqual(byAdGroup["ig_g-electronic"]?.behaviours, [
      "1810101",
      "1101",
      "1101100",
    ]);
    assert.deepEqual(byAdGroup["ig_g-streetwear"]?.interests, [
      "22108110",
      "22110103",
    ]);
    assert.deepEqual(byAdGroup["ig_g-streetwear"]?.behaviours, ["beh-fashion"]);
    assert.notDeepEqual(
      byAdGroup["ig_g-electronic"]?.interests,
      byAdGroup["ig_g-streetwear"]?.interests,
    );
  });
});

describe("formatTikTokPresetResolution", () => {
  it("reports resolved counts and names unresolved paths", () => {
    const taxonomy = resolveTikTokPresetTaxonomy(LIVE_CATALOG, {
      interestPaths: [
        ["News & Entertainment", "Culture & Art", "Music"],
        ["News & Entertainment", "Culture & Art", "Techno"],
      ],
      behaviourPaths: [["Talents", "Singing & Dancing"]],
    });
    assert.equal(
      formatTikTokPresetResolution({
        taxonomy,
        keywordTerms: 6,
        unresolvedKeywordTerms: ["tech house", "drumcode"],
      }),
      "1 category, 1 behaviour, 6 keyword terms. TikTok catalog has no node for News & Entertainment > Culture & Art > Techno. TikTok catalog has no keyword for tech house; drumcode.",
    );
  });
});
