/**
 * Campaign-budget (CBO) and lifetime-budget ad sets, read in the purchase
 * read's ad-set batch: the rules no longer propose a line Apply would
 * refuse on the budget level.
 *
 * - move.within_campaign: Apply moves ad-set daily budgets only ("The budget
 *   is set on the campaign or as a lifetime budget, so ad-set budgets can't
 *   be moved."). Either side on the campaign or on a lifetime budget → Watch.
 * - A new ad set (a cluster brought back, a missing default): Apply can't
 *   copy a lifetime-budget ad set (LIFETIME_COPY), and can't take a move
 *   from a giver with no daily budget, or one it would leave under £1.00
 *   (NO_BUDGET_TO_START). The copy and the giver skip those; with nothing
 *   left to copy but a lifetime ad set, the lines go on Watch. Under CBO the
 *   line shares the campaign budget, as Apply does.
 *
 * Pure rules plus one Apply run against fakes; nothing reaches Meta.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPLY_ENV, applyGates } from "../apply-gates.ts";
import { applyAccepted, type AdSetNow, type ApplyDeps, type RefreshMeta } from "../apply.ts";
import { NO_BUDGET_TO_START } from "../new-adset.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { MOVE_LIFETIME_FROM, MOVE_LIFETIME_TO, MOVE_ON_CAMPAIGN, audienceLines, lifetimeCopyWatch, type AdSetInput, type CampaignInput, type ClusterInput } from "../rules.ts";
import { planRun } from "../schedule.ts";
import { memoryDb } from "./memory-db.ts";

const PLAN = planRun({ day: "2026-11-16", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: true });

type Meta = NonNullable<AdSetInput["meta"]>;
const DAILY = (minor: number): Meta => ({ dailyBudgetMinor: minor, lifetimeBudgetMinor: null, pixelId: "645185673672763" });
const CBO: Meta = { dailyBudgetMinor: null, lifetimeBudgetMinor: null, pixelId: "645185673672763" };
const LIFETIME = (minor: number): Meta => ({ dailyBudgetMinor: null, lifetimeBudgetMinor: minor, pixelId: "645185673672763" });

function adSet(overrides: Partial<AdSetInput> & Pick<AdSetInput, "adsetId" | "name">): AdSetInput {
  return { adsetIds: [overrides.adsetId], firstDay: "2026-10-30", lastDay: "2026-11-15", weekSpend: 40, weekResults: 5, totalSpend: 100, totalResults: 12, delivering: true, recentDailySpend: 5, deliveringAds: 3, ...overrides };
}

const CLUSTER: ClusterInput = { id: "k1", name: "Disc Genre", client: "Puzzle", index: 0.7, confidence: 0.5, confidenceWord: "ok", usedOnEvent: false, interestList: [{ id: "601", name: "Disc Genre" }] };

/**
 * Adv+ (£1.50 per IC) is the copy and the move's receiver; Lineup (£15 per IC) the giver and the move's giver; Broad in between.
 * `meta` sets each ad set's budget as the batch read saw it (absent = not read).
 */
function input(meta: { adv?: Meta; broad?: Meta; lineup?: Meta } = {}, extra: Partial<CampaignInput> = {}): CampaignInput {
  return {
    eventId: "e1",
    eventCode: "P26-BDAY",
    eventName: "Puzzle 4th Birthday",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
    campaignIds: ["c1"],
    adAccountId: "act_9",
    draft: { draftId: "d1", adAccountId: "act_9", copy: null, budgetLevel: "ad_set" },
    eventDate: "2026-12-27",
    signup: { event: "CompleteRegistration", registrations180: 420, landing30: 300, ticket30: 40 },
    country: "GB",
    landingUrl: "https://puzzle.crqln.com/l/p26-bday",
    ticketUrl: "https://www.skiddle.com/e/41234567/",
    videoPlays: 900,
    onSaleDay: "2026-10-30",
    plan: PLAN,
    resultEvent: "initiate_checkout",
    weekSpend: 100,
    weekResults: 32,
    totalSpend: 600,
    totalResults: 200,
    totalFirstDay: "2026-10-29",
    ads: [],
    adSets: [
      adSet({ adsetId: "adv", name: "Adv+", weekSpend: 30, weekResults: 20, ...(meta.adv ? { meta: meta.adv } : {}) }),
      adSet({ adsetId: "broad", name: "Broad", weekSpend: 40, weekResults: 10, ...(meta.broad ? { meta: meta.broad } : {}) }),
      adSet({ adsetId: "lineup", name: "Lineup — Primary", weekSpend: 30, weekResults: 2, ...(meta.lineup ? { meta: meta.lineup } : {}) }),
    ],
    clusters: [CLUSTER],
    supply: [],
    claims: [],
    budgetGbp: 4500,
    spendToDateGbp: 2123.58,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 60, purchases: 0, lpv: 0 },
    sinceOnSale: { ic: 200, purchases: 0, fromDay: "2026-10-30" },
    ...extra,
  };
}

const run = (i: CampaignInput) => audienceLines(i, ONSALE_PHASE);
const MOVE_TITLE = "Lineup — Primary → Adv+";
const NEW_SET_RULES = ["bring_back.client_cluster", "missing_default.retargeting", "missing_default.registrations_lookalike"];

describe("move.within_campaign: no move Apply can't write on the budget level", () => {
  it("a campaign budget (CBO): no move line; Watch says the budget is on the campaign", () => {
    const { lines, watch } = run(input({ adv: CBO, broad: CBO, lineup: CBO }));
    assert.equal(lines.find((line) => line.kind === "move_budget"), undefined);
    const item = watch.find((row) => row.title === MOVE_TITLE)!;
    assert.equal(item.detail, MOVE_ON_CAMPAIGN);
    assert.equal(item.detail, "no move: the budget is set on the campaign, so ad-set budgets can't be moved");
    assert.equal(item.narrow, "Lineup — Primary → Adv+ · no move, campaign budget");
    assert.equal(item.evidence.budget, "campaign");
  });

  it("a lifetime-budget giver, or receiver: no move line; Watch names the side", () => {
    const from = run(input({ adv: DAILY(750), lineup: LIFETIME(60000) }));
    assert.equal(from.lines.find((line) => line.kind === "move_budget"), undefined);
    const giver = from.watch.find((row) => row.title === MOVE_TITLE)!;
    assert.equal(giver.detail, "no move: the giving ad set runs on a lifetime budget, so there's no daily budget to move");
    assert.equal(giver.detail, MOVE_LIFETIME_FROM);
    assert.equal(giver.narrow, "Lineup — Primary → Adv+ · no move, lifetime budget");
    const to = run(input({ adv: LIFETIME(60000), lineup: DAILY(2000) })).watch.find((row) => row.title === MOVE_TITLE)!;
    assert.equal(to.detail, "no move: the receiving ad set runs on a lifetime budget, so there's no daily budget to add to");
    assert.equal(to.detail, MOVE_LIFETIME_TO);
  });

  it("daily budgets both sides, or the budgets not read: the move is proposed as before", () => {
    for (const meta of [{ adv: DAILY(750), lineup: DAILY(2000) }, {}]) {
      const move = run(input(meta)).lines.find((line) => line.kind === "move_budget")!;
      assert.equal(move.title, MOVE_TITLE, JSON.stringify(meta));
      assert.equal(move.evidence.amountGbp, 15);
    }
  });

  it("the bug: the line proposed without the read is refused at Apply on a CBO campaign; with the read it isn't proposed", async () => {
    const move = run(input()).lines.find((line) => line.kind === "move_budget")!;
    const sets: Record<string, AdSetNow> = {
      lineup: { id: "lineup", campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Lineup — Primary", dailyBudget: null },
      adv: { id: "adv", campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Adv+", dailyBudget: null },
    };
    const writes: string[] = [];
    const meta = {
      readAdSet: async (id: string) => (sets[id] ? { ...sets[id]! } : null),
      listAdSets: async () => Object.values(sets),
      updateAdSetDailyBudget: async (id: string, minor: number) => void writes.push(`${id}:${minor}`),
    } as unknown as RefreshMeta;
    const mem = memoryDb(
      {
        events: [{ id: "e1", user_id: "u1", budget_marketing: 4500, event_date: "2026-12-27" }],
        event_daily_rollups: [{ event_id: "e1", date: "2026-11-15", ad_spend: 2123.58 }],
        onsale_refresh_proposals: [{ id: "p1", event_id: "e1", campaign_key: "On Sale", campaign_ids: ["c1"], window_end: "2026-11-15", cycle_monday: "2026-11-16" }],
        onsale_refresh_lines: [{ id: "mv", proposal_id: "p1", position: 1, kind: "move_budget", title: move.title, detail: move.detail, write_text: move.writeText, narrow: move.narrow, adds_spend: false, blocked_reason: null, supply: false, state: "accepted", reason: null, target: move.target, evidence: move.evidence, write: move.write, applied_result: null }],
        campaign_drafts: [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", status: "published", meta_campaign_id: "c1", import_campaign_id: null, creatives: [] }],
        launched_ad_sets: [],
        meta_write_idempotency: [],
      },
      { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } },
    );
    const env = { [APPLY_ENV]: "1", ENABLE_OPTIMISATION_WRITES: "1" };
    const deps: ApplyDeps = { db: mem.db, env, meta, copyFromDrive: async () => ({ ok: false, reason: "no Drive" }), upload: async () => ({}), now: new Date("2026-11-16T12:30:00Z") };
    await applyAccepted({ deps, eventId: "e1", userId: "u1", gates: applyGates(env, "live") });
    const row = mem.tables.onsale_refresh_lines!.find((line) => line.id === "mv")!;
    assert.equal(row.state, "failed");
    assert.equal(row.reason, "The budget is set on the campaign or as a lifetime budget, so ad-set budgets can't be moved.");
    assert.deepEqual(writes, []);
    assert.equal(run(input({ adv: CBO, broad: CBO, lineup: CBO })).lines.find((line) => line.kind === "move_budget"), undefined);
  });
});

describe("new ad sets (cluster, retargeting, lookalike): only what Apply can copy and fund", () => {
  it("CBO, though the draft says ad-set budgets: every new ad set shares the campaign budget, as Apply does", () => {
    const { lines } = run(input({ adv: CBO, broad: CBO, lineup: CBO }));
    for (const ruleId of NEW_SET_RULES) {
      const line = lines.find((row) => row.ruleId === ruleId)!;
      assert.ok(line, ruleId);
      assert.deepEqual(line.evidence.funding, { mode: "cbo" }, ruleId);
      assert.match(line.writeText, /shares the campaign budget/, ruleId);
      assert.equal((line.write as { budgetLevel: string }).budgetLevel, "campaign", ruleId);
    }
  });

  it("every ad set on a lifetime budget: no new-ad-set line; each goes on Watch with the reason", () => {
    const { lines, watch } = run(input({ adv: LIFETIME(30000), broad: LIFETIME(40000), lineup: LIFETIME(60000) }));
    for (const ruleId of NEW_SET_RULES) assert.equal(lines.find((row) => row.ruleId === ruleId), undefined, ruleId);
    for (const title of ["Disc Genre", "Retargeting", "Registrations lookalike"]) {
      const item = watch.find((row) => row.title === title)!;
      assert.equal(item.detail, "not proposed: the ad set it would copy, Adv+, runs on a lifetime budget, so there's no daily budget to give the new one", title);
      assert.equal(item.detail, lifetimeCopyWatch("Adv+"));
      assert.equal(item.narrow, `${title} · not proposed, lifetime budget`);
    }
    assert.equal(watch.find((row) => row.title === MOVE_TITLE)!.detail, MOVE_LIFETIME_FROM, "and the move");
  });

  it("the best ad set on a lifetime budget, another on a daily one: the daily one is copied", () => {
    const { lines, watch } = run(input({ adv: LIFETIME(30000), broad: DAILY(600), lineup: DAILY(2000) }));
    for (const ruleId of NEW_SET_RULES) assert.equal((lines.find((row) => row.ruleId === ruleId)!.evidence.copyFrom as { name: string }).name, "Broad", ruleId);
    assert.ok(!watch.some((row) => row.detail.startsWith("not proposed:")));
  });

  it("a move-funded new ad set never takes from a lifetime or campaign giver, nor one it would leave under £1.00", () => {
    // £200 left: the copy's £5 a day to the show doesn't fit headroom, a week of it (£35) fits the £40 cap → a move from the giver.
    const tight = { spendToDateGbp: 4300 };
    const funding = (meta: Parameters<typeof input>[0]) => run(input(meta, tight)).lines.find((row) => row.ruleId === "missing_default.retargeting")!;
    const usual = funding({ adv: DAILY(500), broad: DAILY(2000), lineup: DAILY(2000) });
    assert.deepEqual(usual.evidence.funding, { mode: "move", dailyGbp: 5, fromAdsetId: "lineup", fromName: "Lineup — Primary" }, "the highest cost per result gives");
    // Lineup on a lifetime budget: Broad gives instead.
    assert.equal((funding({ adv: DAILY(500), broad: DAILY(2000), lineup: LIFETIME(60000) }).evidence.funding as { fromAdsetId: string }).fromAdsetId, "broad");
    // Lineup at £5.50 a day would be left at £0.50 after the copy's £5.00: Broad gives instead.
    assert.equal((funding({ adv: DAILY(500), broad: DAILY(2000), lineup: DAILY(550) }).evidence.funding as { fromAdsetId: string }).fromAdsetId, "broad");
    // No giver Apply can take from: blocked before Accept with the existing reason.
    const none = funding({ adv: DAILY(500), broad: LIFETIME(60000), lineup: DAILY(550) });
    assert.deepEqual(none.evidence.funding, { mode: "none" });
    assert.equal(none.blockedReason, NO_BUDGET_TO_START);
  });
});
