import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeTikTokAdGroupReconciliation,
  reconcileTikTokAdGroups,
} from "../ad-group-reconcile.ts";
import { pruneTikTokAssignments } from "../assign-creatives.ts";
import { suggestTikTokAdGroups } from "../review.ts";
import { buildTikTokAdGroupPayload } from "../../tiktok/write/mapping.ts";
import {
  createDefaultTikTokDraft,
  type TikTokCampaignDraft,
  type TikTokInterestGroup,
} from "../../types/tiktok-draft.ts";

function group(id: string, name: string, interestId: string): TikTokInterestGroup {
  return {
    id,
    name,
    interestIds: [{ id: interestId, name: interestId, kind: "category" }],
    hashtagIds: [],
    behaviourIds: [],
  };
}

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
  const out: Record<string, { interests: string[]; name: string }> = {};
  for (const adGroup of suggestTikTokAdGroups(draft)) {
    const payload = buildTikTokAdGroupPayload({
      advertiserId: "adv-1",
      campaignId: "camp-1",
      draft,
      adGroup: { ...adGroup, budget: adGroup.budget ?? 50 },
    });
    assert.equal(payload.ok, true, `payload failed for ${adGroup.name}`);
    if (!payload.ok) continue;
    out[adGroup.id] = {
      name: adGroup.name,
      interests: (payload.value.interest_category_ids as string[]) ?? [],
    };
  }
  return out;
}

describe("reconcileTikTokAdGroups — interest groups added after the first visit", () => {
  it("adds an ad group for a group created after the list was persisted", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    assert.equal(draft.budgetSchedule.adGroups.length, 1);

    draft.audiences.interestGroups.push(group("g-techno", "Techno", "int-techno"));
    const result = reconcileTikTokAdGroups(draft);

    assert.equal(result.changed, true);
    assert.equal(result.adGroups.length, 2);
    assert.deepEqual(
      result.adGroups.map((adGroup) => adGroup.interestGroupId),
      ["g-house", "g-techno"],
    );
    assert.deepEqual(
      result.added.map((adGroup) => adGroup.interestGroupId),
      ["g-techno"],
    );
    assert.equal(result.removed.length, 0);
  });

  it("sends the new group's targeting to its own ad group and nobody else's", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups.push(group("g-techno", "Techno", "int-techno"));
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;

    const byAdGroup = targetingByAdGroup(draft);
    assert.deepEqual(Object.keys(byAdGroup), ["ig_g-house", "ig_g-techno"]);
    assert.deepEqual(byAdGroup["ig_g-house"].interests, ["int-house"]);
    assert.deepEqual(byAdGroup["ig_g-techno"].interests, ["int-techno"]);
  });

  it("keeps suggestTikTokAdGroups honest even when the persisted list is stale", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups.push(group("g-disco", "Disco", "int-disco"));

    assert.deepEqual(
      suggestTikTokAdGroups(draft).map((adGroup) => adGroup.interestGroupId),
      ["g-house", "g-disco"],
    );
  });
});

describe("reconcileTikTokAdGroups — deleted interest groups", () => {
  it("removes the orphan instead of letting it inherit the union", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [
      group("g-house", "House", "int-house"),
      group("g-techno", "Techno", "int-techno"),
    ];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    // Deleting the group also clears its ids from the flat fields; the flat
    // fields are what an orphan ad group would otherwise pick up.
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.audiences.interestCategoryIds = ["int-house"];

    const result = reconcileTikTokAdGroups(draft);
    assert.equal(result.adGroups.length, 1);
    assert.deepEqual(
      result.removed.map((adGroup) => adGroup.interestGroupId),
      ["g-techno"],
    );

    draft.budgetSchedule.adGroups = result.adGroups;
    const byAdGroup = targetingByAdGroup(draft);
    assert.deepEqual(Object.keys(byAdGroup), ["ig_g-house"]);
    assert.deepEqual(byAdGroup["ig_g-house"].interests, ["int-house"]);
  });

  it("drops the ad group when its interest group is emptied rather than deleted", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [
      group("g-house", "House", "int-house"),
      group("g-techno", "Techno", "int-techno"),
    ];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups[1].interestIds = [];

    const result = reconcileTikTokAdGroups(draft);
    assert.deepEqual(
      result.adGroups.map((adGroup) => adGroup.interestGroupId),
      ["g-house"],
    );
  });

  it("prunes creative assignments for removed ad groups", () => {
    const assignments = pruneTikTokAssignments(
      { "ig_g-house": ["creative-1"], "ig_g-techno": ["creative-1"] },
      ["ig_g-house"],
    );
    assert.deepEqual(assignments.byAdGroupId, { "ig_g-house": ["creative-1"] });
    assert.equal(assignments.pruned, true);
  });
});

describe("reconcileTikTokAdGroups — operator edits survive", () => {
  it("preserves edited names and budgets for groups that still exist", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [
      group("g-house", "House", "int-house"),
      group("g-techno", "Techno", "int-techno"),
    ];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.budgetSchedule.adGroups[0] = {
      ...draft.budgetSchedule.adGroups[0],
      name: "House — renamed by hand",
      budget: 120,
    };
    draft.audiences.interestGroups.push(group("g-disco", "Disco", "int-disco"));

    const result = reconcileTikTokAdGroups(draft);
    assert.equal(result.adGroups[0].name, "House — renamed by hand");
    assert.equal(result.adGroups[0].budget, 120);
    assert.equal(result.adGroups[1].name, "Techno");
    assert.equal(result.adGroups[2].name, "Disco");
  });

  it("is idempotent once the reconciled list is persisted", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    assert.equal(reconcileTikTokAdGroups(draft).changed, false);
  });
});

describe("reconcileTikTokAdGroups — positional defaults", () => {
  it("keeps positional defaults when there are no interest groups", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    assert.deepEqual(
      draft.budgetSchedule.adGroups.map((adGroup) => adGroup.name),
      ["Ad group 1", "Ad group 2", "Ad group 3"],
    );

    draft.budgetSchedule.adGroups[0] = {
      ...draft.budgetSchedule.adGroups[0],
      name: "Broad",
    };
    const result = reconcileTikTokAdGroups(draft);
    assert.equal(result.changed, false);
    assert.equal(result.adGroups[0].name, "Broad");
  });

  it("drops positional stubs once interest groups take over", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];

    const result = reconcileTikTokAdGroups(draft);
    assert.deepEqual(
      result.adGroups.map((adGroup) => adGroup.id),
      ["ig_g-house"],
    );
    assert.equal(result.removed.length, 3);
  });

  it("restores positional defaults when the last interest group goes", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups = [];

    const result = reconcileTikTokAdGroups(draft);
    assert.deepEqual(
      result.adGroups.map((adGroup) => adGroup.name),
      ["Ad group 1", "Ad group 2", "Ad group 3"],
    );
  });
});

describe("describeTikTokAdGroupReconciliation", () => {
  it("names what was added and removed", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [group("g-house", "House", "int-house")];
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    draft.audiences.interestGroups = [group("g-techno", "Techno", "int-techno")];

    const message = describeTikTokAdGroupReconciliation(
      reconcileTikTokAdGroups(draft),
    );
    assert.ok(message?.includes("Added 1 ad group (Techno)"));
    assert.ok(message?.includes("Removed 1 ad group (House)"));
  });

  it("says nothing when nothing moved", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.adGroups = reconcileTikTokAdGroups(draft).adGroups;
    assert.equal(
      describeTikTokAdGroupReconciliation(reconcileTikTokAdGroups(draft)),
      null,
    );
  });
});
