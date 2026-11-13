/**
 * P3 of the on-sale refresh: audiences and budget. Bring back a stopped ad
 * set and Drop through the new gated ad-set status write; within-campaign
 * moves through the optimisation budget write, under the plan guard and
 * the 20 % cap. Every Meta call is a fake; nothing reaches a network.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { AdSetStatusWritesDisabledError, adsetStatusWritesEnabled, writeAdSetStatus } from "../../meta/adset-status-write.ts";
import { APPLY_ENV, applyGates } from "../apply-gates.ts";
import { applyAccepted, movedText, type ApplyDeps, type AdSetNow, type RefreshMeta } from "../apply.ts";
import { LAST_ADSET_STAYS, RETARGETING_STAYS, acceptBlock, decideLine } from "../decide.ts";
import { appliesNow, heldText } from "../line-states.ts";
import { NO_BUDGET_TO_START } from "../new-adset.ts";
import { MOVE_NEEDS_BUDGET, SPEND_NEEDS_BUDGET, daysToShow, moveGuard, planGuard, projectedSpend, spendLineBlock } from "../plan-guard.ts";
import { loadEventProposals } from "../read.ts";
import { memoryDb, type MemoryDb } from "./memory-db.ts";
import { OR8_MOVE_CAP, OR8_PLAN_GUARD } from "../../../scripts/plan-frames/refresh-fixtures.ts";

const EMBEDS = { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } };
const ALL_ENV = { [APPLY_ENV]: "1", OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1" };
const live = (env: Record<string, string> = ALL_ENV) => applyGates(env, "live");
const NOW = new Date("2026-11-16T08:41:00Z");
const WHERE = { campaignIds: ["c1"], adAccountId: "act_9", draftId: "d1" };

function line(id: string, kind: string, extra: Record<string, unknown> = {}) {
  return { id, proposal_id: "p1", position: 1, kind, title: id, detail: "", write_text: "", narrow: {}, adds_spend: kind === "bring_back_audience", blocked_reason: null, supply: false, state: "accepted", reason: null, target: {}, evidence: {}, write: {}, applied_result: null, ...extra };
}

const bringBack = (id = "bb", extra: Record<string, unknown> = {}) =>
  line(id, "bring_back_audience", { title: "Electronic dance music, Electronic music", evidence: { dailySpend: 5.26 }, write: { kind: "adset_status", adsetId: "301", status: "ACTIVE", ...WHERE }, ...extra });
const drop = (id = "dr", extra: Record<string, unknown> = {}) =>
  line(id, "drop_audience", { title: "Lineup — Primary", evidence: { deliveringAdSets: 3 }, write: { kind: "adset_status", adsetId: "302", status: "PAUSED", ...WHERE }, ...extra });
const move = (id = "mv", amountGbp = 14.18, extra: Record<string, unknown> = {}) =>
  line(id, "move_budget", { title: "Lineup — Primary → Adv+", write: { kind: "adset_budget_move", fromAdsetId: "302", toAdsetId: "303", amountGbp, ...WHERE }, ...extra });

function seed(lines: Record<string, unknown>[], overrides: { budget?: number | null; spend?: number; proposals?: Record<string, unknown>[] } = {}): MemoryDb {
  return memoryDb(
    {
      events: [{ id: "e1", user_id: "u1", budget_marketing: overrides.budget === undefined ? 4500 : overrides.budget, event_date: "2026-12-27" }],
      event_daily_rollups: [{ event_id: "e1", date: "2026-11-15", ad_spend: overrides.spend ?? 1994.15 }],
      onsale_refresh_proposals: overrides.proposals ?? [{ id: "p1", event_id: "e1", campaign_key: "On Sale", campaign_ids: ["c1"], window_end: "2026-11-15", cycle_monday: "2026-11-16" }],
      onsale_refresh_lines: lines,
      campaign_drafts: [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", status: "published", meta_campaign_id: "c1", import_campaign_id: null, creatives: [] }],
      launched_ad_sets: [],
      meta_write_idempotency: [],
    },
    EMBEDS,
  );
}

type Fake = RefreshMeta & { calls: string[]; sets: Record<string, AdSetNow>; failBudgetOnce: Set<string> };

function fakeMeta(over: Record<string, Partial<AdSetNow>> = {}): Fake {
  const sets: Record<string, AdSetNow> = {
    "301": { id: "301", campaignId: "c1", status: "PAUSED", effectiveStatus: "PAUSED", name: "Electronic dance music, Electronic music", dailyBudget: 1000 },
    "302": { id: "302", campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Lineup — Primary", dailyBudget: 2000 },
    "303": { id: "303", campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Adv+", dailyBudget: 1500 },
    "304": { id: "304", campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Retargeting — 30d", dailyBudget: 500 },
  };
  for (const [id, patch] of Object.entries(over)) sets[id] = { ...(sets[id] ?? { id, campaignId: "c1", effectiveStatus: null }), ...patch } as AdSetNow;
  const calls: string[] = [];
  const failBudgetOnce = new Set<string>();
  return {
    calls,
    sets,
    failBudgetOnce,
    async readAdSet(id) {
      calls.push(`read:${id}`);
      return sets[id] ? { ...sets[id]! } : null;
    },
    async listAdSets(campaignId) {
      calls.push(`list:${campaignId}`);
      return Object.values(sets).filter((set) => set.campaignId === campaignId).map((set) => ({ ...set }));
    },
    async postAdSetStatus(id, status) {
      calls.push(`adset_status:${id}:${status}`);
      sets[id]!.status = status;
      sets[id]!.effectiveStatus = status;
    },
    async updateAdSetDailyBudget(id, pence) {
      calls.push(`budget:${id}:${pence}`);
      if (failBudgetOnce.has(id)) {
        failBudgetOnce.delete(id);
        throw Object.assign(new Error("User request limit reached"), { code: 17 });
      }
      sets[id]!.dailyBudget = pence;
    },
    async post() {
      throw new Error("no ad-status write in P3 tests");
    },
    async listAds() {
      return [];
    },
    async createCreative() {
      throw new Error("no creative in P3 tests");
    },
    async createAd() {
      throw new Error("no ad in P3 tests");
    },
  };
}

function deps(mem: MemoryDb, meta: RefreshMeta, env: Record<string, string> = ALL_ENV): ApplyDeps {
  return { db: mem.db, env, meta, copyFromDrive: async () => ({ ok: false, reason: "no Drive in P3 tests" }), upload: async () => ({}), now: NOW };
}

const apply = (mem: MemoryDb, meta: RefreshMeta, opts: { env?: Record<string, string>; retry?: boolean } = {}) =>
  applyAccepted({ deps: deps(mem, meta, opts.env), eventId: "e1", userId: "u1", gates: live(opts.env), retry: opts.retry });

const lineOf = (mem: MemoryDb, id: string) => mem.tables.onsale_refresh_lines!.find((row) => row.id === id)!;
const writes = (meta: Fake) => meta.calls.filter((call) => call.startsWith("adset_status:") || call.startsWith("budget:"));

// ── The gated ad-set status write ────────────────────────────────────────────

describe("on-sale refresh P3: the gated ad-set status write (lib/meta/adset-status-write.ts)", () => {
  it("OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED exactly \"true\", default off; off refuses before the ledger", async () => {
    assert.equal(adsetStatusWritesEnabled({}), false);
    assert.equal(adsetStatusWritesEnabled({ OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "1" }), false);
    assert.equal(adsetStatusWritesEnabled({ OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true" }), true);
    const mem = seed([]);
    const posted: string[] = [];
    await assert.rejects(() => writeAdSetStatus({ env: {}, ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, graph: { postAdSetStatus: async (id) => void posted.push(id) }, adsetId: "301", status: "ACTIVE" }), AdSetStatusWritesDisabledError);
    assert.deepEqual(posted, []);
    assert.equal(mem.tables.meta_write_idempotency!.length, 0);
  });

  it("writes through the ledger as adset_status_update; the same ask again isn't re-sent", async () => {
    const mem = seed([]);
    const posted: string[] = [];
    const args = { env: { OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true" }, ledger: { supabase: mem.db, userId: "u1", draftId: "d1", eventId: "e1" }, graph: { postAdSetStatus: async (id: string) => void posted.push(id) }, adsetId: "301", status: "ACTIVE" as const, key: "bb" };
    await writeAdSetStatus(args);
    await writeAdSetStatus(args);
    assert.deepEqual(posted, ["301"]);
    assert.ok(mem.tables.meta_write_idempotency!.every((row) => row.op_kind === "adset_status_update" && row.op_status === "success"));
    await assert.rejects(() => writeAdSetStatus({ ...args, adsetId: "301&status=PAUSED" }), /not a Meta ad set id/);
  });
});

// ── Gates and holds ──────────────────────────────────────────────────────────

describe("on-sale refresh P3: each write's own gate; new ad sets held", () => {
  it("Bring back and Drop need the ad-set status gate; moves need ENABLE_OPTIMISATION_WRITES", () => {
    const none = live({ [APPLY_ENV]: "1" });
    assert.equal(appliesNow({ kind: "bring_back_audience", state: "accepted", writeKind: "adset_status" }, none), false);
    assert.equal(appliesNow({ kind: "drop_audience", state: "accepted", writeKind: "adset_status" }, none), false);
    assert.equal(appliesNow({ kind: "move_budget", state: "accepted", writeKind: "adset_budget_move" }, none), false);
    const all = live();
    assert.equal(appliesNow({ kind: "bring_back_audience", state: "accepted", writeKind: "adset_status" }, all), true);
    assert.equal(appliesNow({ kind: "drop_audience", state: "accepted", writeKind: "adset_status" }, all), true);
    assert.equal(appliesNow({ kind: "move_budget", state: "accepted", writeKind: "adset_budget_move" }, all), true);
    assert.equal(appliesNow({ kind: "bring_back_audience", state: "accepted", writeKind: "new_adset" }, all), true, "a cluster's new ad set: the ad-set gate");
    assert.equal(appliesNow({ kind: "missing_default", state: "accepted", writeKind: "new_adset" }, all), false, "a default also needs the audience gate");
    assert.equal(appliesNow({ kind: "missing_default", state: "accepted", writeKind: "new_adset" }, live({ ...ALL_ENV, OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true" })), true);
    for (const kind of ["missing_default", "bring_back_audience", "drop_audience", "move_budget"] as const) assert.equal(heldText({ kind, writeKind: "new_adset" }), null, `${kind}: P3 applies it`);
  });

  it("with a write's gate off, its accepted line waits, untouched, and nothing is read", async () => {
    const mem = seed([bringBack(), drop(), move()]);
    const meta = fakeMeta();
    const result = await apply(mem, meta, { env: { [APPLY_ENV]: "1" } });
    assert.deepEqual(result, { ok: true, applied: 0, failed: 0, lines: [] });
    assert.deepEqual(meta.calls, []);
    for (const id of ["bb", "dr", "mv"]) assert.equal(lineOf(mem, id).state, "accepted");
  });
});

// ── The plan guard and the 20 % cap ──────────────────────────────────────────

describe("on-sale refresh P3: the plan guard and the 20 % cap (R5)", () => {
  it("the plan guard is on bring-back, new-ad-set and budget-raise lines only, and measures the spend before the show", () => {
    assert.equal(daysToShow("2026-11-16", "2026-12-27"), 41);
    assert.equal(projectedSpend({ dailySpend: 5.26 }, "2026-11-16", "2026-12-27"), 215.66);
    assert.equal(projectedSpend({}, "2026-11-16", "2026-12-27"), null);
    assert.equal(planGuard("bring_back_audience", 4500, 1994.15, 215.66), null);
    assert.equal(planGuard("bring_back_audience", 4500, 4400, 215.66), "Turning it on would spend about £215.66 before the show, more than the £100.00 left in the plan.");
    assert.equal(planGuard("bring_back_audience", null, 0, 1), "Set this event's budget to apply this.");
    for (const kind of ["drop_audience", "move_budget", "add_creative", "pause_creative"]) assert.equal(planGuard(kind, null, 9999, 9999), null, kind);
    const ctx = { budget: null, spend: 0, today: "2026-11-16", eventDate: "2026-12-27" };
    assert.equal(spendLineBlock({ kind: "bring_back_audience", evidence: { dailySpend: 5 } }, ctx), SPEND_NEEDS_BUDGET);
    assert.equal(spendLineBlock({ kind: "drop_audience", evidence: {} }, ctx), null, "a drop never says Adds spend");
  });

  it("the cap: 20 % of the budget left, minus the moves already applied this refresh", () => {
    // £4,500 − £1,994.15 = £2,505.85 left; 20 % = £501.17.
    assert.equal(moveGuard(14.18, 4500, 1994.15, 0), null);
    assert.equal(moveGuard(14.18, 4500, 1994.15, 490), "Moving £14.18 would pass this refresh's 20 % cap: £501.17 of the £2505.85 left, £11.17 still free.");
    assert.equal(moveGuard(14.18, null, 0, 0), MOVE_NEEDS_BUDGET);
  });

  it("the cap counts only moves applied in the same refresh: not another window's, not one only accepted", async () => {
    const proposals = [
      { id: "p1", event_id: "e1", campaign_key: "On Sale", campaign_ids: ["c1"], window_end: "2026-11-15" },
      { id: "p2", event_id: "e1", campaign_key: "Purchase", campaign_ids: ["c2"], window_end: "2026-11-15" },
      { id: "p0", event_id: "e1", campaign_key: "On Sale", campaign_ids: ["c1"], window_end: "2026-11-08" },
    ];
    const mk = (state: string, proposal: string, amount: number, id: string) => ({ ...move(id, amount), state, proposal_id: proposal });
    // Same refresh, other campaign, applied: £490 counts. Last week's £400 and this week's accepted £400 don't.
    const mem = seed([move("mv", 14.18), mk("applied", "p2", 490, "other"), mk("applied", "p0", 400, "lastweek"), mk("accepted", "p2", 400, "pending")], { proposals });
    const meta = fakeMeta();
    await apply(mem, meta);
    assert.equal(lineOf(mem, "mv").state, "failed");
    assert.match(String(lineOf(mem, "mv").reason), /^Moving £14\.18 would pass this refresh's 20 % cap: £501\.17 of the £2505\.85 left, £11\.17 still free\.$/);
    assert.deepEqual(writes(meta), [], "nothing moved");
  });
});

// ── Bring back ───────────────────────────────────────────────────────────────

describe("on-sale refresh P3: Bring back a stopped ad set", () => {
  it("turns it on through the gated write; the result reads Applied · on and keeps the ad set id", async () => {
    const mem = seed([bringBack()]);
    const meta = fakeMeta();
    const result = await apply(mem, meta);
    assert.deepEqual(result, { ok: true, applied: 1, failed: 0, lines: [{ id: "bb", kind: "bring_back_audience", state: "applied", reason: "on" }] });
    assert.deepEqual(writes(meta), ["adset_status:301:ACTIVE"]);
    assert.deepEqual({ ...(lineOf(mem, "bb").applied_result as Record<string, unknown>), appliedBy: undefined }, { adsetId: "301", status: "ACTIVE", before: "PAUSED", effectiveBefore: "PAUSED", wrote: true, appliedBy: undefined });
  });

  it("the plan guard at apply time: no budget, or more spend than the plan has left, and nothing is read", async () => {
    for (const [overrides, reason] of [
      [{ budget: null }, "Set this event's budget to apply this."],
      [{ spend: 4400 }, "Turning it on would spend about £215.66 before the show, more than the £100.00 left in the plan."],
    ] as const) {
      const mem = seed([bringBack()], overrides);
      const meta = fakeMeta();
      await apply(mem, meta);
      assert.equal(lineOf(mem, "bb").reason, reason);
      assert.deepEqual(meta.calls, []);
    }
  });

  it("the plan guard at accept time, and Accept live once the plan has room", async () => {
    const decide = (mem: MemoryDb, budget: number | null) => decideLine({ db: mem.db, eventId: "e1", userId: "u1", lineId: "bb", decision: { decision: "accept" }, gates: live(), budget, eventDate: "2026-12-27", now: NOW });
    assert.deepEqual(await decide(seed([bringBack("bb", { state: "to_review" })]), null), { ok: false, status: 409, error: SPEND_NEEDS_BUDGET });
    assert.deepEqual(await decide(seed([bringBack("bb", { state: "to_review" })], { spend: 4400 }), 4500), { ok: false, status: 409, error: "Turning it on would spend about £215.66 before the show, more than the £100.00 left in the plan." });
    assert.equal(((await decide(seed([bringBack("bb", { state: "to_review" })]), 4500)) as { ok: boolean }).ok, true);
  });

  it("already on: applied without a write; moved to another campaign: failed, no write", async () => {
    const on = seed([bringBack()]);
    const meta = fakeMeta({ "301": { status: "ACTIVE", effectiveStatus: "ACTIVE" } });
    await apply(on, meta);
    assert.equal(lineOf(on, "bb").state, "applied");
    assert.deepEqual(writes(meta), []);
    const moved = seed([bringBack()]);
    const meta2 = fakeMeta({ "301": { campaignId: "c-other" } });
    await apply(moved, meta2);
    assert.equal(lineOf(moved, "bb").reason, "The ad set isn't in this campaign any more, so nothing was written.");
    assert.deepEqual(writes(meta2), []);
  });
});

// ── Drop ─────────────────────────────────────────────────────────────────────

describe("on-sale refresh P3: Drop a delivering ad set", () => {
  it("turns it off through the gated write: Applied · off", async () => {
    const mem = seed([drop()]);
    const meta = fakeMeta();
    await apply(mem, meta);
    assert.equal(lineOf(mem, "dr").reason, "off");
    assert.deepEqual(writes(meta), ["adset_status:302:PAUSED"]);
  });

  it("never retargeting: at accept (by its name) and at apply (by Meta's name)", async () => {
    const ctx = { budget: 4500, spend: 0, today: "2026-11-16", eventDate: "2026-12-27", appliedMovesGbp: 0, otherDrops: 0 };
    assert.equal(acceptBlock({ kind: "drop_audience", title: "Retargeting — 30d", adds_spend: false, blocked_reason: null, evidence: { deliveringAdSets: 4 }, write: { kind: "adset_status" } }, ctx), RETARGETING_STAYS);
    const accept = seed([drop("dr", { title: "Retargeting — 30d", state: "to_review" })]);
    assert.deepEqual(await decideLine({ db: accept.db, eventId: "e1", userId: "u1", lineId: "dr", decision: { decision: "accept" }, gates: live(), budget: 4500, eventDate: "2026-12-27", now: NOW }), { ok: false, status: 409, error: "Retargeting stays on: it's never dropped." });
    // Stored under another name, but Meta calls it retargeting now.
    const mem = seed([drop("dr", { write: { kind: "adset_status", adsetId: "304", status: "PAUSED", ...WHERE } })]);
    const meta = fakeMeta();
    await apply(mem, meta);
    assert.equal(lineOf(mem, "dr").reason, RETARGETING_STAYS);
    assert.deepEqual(writes(meta), []);
  });

  it("never the last ad set delivering: at accept (with the proposal's other drops) and at apply (Meta's live list)", async () => {
    const ctx = { budget: 4500, spend: 0, today: "2026-11-16", eventDate: "2026-12-27", appliedMovesGbp: 0 };
    const base = { kind: "drop_audience", title: "Lineup — Primary", adds_spend: false, blocked_reason: null, write: { kind: "adset_status" } };
    assert.equal(acceptBlock({ ...base, evidence: { deliveringAdSets: 2 } }, { ...ctx, otherDrops: 1 }), LAST_ADSET_STAYS);
    assert.equal(acceptBlock({ ...base, evidence: { deliveringAdSets: 3 } }, { ...ctx, otherDrops: 1 }), null);
    const accept = seed([drop("dr", { state: "to_review", evidence: { deliveringAdSets: 2 } }), drop("dr2", { state: "applied" })]);
    assert.deepEqual(await decideLine({ db: accept.db, eventId: "e1", userId: "u1", lineId: "dr", decision: { decision: "accept" }, gates: live(), budget: 4500, eventDate: "2026-12-27", now: NOW }), { ok: false, status: 409, error: "It's the last ad set delivering in this campaign, so it stays on." });
    const mem = seed([drop()]);
    const meta = fakeMeta({ "303": { status: "PAUSED", effectiveStatus: "PAUSED" }, "304": { campaignId: "c-other" } });
    await apply(mem, meta);
    assert.equal(lineOf(mem, "dr").reason, LAST_ADSET_STAYS);
    assert.deepEqual(writes(meta), []);
  });
});

// ── Moves ────────────────────────────────────────────────────────────────────

describe("on-sale refresh P3: within-campaign moves (the optimisation budget write)", () => {
  it("the giving side down, then the receiving side up, by the week's amount ÷ 7", async () => {
    const mem = seed([move("mv", 14.18)]);
    const meta = fakeMeta();
    await apply(mem, meta);
    // £14.18 a week = 203 pence a day.
    assert.deepEqual(writes(meta), ["budget:302:1797", "budget:303:1703"]);
    assert.equal(lineOf(mem, "mv").reason, movedText(14.18));
    assert.equal(lineOf(mem, "mv").reason, "£14.18 a week moved");
    assert.deepEqual((lineOf(mem, "mv").applied_result as { plan: unknown }).plan, { fromAdsetId: "302", toAdsetId: "303", deltaMinor: 203, from: { before: 2000, after: 1797 }, to: { before: 1500, after: 1703 } });
    assert.ok(mem.tables.meta_write_idempotency!.filter((row) => row.op_kind === "refresh_adset_budget_update").length === 2);
  });

  it("a failure after the giving side keeps it, says so, and Retry writes only the receiving side", async () => {
    const mem = seed([move("mv", 14.18)]);
    const meta = fakeMeta();
    meta.failBudgetOnce.add("303");
    await apply(mem, meta);
    assert.equal(lineOf(mem, "mv").state, "failed");
    assert.equal(lineOf(mem, "mv").reason, "Only the giving side moved — Meta didn't take this — it's limiting calls on this account. Retry in a few minutes.");
    await apply(mem, meta, { retry: true });
    assert.equal(lineOf(mem, "mv").state, "applied");
    assert.deepEqual(writes(meta), ["budget:302:1797", "budget:303:1703", "budget:303:1703"], "the giving side is never moved twice");
    assert.equal(meta.sets["302"]!.dailyBudget, 1797);
  });

  it("changed in Ads Manager since: nothing moved", async () => {
    const mem = seed([move()]);
    const meta = fakeMeta({ "302": { dailyBudget: 2500 } });
    // The plan is taken from the live read, so a change underfoot only shows on a retry against a stored plan.
    mem.tables.onsale_refresh_lines![0]!.state = "failed";
    mem.tables.onsale_refresh_lines![0]!.applied_result = { plan: { fromAdsetId: "302", toAdsetId: "303", deltaMinor: 203, from: { before: 2000, after: 1797 }, to: { before: 1500, after: 1703 } } };
    await apply(mem, meta, { retry: true });
    assert.equal(lineOf(mem, "mv").reason, "The budget changed in Ads Manager since the proposal, so nothing was moved.");
    assert.deepEqual(writes(meta), []);
  });

  it("a campaign budget or a lifetime budget can't be moved; nor below the £1.00 a day floor we keep", async () => {
    const cbo = seed([move()]);
    await apply(cbo, fakeMeta({ "302": { dailyBudget: null } }));
    assert.equal(lineOf(cbo, "mv").reason, "The budget is set on the campaign or as a lifetime budget, so ad-set budgets can't be moved.");
    const floor = seed([move("mv", 14.18)]);
    const meta = fakeMeta({ "302": { dailyBudget: 250 } });
    await apply(floor, meta);
    assert.equal(lineOf(floor, "mv").reason, "Moving it would take the giving ad set under £1.00 a day, the floor we keep, so nothing was moved.");
    assert.deepEqual(writes(meta), []);
  });

  it("the cap at accept time counts applied moves for the refresh", async () => {
    const mem = seed([move("mv", 14.18, { state: "to_review" }), { ...move("done", 490), state: "applied" }]);
    const result = await decideLine({ db: mem.db, eventId: "e1", userId: "u1", lineId: "mv", decision: { decision: "accept" }, gates: live(), budget: 4500, eventDate: "2026-12-27", now: NOW });
    assert.deepEqual(result, { ok: false, status: 409, error: "Moving £14.18 would pass this refresh's 20 % cap: £501.17 of the £2505.85 left, £11.17 still free." });
    const roomy = seed([move("mv", 14.18, { state: "to_review" })]);
    assert.equal(((await decideLine({ db: roomy.db, eventId: "e1", userId: "u1", lineId: "mv", decision: { decision: "accept" }, gates: live(), budget: 4500, eventDate: "2026-12-27", now: NOW })) as { ok: boolean }).ok, true);
  });
});

// ── The panel's read ─────────────────────────────────────────────────────────

describe("on-sale refresh P3: the panel draws the blocks Accept enforces", () => {
  it("a bring-back over the plan, a move over the cap, a new ad set with no money; a drop with room is clear", async () => {
    const lines = [
      bringBack("bb", { state: "to_review", evidence: { dailySpend: 70 } }),
      move("mv", 30, { state: "to_review" }),
      { ...move("done", 490), state: "applied", position: 9 },
      drop("dr", { state: "to_review" }),
      line("cl", "bring_back_audience", { state: "to_review", write: { kind: "new_adset", clusterId: "x", budgetLevel: "ad_set", copyFrom: { dailyGbp: 200 }, giver: null } }),
      line("cbo", "bring_back_audience", { state: "to_review", write: { kind: "new_adset", clusterId: "y", budgetLevel: "campaign", copyFrom: { dailyGbp: 200 }, giver: null } }),
    ].map((row) => ({ ...row, write_text: "w", detail: "d" }));
    const mem = seed(lines);
    mem.tables.onsale_refresh_proposals![0] = { ...mem.tables.onsale_refresh_proposals![0]!, run_kind: "cycle", created_at: "2026-11-16T06:00:00Z", cycle_kind: "payday" };
    const [proposal] = await loadEventProposals(mem.db, "e1", { budgetSet: true, plan: { budget: 4500, spend: 1994.15, today: "2026-11-16", eventDate: "2026-12-27" } });
    const block = (id: string) => proposal!.lines.find((row) => row.id === id)!.blockedReason;
    assert.equal(block("bb"), "Turning it on would spend about £2870.00 before the show, more than the £2505.85 left in the plan.");
    assert.equal(block("mv"), "Moving £30.00 would pass this refresh's 20 % cap: £501.17 of the £2505.85 left, £11.17 still free.");
    assert.equal(block("cl"), NO_BUDGET_TO_START, "£200 a day × 41 days is past the plan, and a week of it is past the cap");
    assert.equal(block("cbo"), null, "under a campaign budget it shares it");
    assert.equal(block("dr"), null);
    assert.equal(proposal!.lines.find((row) => row.id === "cl")!.writeKind, "new_adset");
  });
});

describe("on-sale refresh P3: OR8's sentences are the guards' own", () => {
  it("the plan guard and the cap, from OR8's figures", () => {
    // £4,500 budget, £3,860.00 spent, w/c 7 Dec: 20 days to the show, £100 moved already.
    assert.equal(planGuard("bring_back_audience", 4500, 3860, projectedSpend({ dailySpend: 34 }, "2026-12-07", "2026-12-27")), OR8_PLAN_GUARD);
    assert.equal(planGuard("bring_back_audience", 4500, 3860, projectedSpend({ dailySpend: 9.1 }, "2026-12-07", "2026-12-27")), null, "the other bring-back fits");
    assert.equal(moveGuard(30, 4500, 3860, 100), OR8_MOVE_CAP);
    assert.equal(moveGuard(100, 4500, 3860, 0), null, "the applied move fitted when it went");
  });
});

// ── Migration and routes ─────────────────────────────────────────────────────

describe("on-sale refresh P3: migration 237 and the wiring", () => {
  it("migration 237 keeps every ledger kind, adds the three new ones and the stored-audience table", () => {
    const sql = readFileSync("supabase/migrations/237_onsale_refresh_p3_ledger.sql", "utf8");
    for (const kind of ["campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update", "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update", "refresh_adset_create"]) assert.ok(sql.includes(`'${kind}'`), kind);
    assert.match(sql, /drop constraint if exists meta_write_idempotency_op_kind_check/);
    // The stored audiences and ad sets: on the event, read-only RLS, writes by the service role.
    assert.match(sql, /create table if not exists public\.onsale_refresh_audiences/);
    assert.match(sql, /unique \(event_id, kind, part, campaign_key\)/);
    assert.match(sql, /for select using \(auth\.uid\(\) = user_id\)/);
    assert.doesNotMatch(sql, /for (all|insert|update|delete)/i);
  });

  it("the apply route wires the reads, the budget POST and the ad-set status POST, after the Live check", () => {
    const route = readFileSync("app/api/events/[id]/onsale-refresh/apply/route.ts", "utf8");
    const gate = route.indexOf('who.gates.mode !== "live"');
    for (const piece of ["async listAdSets(", "async updateAdSetDailyBudget(", "async postAdSetStatus(", "daily_budget: dailyBudgetPence"]) assert.ok(route.indexOf(piece) > gate, piece);
    const source = readFileSync("lib/meta/adset-status-write.ts", "utf8");
    assert.match(source, /=== "true"/);
    assert.match(source, /\{ required: true \}/);
    assert.doesNotMatch(source, /from "\.\/client/);
  });
});
