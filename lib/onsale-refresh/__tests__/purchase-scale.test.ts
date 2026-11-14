/**
 * P4 PR C — Scale Purchase and Copy an audience (PC4, PC5, HP4), PC6's
 * verdicts (HP5), on fakes only. No Meta call is real.
 */
import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { applyCopyAudience, applyScalePurchase, COPY_SWITCHED_OFF, SCALE_SWITCHED_OFF } from "../apply-purchase-scale.ts";
import { copyCandidates, copyAppliedText, NO_AUDIENCE_TO_COPY, purchaseJudgedText, runningFrom, scaleAppliedText, scaleFailedText, scalePurchase, type ScaleInput } from "../purchase-scale.ts";
import { judgePurchaseLine, pickTally, pickVerdict, purchaseCampaignIds, purchaseWindow } from "../purchase-scoring.ts";
import { judgedWeek, scoreOnsaleRefresh } from "../scoring.ts";
import { computeTrackRecords } from "../track-record.ts";
import { writeGateOpen } from "../line-states.ts";
import { memoryDb } from "./memory-db.ts";

const PURCHASE = "pc1";
const MAIN = "main1";
const running = { campaignId: PURCHASE, campaignName: "[NX26-LOCKLEAD] Locklead - Purchase", mainCampaignId: MAIN, mainCampaignKey: "[NX26-LOCKLEAD] On Sale", mainShort: "On Sale", startedOn: "2026-11-16", lastStepOn: null, rate: 5, copied: { ids: ["s-lineup", "s-venue"], names: ["Lineup - Suggested", "Venue"] }, ads: [{ adId: "a1", name: "Artist - UGC 3" }], pixelId: "645185673672763", path: "platform" as const };
const PF4: ScaleInput = {
  running,
  runDay: "2026-11-30",
  windowEnd: "2026-11-29",
  eventDate: "2026-12-11",
  signalHolds: true,
  purchase: { spend: 70, purchases: 6, spentToDate: 70, lifetime: 130 },
  main: { spend: 560, purchases: 14, spentToDate: 850, lifetime: 1370, last7Daily: 40 },
  budgetGbp: null,
  spendToDateGbp: 920,
  committedGbp: null,
};
const input = (over: Partial<ScaleInput> = {}, purchase: Partial<ScaleInput["purchase"]> = {}, main: Partial<ScaleInput["main"]> = {}): ScaleInput => ({ ...PF4, ...over, purchase: { ...PF4.purchase, ...purchase }, main: { ...PF4.main, ...main } });

describe("P4 PC4: Scale Purchase", () => {
  it("PF4: up, £5 → £10 a day, lifetime £130 → £190, On Sale £1,370 → £1,310 — the record's words exactly", () => {
    const result = scalePurchase(PF4);
    assert.equal(result.kind, "line");
    if (result.kind !== "line") return;
    assert.equal(result.title, "Scale Purchase up: £5 → £10 a day");
    assert.equal(result.detail, "Since Mon 16 Nov: Purchase £11.67 per attributed purchase (6), On Sale £40.00 (14) · 0.29×");
    assert.equal(result.writeText, "Purchase £5 → £10 a day: lifetime £130 → £190 · On Sale lifetime £1,370 → £1,310 (12 days × £5) · On Sale keeps at least £970 (spent £850 + 3 days at £40)");
    assert.equal(result.capText, "The extra £60 is within 20 % of what On Sale has left (£104); this event has no budget.");
    assert.deepEqual([result.write.fromRate, result.write.toRate, result.write.daysLeft, result.write.move, result.write.headroom, result.write.purchaseAfter, result.write.mainAfter], [5, 10, 12, 60, 0, 190, 1310]);
  });

  it("checked only after 7 full days since the start or the last step, and only while the signal holds", () => {
    assert.equal(scalePurchase(input({ windowEnd: "2026-11-23" })).kind, "line", "started Mon 16 Nov: 17–23 Nov is 7 full days");
    assert.equal(scalePurchase(input({ windowEnd: "2026-11-22" })).kind, "none", "17–22 Nov is 6: not yet");
    assert.equal(scalePurchase(input({ running: { ...running, lastStepOn: "2026-11-25" } })).kind, "none");
    assert.equal(scalePurchase(input({ signalHolds: false })).kind, "none");
  });

  it("hold, as a note: under 3 purchases, or within 1.5×", () => {
    assert.deepEqual(scalePurchase(input({}, { purchases: 2 })), { kind: "hold", note: "Purchase holds at £5 a day: 2 purchases since Mon 16 Nov; a step needs 3." });
    assert.deepEqual(scalePurchase(input({}, { spend: 180, purchases: 4 })), { kind: "hold", note: "Purchase holds at £5 a day: £45.00 per attributed purchase, within 1.5× of On Sale." });
  });

  it("down, halving above 1.5× with 3+ purchases, never below £5; the commitment goes back to the main campaign, never under Purchase's spend", () => {
    const down = scalePurchase(input({ running: { ...running, rate: 20 } }, { spend: 400, purchases: 4, lifetime: 600, spentToDate: 400 }));
    assert.equal(down.kind, "line");
    if (down.kind !== "line") return;
    assert.equal(down.title, "Scale Purchase down: £20 → £10 a day");
    // £10 × 12 days = £120 back; Purchase £600 → £480, On Sale £1,370 → £1,490.
    assert.deepEqual([down.write.move, down.write.purchaseAfter, down.write.mainAfter], [-120, 480, 1490]);
    const capped = scalePurchase(input({ running: { ...running, rate: 20 } }, { spend: 400, purchases: 4, lifetime: 450, spentToDate: 400 }));
    assert.equal(capped.kind === "line" && capped.write.purchaseAfter, 400, "never under its spend to date");
    assert.deepEqual(scalePurchase(input({}, { spend: 400, purchases: 4 })), { kind: "hold", note: "Purchase holds at £5 a day: £100.00 per attributed purchase, over 1.5× of On Sale, and £5 a day is the floor." });
  });

  it("the cap and the floor allow less than double: the largest whole £5; under +£5 it holds and says why", () => {
    // At £10 a day: 20 % of (£1,370 − £850) = £104 over 12 days is £8.67 a day: +£5, not +£10.
    const partial = scalePurchase(input({ running: { ...running, rate: 10 } }));
    assert.equal(partial.kind === "line" && partial.title, "Scale Purchase up: £10 → £15 a day");
    const tight = scalePurchase(input({}, {}, { lifetime: 1100 }));
    assert.deepEqual(tight, { kind: "hold", note: "Purchase holds at £5 a day: 20 % of what On Sale has left and On Sale's floor leave less than £5 a day more." });
  });

  it("headroom first, then the main campaign's lifetime, with an event budget", () => {
    const result = scalePurchase(input({ budgetGbp: 5000, spendToDateGbp: 2000, committedGbp: 2970 }));
    // £30 headroom covers half of the £60; £30 moves from On Sale.
    assert.equal(result.kind === "line" && `${result.write.headroom}/${result.write.move}`, "30/30");
    assert.equal(result.kind === "line" && result.capText, "The extra £60 is within 20 % of the plan left (£600).");
  });
});

describe("P4 PC4: Copy an audience into Purchase", () => {
  it("5+ purchases in the week at ≤ 0.75× the event's cost, not already copied, cheapest first", () => {
    const sets = [
      { adsetId: "s-a", name: "Disco Pages", spend: 100, purchases: 6 },
      { adsetId: "s-b", name: "Tech House Pages", spend: 60, purchases: 5 },
      { adsetId: "s-lineup", name: "Lineup - Suggested", spend: 50, purchases: 9 },
      { adsetId: "s-c", name: "Venue 2", spend: 200, purchases: 5 },
      { adsetId: "s-d", name: "Thin", spend: 10, purchases: 4 },
    ];
    const rows = copyCandidates(sets, running, { spend: 1000, purchases: 40 });
    assert.deepEqual(rows.map((row) => row.set.name), ["Tech House Pages", "Disco Pages"]);
    assert.deepEqual(copyCandidates(sets, running, { spend: 0, purchases: 0 }), []);
    assert.equal(NO_AUDIENCE_TO_COPY, "No audience to copy into Purchase: none had 5 purchases at 0.75× the event's cost last week.");
  });
});

describe("P4 HP4: the running Purchase campaign, from the applied lines", () => {
  it("its id, rate, start, last step and copies", () => {
    const lines = [
      { kind: "purchase_campaign", applied_at: "2026-11-16T08:37:00Z", write: { campaignName: "[X] Show - Purchase", mainCampaignId: MAIN, mainCampaignKey: "[X] On Sale", mainShort: "On Sale", pixelId: "p", path: "platform", endDay: "2026-12-11", dailyGbp: 5, picks: [{ adsetId: "s1", name: "A" }], ads: [{ adId: "a1", name: "Ad" }] }, applied_result: { purchase: { campaignId: PURCHASE, rate: 5, adSets: { s1: { id: "c1", role: "purchase", name: "A · Purchase" } } } } },
      { kind: "scale_purchase", applied_at: "2026-11-30T08:44:00Z", write: { purchaseCampaignId: PURCHASE, toRate: 10 }, applied_result: {} },
      { kind: "copy_audience", applied_at: "2026-11-30T08:45:00Z", write: { purchaseCampaignId: PURCHASE, sourceAdsetId: "s9", sourceName: "Disco" }, applied_result: {} },
    ];
    const got = runningFrom(lines)!;
    assert.deepEqual([got.campaignId, got.rate, got.startedOn, got.lastStepOn, got.endDay], [PURCHASE, 10, "2026-11-16", "2026-11-30", "2026-12-11"]);
    assert.deepEqual(got.copied.names, ["A", "Disco"]);
    assert.equal(runningFrom([{ ...lines[0]!, applied_result: {} }]), null, "no campaign made yet");
  });
});

describe("P4 PC5: the Scale and Copy words, and F3's judged sentence", () => {
  it("as the record writes them", () => {
    assert.equal(scaleAppliedText({ fromRate: 5, toRate: 10, purchaseBefore: 130, purchaseAfter: 190, mainBefore: 1370, mainAfter: 1310 }, "On Sale"), "Purchase £5 → £10 a day (£130 → £190) · On Sale £1,370 → £1,310");
    assert.equal(scaleFailedText("Meta is busy"), "Meta is busy. Both budgets are as they were.");
    assert.equal(copyAppliedText("Disco Pages"), "Disco Pages · Purchase is live");
    assert.equal(purchaseJudgedText({ startedOn: "2026-11-16", endDay: "2026-12-11" }, { appliedOn: "2026-11-30", direction: "up" }), "The Purchase line is judged on 16–29 Nov (its first 14 days), with which pick won; the step up on the week to Sun 6 Dec.");
  });
});

function scaleWrite(over: Record<string, unknown> = {}) {
  const result = scalePurchase(PF4);
  if (result.kind !== "line") throw new Error("PF4 steps up");
  return { ...result.write, mainShort: "On Sale", ...over };
}

function fakeBudgets(start: Record<string, number>) {
  const live = { ...start };
  const calls: [string, number][] = [];
  return {
    calls,
    live,
    meta: {
      async readCampaignBudget(id: string) {
        return { daily: null, lifetime: live[id] ?? null };
      },
      async updateCampaign(id: string, fields: { lifetime_budget?: number }) {
        if (fields.lifetime_budget == null) return;
        calls.push([id, fields.lifetime_budget]);
        live[id] = fields.lifetime_budget;
      },
    },
  };
}

const ledgerFor = () => {
  const mem = memoryDb({ meta_write_idempotency: [] });
  return { ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, plainMetaReason: (err: unknown) => (err instanceof Error ? err.message : String(err)) };
};
const ON = { ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED: "1", ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED: "1" };
const scaleDeps = (meta: ReturnType<typeof fakeBudgets>["meta"], env: Record<string, string> = ON) => ({ env, meta, plan: { budget: null, spend: 0, appliedMovesGbp: 0 }, mainSpentNow: 850, purchaseSpentNow: 70 });

describe("P4 PC4: Scale's write order, with the first write put back on failure", () => {
  it("the cross-campaign move gate off: nothing written", async () => {
    const fake = fakeBudgets({ [MAIN]: 137000, [PURCHASE]: 13000 });
    const out = await applyScalePurchase(scaleDeps(fake.meta, {}), { id: "l1", write: scaleWrite() }, ledgerFor());
    assert.equal(out.reason, `${SCALE_SWITCHED_OFF}. Both budgets are as they were.`);
    assert.deepEqual(fake.calls, []);
    assert.equal(writeGateOpen({ kind: "scale_purchase", state: "accepted" }, { pauseWritesEnabled: false, lifetimeBudgetWritesEnabled: true }), true);
  });

  it("up: the main campaign lowered first, then Purchase raised", async () => {
    const fake = fakeBudgets({ [MAIN]: 137000, [PURCHASE]: 13000 });
    const out = await applyScalePurchase(scaleDeps(fake.meta), { id: "l1", write: scaleWrite() }, ledgerFor());
    assert.equal(out.state, "applied");
    assert.equal(out.reason, "Purchase £5 → £10 a day (£130 → £190) · On Sale £1,370 → £1,310");
    assert.deepEqual(fake.calls, [[MAIN, 131000], [PURCHASE, 19000]]);
  });

  it("down: Purchase lowered first, then the main campaign raised", async () => {
    const down = scalePurchase(input({ running: { ...running, rate: 20 } }, { spend: 400, purchases: 4, lifetime: 600, spentToDate: 400 }));
    if (down.kind !== "line") throw new Error("steps down");
    const fake = fakeBudgets({ [MAIN]: 137000, [PURCHASE]: 60000 });
    const out = await applyScalePurchase({ ...scaleDeps(fake.meta), purchaseSpentNow: 400 }, { id: "l1", write: { ...down.write, mainShort: "On Sale" } }, ledgerFor());
    assert.equal(out.state, "applied");
    assert.deepEqual(fake.calls, [[PURCHASE, 48000], [MAIN, 149000]]);
  });

  it("the second write fails: the first is put back, and the line says both budgets are as they were", async () => {
    const fake = fakeBudgets({ [MAIN]: 137000, [PURCHASE]: 13000 });
    const meta = { ...fake.meta, async updateCampaign(id: string, fields: { lifetime_budget?: number }) {
      if (id === PURCHASE) throw new Error("Meta is busy");
      return fake.meta.updateCampaign(id, fields);
    } };
    const out = await applyScalePurchase(scaleDeps(meta as never), { id: "l1", write: scaleWrite() }, ledgerFor());
    assert.equal(out.state, "failed");
    assert.equal(out.reason, "Meta is busy. Both budgets are as they were.");
    assert.equal(fake.live[MAIN], 137000, "On Sale put back");
  });

  it("a budget changed in Ads Manager, the floor or the cap: nothing written", async () => {
    const changed = fakeBudgets({ [MAIN]: 120000, [PURCHASE]: 13000 });
    assert.equal((await applyScalePurchase(scaleDeps(changed.meta), { id: "l1", write: scaleWrite() }, ledgerFor())).reason, "On Sale's budget changed in Ads Manager since the proposal. Both budgets are as they were.");
    const fake = fakeBudgets({ [MAIN]: 137000, [PURCHASE]: 13000 });
    const floor = await applyScalePurchase({ ...scaleDeps(fake.meta), plan: { budget: 100000, spend: 0, appliedMovesGbp: 0 }, mainSpentNow: 1250 }, { id: "l1", write: scaleWrite() }, ledgerFor());
    assert.match(floor.reason!, /^On Sale would go under £1,370 \(spent £1,250 \+ 3 days\)/);
    const cap = await applyScalePurchase({ ...scaleDeps(fake.meta), plan: { budget: null, spend: 0, appliedMovesGbp: 80 } }, { id: "l1", write: scaleWrite() }, ledgerFor());
    assert.match(cap.reason!, /over this refresh's 20 % cap/);
    assert.deepEqual(fake.calls, []);
  });

  it("a Retry after both writes landed changes nothing more", async () => {
    const fake = fakeBudgets({ [MAIN]: 131000, [PURCHASE]: 19000 });
    const out = await applyScalePurchase(scaleDeps(fake.meta), { id: "l1", write: scaleWrite() }, ledgerFor());
    assert.equal(out.state, "applied");
    assert.deepEqual(fake.calls, []);
  });
});

describe("P4 PC4: Copy an audience, applied", () => {
  const write = { kind: "purchase_copy_audience", purchaseCampaignId: PURCHASE, sourceAdsetId: "s-a", sourceName: "Disco Pages", pixelId: "645185673672763", customConversionId: null, endDay: "2026-12-11", ads: [{ adId: "a1", name: "Artist - UGC 3" }] };
  const calls: [string, unknown][] = [];
  const meta = {
    readAdSetForCopy: async () => ({ targeting: { age_min: 18 }, attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }] }),
    readAd: async (adId: string) => ({ id: adId, name: "Artist - UGC 3", creativeId: "cr1", effectiveStatus: "ACTIVE" }),
    createAdSet: async (_: string, payload: Record<string, unknown>) => (calls.push(["createAdSet", payload]), "set9"),
    createAd: async (_: string, ad: unknown) => (calls.push(["createAd", ad]), "ad9"),
    setAdSetActive: async (id: string) => void calls.push(["setAdSetActive", id]),
  };
  it("made paused in the Purchase campaign by PC3's rules, its ads, then switched on; no money", async () => {
    const out = await applyCopyAudience({ env: ON, meta: meta as never }, { id: "l2", write }, { ...ledgerFor(), adAccountId: "act_1" });
    assert.equal(out.reason, "Disco Pages · Purchase is live");
    const payload = calls[0]![1] as Record<string, unknown>;
    assert.deepEqual([payload.campaign_id, payload.status, payload.name, (payload.promoted_object as { custom_event_type: string }).custom_event_type], [PURCHASE, "PAUSED", "Disco Pages · Purchase", "PURCHASE"]);
    assert.equal("daily_budget" in payload, false);
    assert.deepEqual(calls.map(([name]) => name), ["createAdSet", "createAd", "setAdSetActive"]);
  });
  it("behind the campaign-create gate", async () => {
    assert.equal((await applyCopyAudience({ env: {}, meta: meta as never }, { id: "l3", write }, { ...ledgerFor(), adAccountId: "act_1" })).reason, COPY_SWITCHED_OFF);
  });
});

// ── PC6 ──────────────────────────────────────────────────────────────────────

const purchaseLine = (over: Record<string, unknown> = {}) => ({
  id: "lp",
  proposal_id: "p1",
  user_id: "u1",
  kind: "purchase_campaign",
  rule_id: "purchase_campaign.proposed",
  state: "applied",
  target: {},
  evidence: {},
  write: { kind: "purchase_campaign_create", mainCampaignId: MAIN, endDay: "2026-12-11", noPurchasePick: false },
  applied_result: { purchase: { campaignId: PURCHASE, adSets: { s1: { id: "c-p", role: "purchase", name: "A · Purchase" }, s2: { id: "c-c", role: "checkout", name: "B · Purchase" } } } },
  applied_at: "2026-11-16T08:37:00Z",
  ...over,
});
const day = (campaign: string, adset: string, spend: number, purchases: number, date = "2026-11-20") => ({ meta_ad_id: `${adset}-${date}`, meta_adset_id: adset, meta_campaign_id: campaign, date, ad_name: "x", spend, landing_page_views: 0, actions: [], purchases });

describe("P4 PC6: how P5 scores the Purchase campaign", () => {
  it("judged on its first 14 days (to the show if sooner); a copied audience after 7 days", () => {
    assert.deepEqual(purchaseWindow(purchaseLine() as never), { from: "2026-11-16", to: "2026-11-29" });
    assert.deepEqual(purchaseWindow(purchaseLine({ write: { endDay: "2026-11-25" } }) as never), { from: "2026-11-16", to: "2026-11-25" });
    assert.deepEqual(judgedWeek(purchaseLine() as never, { run_day: "2026-11-16" }), { from: "2026-11-16", to: "2026-11-29" });
    assert.deepEqual(purchaseWindow({ kind: "copy_audience", state: "applied", write: {}, applied_result: {}, applied_at: "2026-11-30T08:45:00Z" }), { from: "2026-12-01", to: "2026-12-07" });
    assert.deepEqual(purchaseCampaignIds(purchaseLine() as never), [PURCHASE, MAIN]);
  });

  it("right at or below the main campaign's cost per purchase with 3+; under 3 is no verdict", () => {
    const rows = [day(PURCHASE, "c-p", 40, 3), day(PURCHASE, "c-c", 20, 1), day(MAIN, "m1", 400, 10)];
    assert.equal(judgePurchaseLine(purchaseLine() as never, rows, {}).outcome, "right");
    assert.equal(judgePurchaseLine(purchaseLine() as never, [day(PURCHASE, "c-p", 90, 3), day(MAIN, "m1", 200, 10)], {}).outcome, "wrong");
    const thin = judgePurchaseLine(purchaseLine() as never, [day(PURCHASE, "c-p", 40, 2), day(MAIN, "m1", 400, 10)], {});
    assert.deepEqual([thin.outcome, thin.reason], ["no_verdict", "2 purchases in its first 14 days; a verdict needs 3."]);
  });

  it("which pick won: the lower cost per purchase when each copy has 3+; else no verdict; CBO's spend split stored; Both picks records no test", () => {
    const won = pickVerdict(purchaseLine() as never, [day(PURCHASE, "c-p", 30, 3), day(PURCHASE, "c-c", 90, 3)]);
    assert.deepEqual([won.verdict, won.split], ["purchase_pick", { purchase_pick: 0.25, checkout_pick: 0.75 }]);
    assert.equal(pickVerdict(purchaseLine() as never, [day(PURCHASE, "c-p", 30, 3), day(PURCHASE, "c-c", 90, 2)]).verdict, "no_verdict");
    const both = purchaseLine({ applied_result: { purchase: { campaignId: PURCHASE, adSets: { s1: { id: "c-p", role: "both", name: "A" }, s2: { id: "c-c", role: "checkout", name: "B" } } } } });
    assert.equal(pickVerdict(both as never, []).verdict, "no_test");
    assert.equal(pickVerdict(purchaseLine({ write: { noPurchasePick: true } }) as never, []).verdict, "no_test");
  });

  it("shadow or rejected: right if the next full week's refresh still read the signal as Proposed", () => {
    const shadow = purchaseLine({ state: "to_review", applied_at: null, applied_result: null });
    assert.equal(judgePurchaseLine(shadow as never, [], { nextWeekState: "platform_proposed" }).outcome, "right");
    assert.equal(judgePurchaseLine(shadow as never, [], { nextWeekState: "platform_under_bar" }).outcome, "wrong");
    assert.equal(judgePurchaseLine(shadow as never, [], { nextWeekState: null }).outcome, "unknown");
  });

  it("scale up within 20 %, scale down lower; a copy at or below the campaign's", () => {
    const up = { kind: "scale_purchase", state: "applied", write: { purchaseCampaignId: PURCHASE, direction: "up", before: { cpp: 10 } }, applied_result: {}, applied_at: "2026-11-30T08:44:00Z" };
    assert.equal(judgePurchaseLine(up, [day(PURCHASE, "c-p", 36, 3)], {}).outcome, "right");
    assert.equal(judgePurchaseLine(up, [day(PURCHASE, "c-p", 39, 3)], {}).outcome, "wrong");
    assert.equal(judgePurchaseLine({ ...up, write: { ...up.write, direction: "down" } }, [day(PURCHASE, "c-p", 27, 3)], {}).outcome, "right");
    const copy = { kind: "copy_audience", state: "applied", write: { purchaseCampaignId: PURCHASE }, applied_result: { adsetId: "c9" }, applied_at: "2026-11-30T08:45:00Z" };
    assert.equal(judgePurchaseLine(copy, [day(PURCHASE, "c9", 30, 3), day(PURCHASE, "c-p", 90, 3)], {}).outcome, "right");
  });

  it("no verdict never counts towards a hit rate; the pick tally is per client", () => {
    const records = computeTrackRecords(Array.from({ length: 12 }, () => ({ client_id: "c", rule_id: "purchase_campaign.proposed", outcome: "no_verdict" })));
    assert.equal(records.get("c|purchase_campaign.proposed"), undefined);
    const tally = pickTally([
      { client_id: "c", kind: "purchase_campaign", figures: { pick: { verdict: "purchase_pick" } } },
      { client_id: "c", kind: "purchase_campaign", figures: { pick: { verdict: "no_verdict" } } },
      { client_id: "c", kind: "purchase_campaign", figures: { pick: { verdict: "no_test" } } },
    ]);
    assert.deepEqual(tally.get("c"), { purchase_pick: 1, checkout_pick: 0, no_verdict: 1 });
  });

  it("the nightly job stores a Purchase campaign's verdict, with the Purchase and main campaigns' ad-days", async () => {
    const mem = memoryDb({
      ad_daily_insights: [day(PURCHASE, "c-p", 40, 3, "2026-11-20"), day(PURCHASE, "c-c", 20, 1, "2026-11-21"), day(MAIN, "m1", 400, 10, "2026-11-22"), day(MAIN, "m1", 1, 0, "2026-11-29")],
      onsale_refresh_proposals: [{ id: "p1", event_id: "e1", user_id: "u1", campaign_key: "[X] On Sale", campaign_ids: [MAIN], run_day: "2026-11-16", window_end: "2026-11-15", objective: "initiate_checkout" }],
      onsale_refresh_lines: [purchaseLine()],
      onsale_refresh_outcomes: [],
      events: [{ id: "e1", client_id: "client-a" }],
    });
    const result = await scoreOnsaleRefresh(mem.db, { now: new Date("2026-11-30T03:30:00Z") });
    const row = result.rows[0]!;
    assert.deepEqual([row.outcome, row.week_from, row.week_to, row.kind], ["right", "2026-11-16", "2026-11-29", "purchase_campaign"]);
    assert.equal((row.figures.pick as { verdict: string }).verdict, "no_verdict");
  });
});

describe("P4 migration 244", () => {
  it("adds the two line kinds and no_verdict, keeping every existing value", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/244_onsale_refresh_purchase_scale.sql", import.meta.url), "utf8");
    assert.match(sql, /'add_creative', 'claim_ready', 'pause_creative', 'bring_back_audience', 'missing_default', 'drop_audience', 'move_budget', 'purchase_campaign', 'scale_purchase', 'copy_audience'/);
    assert.match(sql, /'right', 'wrong', 'unknown', 'no_verdict'/);
  });
});

describe("P4 PC4: the lines on the proposals", async () => {
  const { purchaseScaleLines } = await import("../rules.ts");
  const scale = scalePurchase(PF4);
  const plan = { running: { ...running, endDay: "2026-12-11", customConversionId: null }, scale, copies: [{ candidate: { adsetId: "s-b", name: "Tech House Pages", spend: 60, purchases: 5 }, text: { title: "Tech House Pages", detail: "d", narrowDetail: "n", writeText: "w" }, cpp: 12, ratio: 0.48 }], copyNote: null };
  const input = (isMain: boolean) => ({ campaignIds: [MAIN], adAccountId: "act_1", draft: { draftId: "d1", adAccountId: "act_1", copy: null }, purchaseCampaign: { plan: { state: "running" }, isMain, budget: { plan: null, main: null }, scale: plan } }) as never;
  it("Scale and Copy go on the main campaign only, with the writes Apply needs and the notes the panel draws", () => {
    assert.deepEqual(purchaseScaleLines(input(false)), { lines: [], notes: null });
    const out = purchaseScaleLines(input(true));
    assert.deepEqual(out.lines.map((line) => [line.kind, line.ruleId]), [["scale_purchase", "scale_purchase.up"], ["copy_audience", "copy_audience.winner"]]);
    assert.deepEqual([out.lines[0]!.write!.kind, out.lines[0]!.write!.toRate, out.lines[1]!.write!.kind, out.lines[1]!.write!.sourceAdsetId], ["purchase_scale", 10, "purchase_copy_audience", "s-b"]);
    assert.equal(out.notes!.cap, "The extra £60 is within 20 % of what On Sale has left (£104); this event has no budget.");
  });
});
