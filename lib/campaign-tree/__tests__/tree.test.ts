import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  additionView,
  audienceSheetTitle,
  buildCampaignTree,
  creativesSheetTitle,
  defaultSelection,
  moreLine,
  selectedCampaignAdSets,
  selectionCounts,
  sheetButton,
  sheetCampaignLine,
  stageOfCampaign,
  stageSheetCampaigns,
  toggleAdSet,
  toggleCampaign,
  treeDate,
  treeStatus,
  type TreeAdditionRow,
  type TreeCampaign,
} from "../tree.ts";

function adSets(prefix: string, n: number, status: "live" | "paused" | null = "live") {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`.padEnd(8, "0"), name: `${prefix} ${i + 1}`, status }));
}

const SIGNUP: TreeCampaign = {
  metaCampaignId: "120000000001",
  name: "[NX27-GLITTERBOX] SIGNUP",
  stage: "signup",
  status: "live",
  adSets: adSets("1", 18),
  draftId: "d0000000-0000-4000-8000-000000000001",
  adAccountId: "act_606252931141334",
};
const PURCHASE: TreeCampaign = {
  metaCampaignId: "120000000002",
  name: "[NX27-GLITTERBOX] PURCHASE",
  stage: "on_sale",
  status: "live",
  adSets: adSets("2", 6),
  draftId: "d0000000-0000-4000-8000-000000000002",
  adAccountId: "act_606252931141334",
};
const TRAFFIC: TreeCampaign = {
  ...PURCHASE,
  metaCampaignId: "120000000003",
  name: "[NX27-GLITTERBOX] TRAFFIC",
  adSets: adSets("3", 2),
  draftId: "d0000000-0000-4000-8000-000000000003",
};
const REACH: TreeCampaign = {
  ...PURCHASE,
  metaCampaignId: "120000000004",
  name: "[NX27-GLITTERBOX] REACH",
  status: "paused",
  adSets: adSets("4", 1, "paused"),
  draftId: "d0000000-0000-4000-8000-000000000004",
};

const ADDITIONS: TreeAdditionRow[] = [
  {
    id: "a2",
    meta_campaign_id: SIGNUP.metaCampaignId,
    stage: "signup",
    kind: "audience",
    meta_adset_ids: adSets("1", 6).map((a) => a.id),
    detail: { audienceName: "Techno page engagers", who: "Matas" },
    onsale_refresh_line_id: "00000000-0000-4000-8000-0000000000aa",
    created_at: "2026-11-27T10:00:00Z",
  },
  {
    id: "a1",
    meta_campaign_id: SIGNUP.metaCampaignId,
    stage: "signup",
    kind: "creative",
    meta_adset_ids: SIGNUP.adSets.map((a) => a.id),
    detail: { creatives: 4, ads: 72, who: "Matas" },
    onsale_refresh_line_id: null,
    created_at: "2026-11-26T10:00:00Z",
  },
  {
    id: "a3",
    meta_campaign_id: PURCHASE.metaCampaignId,
    stage: "on_sale",
    kind: "creative",
    meta_adset_ids: PURCHASE.adSets.map((a) => a.id),
    detail: { creatives: 3, ads: 18, who: "Matas" },
    onsale_refresh_line_id: null,
    created_at: "2026-12-04T10:00:00Z",
  },
];

describe("stages", () => {
  it("reads the stage from the campaign name first", () => {
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] SIGNUP" }), "signup");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] PURCHASE", draftObjective: "registration" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] ON SALE" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] PRESALE" }), "presale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] SHOW WEEK" }), "show_week");
  });

  it("never reads a stage out of the [CODE]", () => {
    assert.equal(stageOfCampaign({ name: "[REG26-SIGNUP] Lineup", draftObjective: "purchase" }), "on_sale");
  });

  it("falls back to the draft objective, then phase_at_launch, then Meta's objective, then On sale", () => {
    assert.equal(stageOfCampaign({ name: "Lineup", draftObjective: "registration" }), "signup");
    assert.equal(stageOfCampaign({ name: "Lineup", phaseAtLaunch: "presale" }), "signup");
    assert.equal(stageOfCampaign({ name: "Lineup", metaObjective: "OUTCOME_LEADS" }), "signup");
    assert.equal(stageOfCampaign({ name: "Lineup", metaObjective: "OUTCOME_TRAFFIC" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "Lineup" }), "on_sale");
  });

  it("maps Meta statuses", () => {
    assert.equal(treeStatus("ACTIVE"), "live");
    assert.equal(treeStatus("CAMPAIGN_PAUSED"), "paused");
    assert.equal(treeStatus("PAUSED"), "paused");
    assert.equal(treeStatus("ARCHIVED"), "gone");
    assert.equal(treeStatus(undefined), null);
  });
});

describe("the tree (RC-F)", () => {
  const view = buildCampaignTree({
    campaigns: [REACH, TRAFFIC, PURCHASE, SIGNUP],
    additions: ADDITIONS,
    eventCampaignIds: [SIGNUP.metaCampaignId],
  });

  it("shows Signup and On sale, and leaves out stages with no campaigns", () => {
    assert.deepEqual(view.stages.map((s) => s.label), ["Signup", "On sale"]);
  });

  it("marks the Signup master and draws RC-F's rows", () => {
    const [signup, onSale] = view.stages;
    assert.equal(signup!.campaigns[0]!.master, true);
    assert.equal(signup!.campaigns[0]!.meta, "live · 18 ad sets");
    assert.deepEqual(
      onSale!.campaigns.map((c) => `${c.name} · ${c.meta}`),
      [
        "[NX27-GLITTERBOX] PURCHASE · live · 6 ad sets",
        "[NX27-GLITTERBOX] TRAFFIC · live · 2 ad sets",
        "[NX27-GLITTERBOX] REACH · paused · 1 ad set",
      ],
    );
    assert.ok(onSale!.campaigns.every((c) => !c.master));
  });

  it("lists additions oldest first with RC-F's words", () => {
    const signup = view.stages[0]!.campaigns[0]!;
    assert.deepEqual(
      signup.additions.map((a) => [a.head, a.line, a.refresh]),
      [
        ["+ 4 ads added", "Thu 26 Nov · to 18 ad sets · Matas", null],
        ["+ audience added", "Fri 27 Nov · Techno page engagers → 6 ad sets · Matas", "proposed by the on-sale refresh"],
      ],
    );
    assert.deepEqual(
      view.stages[1]!.campaigns[0]!.additions.map((a) => `${a.head} ${a.line}`),
      ["+ 3 ads added Fri 4 Dec · to 6 ad sets · Matas"],
    );
  });

  it("drops the who when nobody is named", () => {
    const row = additionView({ ...ADDITIONS[1]!, detail: { creatives: 2 } });
    assert.equal(row.line, "Thu 26 Nov · to 18 ad sets");
  });

  it("shows Presale and Show week when they have campaigns, and a status that wasn't read as the count alone", () => {
    const more = buildCampaignTree({
      campaigns: [{ ...TRAFFIC, stage: "show_week", status: null }],
      additions: [],
    });
    assert.deepEqual(more.stages.map((s) => s.stage), ["signup", "on_sale", "show_week"]);
    assert.equal(more.stages[2]!.campaigns[0]!.meta, "2 ad sets");
  });

  it("formats dates in London", () => {
    assert.equal(treeDate("2026-11-26T23:30:00Z"), "Thu 26 Nov");
    assert.equal(treeDate("2026-07-01T23:30:00Z"), "Thu 2 Jul");
  });
});

describe("the stage sheet (RC6)", () => {
  const view = buildCampaignTree({ campaigns: [PURCHASE, TRAFFIC, REACH], additions: [] });
  const onSale = stageSheetCampaigns(view, "on_sale");

  it("starts with live campaigns and their ad sets ticked, and paused campaigns unticked (Matas, 24 Nov)", () => {
    const selection = defaultSelection(onSale);
    assert.equal(selection[PURCHASE.metaCampaignId]!.length, 6);
    assert.equal(selection[TRAFFIC.metaCampaignId]!.length, 2);
    assert.deepEqual(selection[REACH.metaCampaignId], []);
    assert.deepEqual(selectionCounts(selection), { adSets: 8, campaigns: 2 });
    assert.equal(sheetButton(selection), "Add to 8 ad sets in 2 campaigns");
    assert.deepEqual(Object.keys(selectedCampaignAdSets(selection)).sort(), [PURCHASE.metaCampaignId, TRAFFIC.metaCampaignId].sort());
  });

  it("draws RC-F's sheet lines and title", () => {
    const selection = defaultSelection(onSale);
    assert.equal(sheetCampaignLine(PURCHASE, selection), "6 of 6 ad sets");
    assert.equal(sheetCampaignLine(TRAFFIC, selection), "2 of 2 ad sets");
    assert.equal(sheetCampaignLine(REACH, selection), "paused");
    assert.equal(creativesSheetTitle(3, "on_sale"), "Add 3 creatives to On sale");
    assert.equal(audienceSheetTitle("Techno page engagers", "signup"), "Add Techno page engagers to Signup");
    assert.equal(audienceSheetTitle(null, "signup"), "Add audience to…");
    assert.equal(moreLine(3), "… and 3 more");
    assert.equal(moreLine(0), null);
  });

  it("a live campaign's paused ad sets start unticked", () => {
    const mixed: TreeCampaign = { ...PURCHASE, adSets: [...adSets("5", 2), ...adSets("6", 1, "paused")] };
    const selection = defaultSelection([mixed]);
    assert.equal(selection[mixed.metaCampaignId]!.length, 2);
    assert.equal(sheetCampaignLine(mixed, selection), "2 of 3 ad sets");
  });

  it("a campaign whose status wasn't read, or with no draft to log the write against, starts unticked", () => {
    const unread: TreeCampaign = { ...PURCHASE, status: null };
    const noDraft: TreeCampaign = { ...TRAFFIC, draftId: null };
    const selection = defaultSelection([unread, noDraft]);
    assert.deepEqual(selectionCounts(selection), { adSets: 0, campaigns: 0 });
    assert.deepEqual(toggleCampaign(selection, noDraft)[noDraft.metaCampaignId], []);
  });

  it("ticks and unticks a campaign and single ad sets", () => {
    let selection = defaultSelection(onSale);
    selection = toggleCampaign(selection, REACH);
    assert.equal(selection[REACH.metaCampaignId]!.length, 1);
    assert.equal(sheetCampaignLine(REACH, selection), "1 of 1 ad sets · paused");
    selection = toggleCampaign(selection, PURCHASE);
    assert.deepEqual(selection[PURCHASE.metaCampaignId], []);
    selection = toggleAdSet(selection, PURCHASE, PURCHASE.adSets[2]!.id);
    selection = toggleAdSet(selection, PURCHASE, PURCHASE.adSets[0]!.id);
    assert.deepEqual(selection[PURCHASE.metaCampaignId], [PURCHASE.adSets[0]!.id, PURCHASE.adSets[2]!.id]);
    assert.equal(sheetButton(selection), "Add to 5 ad sets in 3 campaigns");
  });

  it("keeps one ad account per sheet", () => {
    const other: TreeCampaign = { ...TRAFFIC, metaCampaignId: "120000000009", adAccountId: "act_1" };
    const v = buildCampaignTree({ campaigns: [PURCHASE, other], additions: [] });
    assert.deepEqual(stageSheetCampaigns(v, "on_sale").map((c) => c.metaCampaignId), [PURCHASE.metaCampaignId]);
  });
});
