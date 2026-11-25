import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { additionWho, logCampaignAddition, type AdditionsDb } from "../additions.ts";
import {
  draftsByCampaign,
  loadCampaignTree,
  resolveLedgerDrafts,
  splitCampaignIds,
  treeAdLedgerKey,
  treeCreativeLedgerKey,
  type TreeDb,
  type TreeGraph,
} from "../load.ts";
import { FakeDb } from "./fake-db.ts";

const EVENT = "e0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const RUN = "c0000000-0000-4000-8000-000000000001";
const SIGNUP = "120250000000001";
const PURCHASE = "120250000000002";
const REACH = "120250000000003";
const ADHOC = "120250000000004";

function tables() {
  return {
    events: [{ id: EVENT, event_code: "NX27-GLITTERBOX", client_id: "cl1", meta_campaign_id: `${SIGNUP}, ${ADHOC}` }],
    campaign_drafts: [
      { id: "d1", event_id: EVENT, name: "[NX27-GLITTERBOX] SIGNUP", status: "published", objective: "registration", ad_account_id: "606252931141334", draft_json: { metaCampaignId: SIGNUP } },
      { id: "d2", event_id: EVENT, name: "[NX27-GLITTERBOX] PURCHASE", status: "published", objective: "purchase", ad_account_id: "act_606252931141334", draft_json: { metaCampaignId: PURCHASE } },
      { id: "d9", event_id: EVENT, name: "copy", status: "draft", objective: "purchase", ad_account_id: null, draft_json: {} },
    ],
    launched_ad_sets: [
      { meta_adset_id: "23800000001", meta_campaign_id: SIGNUP, ad_account_id: "act_606252931141334", draft_id: "d1", phase_at_launch: "presale", source_name: "Adv+ Broad", channel: "meta", event_id: EVENT },
      { meta_adset_id: "23800000003", meta_campaign_id: REACH, ad_account_id: "act_606252931141334", draft_id: "d2", phase_at_launch: "on_sale", source_name: "Reach", channel: "meta", event_id: EVENT },
      { meta_adset_id: "23800000009", meta_campaign_id: "999999", ad_account_id: null, draft_id: null, phase_at_launch: null, source_name: null, channel: "tiktok", event_id: EVENT },
    ],
    campaign_additions: [
      { id: "x1", event_id: EVENT, meta_campaign_id: PURCHASE, stage: "on_sale", kind: "creative", meta_adset_ids: ["23800000002"], detail: { creatives: 3, who: "Matas" }, onsale_refresh_line_id: null, created_at: "2026-12-04T10:00:00Z" },
    ],
  };
}

const GRAPH: TreeGraph = {
  async readCampaigns(ids) {
    const all = {
      [SIGNUP]: { id: SIGNUP, name: "[NX27-GLITTERBOX] SIGNUP", effective_status: "ACTIVE", objective: "OUTCOME_LEADS", account_id: "606252931141334", adsets: { data: [{ id: "23800000001", name: "Adv+ Broad", effective_status: "ACTIVE" }, { id: "23800000011", name: "Old", effective_status: "ARCHIVED" }] } },
      [PURCHASE]: { id: PURCHASE, name: "[NX27-GLITTERBOX] PURCHASE", effective_status: "ACTIVE", objective: "OUTCOME_SALES", account_id: "606252931141334", adsets: { data: [{ id: "23800000002", name: "Retargeting · signups", effective_status: "ACTIVE" }] } },
      [REACH]: { id: REACH, name: "[NX27-GLITTERBOX] REACH", effective_status: "PAUSED", objective: "OUTCOME_AWARENESS", account_id: "606252931141334", adsets: { data: [{ id: "23800000003", name: "Reach", effective_status: "CAMPAIGN_PAUSED" }] } },
      [ADHOC]: { id: ADHOC, name: "Made in Ads Manager", effective_status: "DELETED", adsets: { data: [] } },
    };
    return new Map(ids.filter((id) => id in all).map((id) => [id, all[id as keyof typeof all]!]));
  },
};

describe("loading the tree", () => {
  it("splits events.meta_campaign_id", () => {
    assert.deepEqual(splitCampaignIds(`${SIGNUP}, ${PURCHASE},,x`), [SIGNUP, PURCHASE]);
    assert.deepEqual(splitCampaignIds(null), []);
  });

  it("takes campaigns from the event, launched ad sets and published drafts, with Meta's names and statuses", async () => {
    const db = new FakeDb(tables()) as unknown as TreeDb;
    const tree = await loadCampaignTree(db, GRAPH, EVENT);
    assert.ok(tree);
    assert.equal(tree.metaRead, true);
    assert.equal(tree.metaCalls, 1);
    // The deleted Ads Manager campaign and the TikTok ad set are left out; the archived ad set too.
    assert.deepEqual(tree.campaigns.map((c) => c.metaCampaignId).sort(), [SIGNUP, PURCHASE, REACH].sort());
    const signup = tree.campaigns.find((c) => c.metaCampaignId === SIGNUP)!;
    assert.deepEqual(signup.adSets.map((a) => a.id), ["23800000001"]);
    assert.equal(signup.draftId, "d1");
    assert.equal(signup.adAccountId, "act_606252931141334");
    // REACH has no draft of its own; its ad set was launched from the published PURCHASE draft.
    assert.equal(tree.campaigns.find((c) => c.metaCampaignId === REACH)!.draftId, "d2");
    assert.deepEqual(tree.view.stages.map((s) => [s.label, s.campaigns.map((c) => c.meta)]), [
      ["Signup", ["live · 1 ad set"]],
      ["On sale", ["live · 1 ad set", "paused · 1 ad set"]],
    ]);
    assert.equal(tree.view.stages[0]!.campaigns[0]!.master, true);
    assert.deepEqual(tree.view.stages[1]!.campaigns[0]!.additions.map((a) => a.head), ["+ 3 ads added"]);
  });

  it("without Meta, lists the app's campaigns with no status, so nothing starts ticked", async () => {
    const db = new FakeDb(tables()) as unknown as TreeDb;
    const failing: TreeGraph = { readCampaigns: async () => { throw new Error("no token"); } };
    const tree = await loadCampaignTree(db, failing, EVENT);
    assert.ok(tree);
    assert.equal(tree.metaRead, false);
    assert.ok(tree.campaigns.every((c) => c.status === null));
    assert.equal(tree.campaigns.find((c) => c.metaCampaignId === SIGNUP)!.adSets[0]!.name, "Adv+ Broad");
    assert.equal(tree.campaigns.find((c) => c.metaCampaignId === ADHOC)!.name, ADHOC);
  });

  it("returns null for an event it can't read", async () => {
    const db = new FakeDb(tables()) as unknown as TreeDb;
    assert.equal(await loadCampaignTree(db, GRAPH, "e0000000-0000-4000-8000-00000000ffff"), null);
  });

  it("resolves each ticked campaign's published draft for the write ledger, or names the ones with none", async () => {
    const db = new FakeDb(tables()) as unknown as TreeDb;
    const ok = await resolveLedgerDrafts(db, EVENT, [SIGNUP, REACH]);
    assert.deepEqual(ok.ok && [...ok.drafts], [[SIGNUP, "d1"], [REACH, "d2"]]);
    const missing = await resolveLedgerDrafts(db, EVENT, [SIGNUP, ADHOC]);
    assert.deepEqual(missing, { ok: false, missing: [ADHOC] });
  });

  it("never takes an unpublished draft", () => {
    const map = draftsByCampaign(
      [{ id: "d9", name: null, status: "draft", objective: null, adAccountId: null, metaCampaignId: SIGNUP }],
      [{ meta_adset_id: "1", meta_campaign_id: SIGNUP, ad_account_id: null, draft_id: "d9", phase_at_launch: null, source_name: null }],
    );
    assert.equal(map.size, 0);
  });

  it("keys ledger rows by run, campaign, ad set and creative, never the Meta creative id", () => {
    assert.deepEqual(treeCreativeLedgerKey({ runId: RUN, campaignId: SIGNUP, creativeId: "cr1" }), {
      source: "campaign_tree",
      run_id: RUN,
      campaign_id: SIGNUP,
      creative_id: "cr1",
    });
    assert.deepEqual(Object.keys(treeAdLedgerKey({ runId: RUN, campaignId: SIGNUP, adSetId: "a", creativeId: "cr1" })).sort(), [
      "adset_id",
      "campaign_id",
      "creative_id",
      "run_id",
      "source",
    ]);
  });
});

describe("the additions log", () => {
  const input = {
    userId: USER,
    eventId: EVENT,
    stage: "on_sale" as const,
    metaCampaignId: PURCHASE,
    metaAdSetIds: ["23800000002"],
    kind: "audience" as const,
    detail: { runId: RUN, audienceId: "6000000001", audienceName: "Techno page engagers", direction: "include" as const, who: "Matas", source: "campaign_tree" as const },
  };

  it("writes one row per campaign and run, with the operator as owner and author", async () => {
    const db = new FakeDb({ campaign_additions: [] });
    assert.deepEqual(await logCampaignAddition(db as unknown as AdditionsDb, input), { ok: true, merged: false });
    assert.equal(db.inserts.length, 1);
    assert.deepEqual(
      { user: db.inserts[0]!.row.user_id, by: db.inserts[0]!.row.created_by, kind: db.inserts[0]!.row.kind, stage: db.inserts[0]!.row.stage },
      { user: USER, by: USER, kind: "audience", stage: "on_sale" },
    );
  });

  it("a second batch of the same run adds its ad sets to the run's row", async () => {
    const db = new FakeDb({ campaign_additions: [] });
    await logCampaignAddition(db as unknown as AdditionsDb, input);
    const again = await logCampaignAddition(db as unknown as AdditionsDb, { ...input, metaAdSetIds: ["23800000002", "23800000012"] });
    assert.deepEqual(again, { ok: true, merged: true });
    assert.equal(db.inserts.length, 1);
    assert.deepEqual(db.tables.campaign_additions![0]!.meta_adset_ids, ["23800000002", "23800000012"]);
  });

  it("adds a creative run's ads up across batches", async () => {
    const db = new FakeDb({ campaign_additions: [] });
    const creative = { ...input, kind: "creative" as const, detail: { runId: RUN, creatives: 3, ads: 6, who: "Matas", source: "campaign_tree" as const } };
    await logCampaignAddition(db as unknown as AdditionsDb, creative);
    await logCampaignAddition(db as unknown as AdditionsDb, { ...creative, detail: { ...creative.detail, ads: 3 } });
    assert.equal((db.tables.campaign_additions![0]!.detail as { ads: number }).ads, 9);
  });

  it("logs nothing when no ad set got it", async () => {
    const db = new FakeDb({ campaign_additions: [] });
    assert.deepEqual(await logCampaignAddition(db as unknown as AdditionsDb, { ...input, metaAdSetIds: [] }), { ok: true, merged: false });
    assert.equal(db.inserts.length, 0);
  });

  it("names the operator by first name", () => {
    assert.equal(additionWho({ full_name: "Matas Example" }), "Matas");
    assert.equal(additionWho({}), null);
  });
});
