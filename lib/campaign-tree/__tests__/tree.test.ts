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
  notAddedLines,
  runErrorLine,
  treeRunNotAdded,
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

describe("stages (RC14)", () => {
  it("reads only stage words in the name, after the [CODE]", () => {
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] SIGNUP" }), "signup");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] SIGN UP" }), "signup");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] Signups" }), "signup");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] REGISTRATION" }), "signup");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] PRESALE" }), "presale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] PRE-SALE" }), "presale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] ON SALE" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] ONSALE" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] GEN SALE" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] GENERAL SALE" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] SHOW WEEK" }), "show_week");
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] FINAL PUSH" }), "show_week");
  });

  it("[CODE] SIGNUP is Signup whatever its objective", () => {
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] SIGNUP", draftObjective: "purchase", metaObjective: "OUTCOME_SALES" }), "signup");
  });

  it("PURCHASE, TRAFFIC, REACH, TICKETS and REG aren't stage words", () => {
    for (const word of ["PURCHASE", "TRAFFIC", "REACH", "TICKETS", "TICKET", "REG"]) {
      assert.equal(stageOfCampaign({ name: `[NX27-GLITTERBOX] ${word}` }), "unsorted", word);
    }
  });

  it("never reads a stage out of the [CODE]", () => {
    assert.equal(stageOfCampaign({ name: "[SIGNUP26-ONSALE] Lineup" }), "unsorted");
  });

  it("then an objective that means one stage", () => {
    assert.equal(stageOfCampaign({ name: "Lineup", draftObjective: "registration" }), "signup");
    assert.equal(stageOfCampaign({ name: "Lineup", draftObjective: "purchase" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "Lineup", phaseAtLaunch: "presale" }), "signup");
    assert.equal(stageOfCampaign({ name: "Lineup", phaseAtLaunch: "on_sale" }), "on_sale");
    assert.equal(stageOfCampaign({ name: "Lineup", metaObjective: "OUTCOME_LEADS" }), "signup");
    assert.equal(stageOfCampaign({ name: "Lineup", metaObjective: "OUTCOME_SALES" }), "on_sale");
  });

  it("traffic, awareness, engagement and reach decide nothing: [NX27-GLITTERBOX] TRAFFIC is Unsorted", () => {
    assert.equal(stageOfCampaign({ name: "[NX27-GLITTERBOX] TRAFFIC", draftObjective: "traffic", phaseAtLaunch: "on_sale", metaObjective: "OUTCOME_TRAFFIC" }), "unsorted");
    assert.equal(stageOfCampaign({ name: "Lineup", draftObjective: "awareness", phaseAtLaunch: "on_sale" }), "unsorted");
    assert.equal(stageOfCampaign({ name: "Lineup", draftObjective: "engagement" }), "unsorted");
    assert.equal(stageOfCampaign({ name: "Lineup", metaObjective: "OUTCOME_AWARENESS", phaseAtLaunch: "on_sale" }), "unsorted");
    assert.equal(stageOfCampaign({ name: "Lineup" }), "unsorted");
  });

  it("P26-BDAY: Lineup Push and Reach (to 12PM Thu) go under Unsorted", () => {
    assert.equal(stageOfCampaign({ name: "[P26-BDAY] Lineup Push", draftObjective: "traffic", phaseAtLaunch: "on_sale", metaObjective: "OUTCOME_TRAFFIC" }), "unsorted");
    assert.equal(stageOfCampaign({ name: "[P26-BDAY] Reach (to 12PM Thu)", draftObjective: "awareness", phaseAtLaunch: "on_sale", metaObjective: "OUTCOME_AWARENESS" }), "unsorted");
    // With nothing but the names, too.
    assert.equal(stageOfCampaign({ name: "[P26-BDAY] Lineup Push" }), "unsorted");
    assert.equal(stageOfCampaign({ name: "[P26-BDAY] Reach (to 12PM Thu)" }), "unsorted");
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
    assert.equal(sheetCampaignLine(REACH, selection), "1 of 1 ad set · paused");
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

describe("RC9 one forms, RC10 no draft, RC14 Unsorted, RC12 outcomes", () => {
  it("picks the one form by n everywhere", () => {
    const one: TreeAdditionRow = { ...ADDITIONS[1]!, meta_adset_ids: ["a"], detail: { creatives: 1, who: "Matas" } };
    assert.deepEqual([additionView(one).head, additionView(one).line], ["+ 1 ad added", "Thu 26 Nov · to 1 ad set · Matas"]);
    const aud: TreeAdditionRow = { ...ADDITIONS[0]!, meta_adset_ids: ["a"] };
    assert.equal(additionView(aud).line, "Fri 27 Nov · Techno page engagers → 1 ad set · Matas");
    assert.equal(creativesSheetTitle(1, "on_sale"), "Add 1 creative to On sale");
    const single: TreeCampaign = { ...TRAFFIC, adSets: adSets("9", 1) };
    assert.equal(sheetCampaignLine(single, { [single.metaCampaignId]: [single.adSets[0]!.id] }), "1 of 1 ad set");
    assert.equal(sheetButton({ [single.metaCampaignId]: [single.adSets[0]!.id] }), "Add to 1 ad set in 1 campaign");
    assert.equal(sheetButton({ [PURCHASE.metaCampaignId]: PURCHASE.adSets.map((a) => a.id) }), "Add to 6 ad sets in 1 campaign");
    assert.equal(sheetButton({ [PURCHASE.metaCampaignId]: [] }), "Nothing ticked");
    assert.equal(sheetButton({}), "Nothing ticked");
  });

  it("a campaign with no draft on the event stays under its stage, with the line, and can't be ticked", () => {
    const retarget: TreeCampaign = { ...TRAFFIC, metaCampaignId: "120000000005", name: "[NX27-GLITTERBOX] ON SALE · RETARGET", draftId: null };
    const view = buildCampaignTree({ campaigns: [PURCHASE, retarget], additions: [] });
    const row = view.stages.find((s) => s.stage === "on_sale")!.campaigns.find((c) => c.metaCampaignId === retarget.metaCampaignId)!;
    assert.equal(row.noDraft, "No draft on this event, so additions can’t reach it.");
    assert.equal(row.meta, "live · 2 ad sets");
    assert.equal(view.stages.find((s) => s.stage === "on_sale")!.campaigns.find((c) => c.metaCampaignId === PURCHASE.metaCampaignId)!.noDraft, null);
    const selection = defaultSelection(stageSheetCampaigns(view, "on_sale"));
    assert.deepEqual(selection[retarget.metaCampaignId], []);
    assert.deepEqual(toggleAdSet(selection, retarget, retarget.adSets[0]!.id), selection);
    assert.equal(sheetButton(selection), "Add to 6 ad sets in 1 campaign");
  });

  it("Unsorted comes last, only with campaigns, with its line and no stage actions", () => {
    const view = buildCampaignTree({
      campaigns: [PURCHASE, { ...TRAFFIC, stage: "unsorted" }, { ...REACH, stage: "unsorted" }],
      additions: [],
    });
    assert.deepEqual(view.stages.map((s) => [s.label, s.actions]), [["Signup", true], ["On sale", true], ["Unsorted", false]]);
    assert.equal(view.stages[2]!.line, "The name and objective don’t say the stage, so these take no stage additions.");
    assert.equal(buildCampaignTree({ campaigns: [PURCHASE], additions: [] }).stages.some((s) => s.stage === "unsorted"), false);
  });

  it("maps a run's outcome to rows, never codes", () => {
    assert.deepEqual(
      notAddedLines([
        { name: "Retargeting · page", kind: "refused" },
        { name: "Similar pages", kind: "failed" },
      ]),
      { heading: "Not added to 2 ad sets:", rows: ["Retargeting · page: refused, nothing changed on it", "Similar pages: didn’t go through. Try again."] },
    );
    assert.equal(notAddedLines([{ name: "Broad", kind: "failed" }])!.heading, "Not added to 1 ad set:");
    assert.equal(notAddedLines([]), null);
    assert.equal(runErrorLine({ added: 0 }), "Nothing was added. Try again.");
    assert.equal(runErrorLine({ added: 0, logUnavailable: true }), "Nothing was added: this run couldn’t be logged, so it didn’t start.");
    assert.equal(runErrorLine({ added: 1 }), "Stopped part way: added to 1 ad set, then stopped. Try again for the rest.");
    assert.equal(runErrorLine({ added: 7 }), "Stopped part way: added to 7 ad sets, then stopped. Try again for the rest.");
  });

  it("a creatives run lists the ticked ad sets that hold none of its ads", () => {
    const picked = { [PURCHASE.metaCampaignId]: PURCHASE.adSets.slice(0, 2).map((a) => a.id) };
    const out = treeRunNotAdded(picked, [{ campaignId: PURCHASE.metaCampaignId, adSetsAdded: [PURCHASE.adSets[0]!.id] }], [PURCHASE]);
    assert.deepEqual(out, { added: 1, notAdded: [{ name: PURCHASE.adSets[1]!.name, kind: "failed" }] });
  });
});
