/**
 * Two rule floors found on the 16 Nov 12:02 run:
 *
 * - move.within_campaign never proposes a move Apply would refuse on the
 *   £1.00 a day floor (P26-BDAY: £3.74 a week from an ad set at £1.00 a
 *   day). The rule sizes the move the way Apply writes it — the week ÷ 7
 *   off the giver's daily budget — on the budget the purchase read saw.
 * - missing_default.retargeting says what Apply builds when the copied ad
 *   set has no pixel (DHB26-TRANCOSO's Traffic / LPV ad set): the video
 *   viewers only, or blocked when the campaign has no video.
 *
 * Pure rules plus one Apply run against fakes; nothing reaches Meta.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPLY_ENV, applyGates } from "../apply-gates.ts";
import { MIN_DAILY_BUDGET_MINOR as APPLY_FLOOR, applyAccepted, type AdSetNow, type ApplyDeps, type RefreshMeta } from "../apply.ts";
import { NO_PIXEL_NO_REGISTRATIONS, NO_PIXEL_NO_VIDEO, RETARGETING_VIDEO_ONLY, RETENTION } from "../new-adset.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { MIN_DAILY_BUDGET_MINOR, maxWeeklyMoveGbp, moveDeltaMinor } from "../plan-guard.ts";
import { audienceLines, buildProposal, type AdSetInput, type CampaignInput } from "../rules.ts";
import { planRun } from "../schedule.ts";
import { memoryDb } from "./memory-db.ts";

const PLAN = planRun({ day: "2026-11-16", eventDate: "2026-12-27", config: ONSALE_PHASE, shadow: true });

function adSet(overrides: Partial<AdSetInput> & Pick<AdSetInput, "adsetId" | "name">): AdSetInput {
  return { adsetIds: [overrides.adsetId], firstDay: "2026-10-30", lastDay: "2026-11-15", weekSpend: 40, weekResults: 5, totalSpend: 100, totalResults: 12, delivering: true, recentDailySpend: 5, deliveringAds: 3, ...overrides };
}

// P26-BDAY's 12:02 move: "Retargeting – No Suggest" (£1.00 a day) → "Adv+" (£7.50 a day), £3.74 a week wanted; ABO; £4,500 budget, £2,123.58 spent.
const GIVER = "120248863410820539";
const RECEIVER = "120248863411120539";
function p26(giverDailyMinor: number | undefined, extra: Partial<CampaignInput> = {}): CampaignInput {
  return {
    eventId: "e1",
    eventCode: "P26-BDAY",
    eventName: "Puzzle 4th Birthday",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
    campaignIds: ["c1"],
    adAccountId: "act_9",
    draft: { draftId: "d1", adAccountId: "act_9", copy: null, budgetLevel: "ad_set" },
    eventDate: "2026-12-27",
    onSaleDay: "2026-10-30",
    plan: PLAN,
    resultEvent: "initiate_checkout",
    weekSpend: 100,
    weekResults: 40,
    totalSpend: 600,
    totalResults: 200,
    totalFirstDay: "2026-10-29",
    ads: [],
    adSets: [
      adSet({ adsetId: GIVER, name: "Retargeting – No Suggest", weekSpend: 7.48, weekResults: 1, ...(giverDailyMinor === undefined ? {} : { meta: { dailyBudgetMinor: giverDailyMinor, pixelId: "645185673672763" } }) }),
      adSet({ adsetId: RECEIVER, name: "Adv+", weekSpend: 30, weekResults: 20, meta: { dailyBudgetMinor: 750, pixelId: "645185673672763" } }),
    ],
    clusters: [],
    supply: [],
    claims: [],
    budgetGbp: 4500,
    spendToDateGbp: 2123.58,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 80, purchases: 0, lpv: 0 },
    sinceOnSale: { ic: 200, purchases: 0, fromDay: "2026-10-30" },
    ...extra,
  };
}

const moveOf = (input: CampaignInput) => audienceLines(input, ONSALE_PHASE).lines.find((line) => line.kind === "move_budget");

describe("move.within_campaign keeps the giver at the £1.00 a day floor Apply keeps", () => {
  it("one floor, shared: Apply's constant is the rule's", () => {
    assert.equal(APPLY_FLOOR, MIN_DAILY_BUDGET_MINOR);
    assert.equal(MIN_DAILY_BUDGET_MINOR, 100);
  });

  it("P26-BDAY: a giver already at £1.00 a day gets no move line; Watch says why", () => {
    const { lines, watch } = audienceLines(p26(100), ONSALE_PHASE);
    assert.equal(lines.find((line) => line.kind === "move_budget"), undefined, "£3.74 a week off £1.00 a day would be refused at Apply");
    const item = watch.find((row) => row.title === "Retargeting – No Suggest → Adv+")!;
    assert.equal(item.detail, "no move: the giving ad set is already at the £1.00 a day floor");
    assert.equal(item.narrow, "Retargeting – No Suggest → Adv+ · no move, £1.00 floor");
    assert.deepEqual(item.evidence, { fromAdsetId: GIVER, toAdsetId: RECEIVER, fromDailyBudgetGbp: 1, floorGbp: 1, wantedGbp: 3.74 });
    const under = audienceLines(p26(50), ONSALE_PHASE).watch.find((row) => row.title === "Retargeting – No Suggest → Adv+")!;
    assert.equal(under.detail, "no move: the giving ad set is at £0.50 a day, under the £1.00 a day floor");
    assert.equal(audienceLines(p26(50), ONSALE_PHASE).watch.find((row) => row.title === "Retargeting – No Suggest → Adv+")!.narrow, "Retargeting – No Suggest → Adv+ · no move, £1.00 floor", "narrow: one wording");
    // Above £1.00, where the wanted £3.74 would take it under: no Watch entry, the move is capped at the penny's headroom.
    const above = audienceLines(p26(101), ONSALE_PHASE);
    assert.equal(above.watch.find((row) => row.title === "Retargeting – No Suggest → Adv+"), undefined);
    const capped = above.lines.find((line) => line.kind === "move_budget")!;
    assert.equal(capped.detail, "£7.48 per IC (2.99×) to £1.50 per IC (0.6×) · £0.07 a week (keeps Retargeting – No Suggest at £1.00 a day) · cap £475.28 (20 % of £2376.42 remaining)");
    assert.equal(101 - moveDeltaMinor(0.07), MIN_DAILY_BUDGET_MINOR);
  });

  it("a giver just over the floor: the move is capped at what keeps it at £1.00, and says so", () => {
    const move = moveOf(p26(150))!;
    // 50p a day of headroom = £3.50 a week.
    assert.equal(move.evidence.amountGbp, 3.5);
    assert.equal(move.evidence.flooredFromGbp, 3.74);
    assert.equal(move.write!.amountGbp, 3.5);
    assert.equal(move.detail, "£7.48 per IC (2.99×) to £1.50 per IC (0.6×) · £3.50 a week (keeps Retargeting – No Suggest at £1.00 a day) · cap £475.28 (20 % of £2376.42 remaining)");
    assert.deepEqual(move.narrow, { detail: "£3.50 a week · £1.00 a day floor · cap £475.28", writeText: null });
    assert.equal(150 - moveDeltaMinor(3.5), MIN_DAILY_BUDGET_MINOR, "Apply leaves it at exactly £1.00");
  });

  it("room enough, or the budget not read: the move is as before, no floor words", () => {
    for (const daily of [750, undefined]) {
      const move = moveOf(p26(daily))!;
      assert.equal(move.evidence.amountGbp, 3.74, String(daily));
      assert.equal(move.detail, "£7.48 per IC (2.99×) to £1.50 per IC (0.6×) · £3.74 a week · cap £475.28 (20 % of £2376.42 remaining)");
      assert.equal(move.evidence.flooredFromGbp, undefined);
    }
  });

  it("every size the rule proposes passes Apply's floor check", () => {
    for (let daily = 0; daily <= 3000; daily += 7) {
      const max = maxWeeklyMoveGbp(daily);
      if (daily <= MIN_DAILY_BUDGET_MINOR) {
        assert.equal(max, 0, `${daily}`);
        continue;
      }
      assert.ok(daily - moveDeltaMinor(max) >= MIN_DAILY_BUDGET_MINOR, `${daily}: ${max}`);
      assert.equal(max, ((daily - MIN_DAILY_BUDGET_MINOR) * 7) / 100, `${daily}: a week of the daily headroom`);
    }
  });

  it("Apply takes the capped move: the giver lands on £1.00 a day", async () => {
    const move = moveOf(p26(150))!;
    const sets: Record<string, AdSetNow> = {
      [GIVER]: { id: GIVER, campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Retargeting – No Suggest", dailyBudget: 150 },
      [RECEIVER]: { id: RECEIVER, campaignId: "c1", status: "ACTIVE", effectiveStatus: "ACTIVE", name: "Adv+", dailyBudget: 750 },
    };
    const budgets: string[] = [];
    const meta = {
      async readAdSet(id: string) {
        return sets[id] ? { ...sets[id]! } : null;
      },
      async listAdSets() {
        return Object.values(sets);
      },
      async updateAdSetDailyBudget(id: string, minor: number) {
        budgets.push(`${id}:${minor}`);
        sets[id]!.dailyBudget = minor;
      },
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
    assert.equal(row.state, "applied", String(row.reason));
    assert.deepEqual(budgets, [`${GIVER}:100`, `${RECEIVER}:800`]);
  });
});

// DHB26-TRANCOSO: the copied ad set "DHB Primary 2 — Primary" is Traffic / LPV, with no promoted_object.
function trancoso(copyPixel: string | null | undefined, extra: Partial<CampaignInput> = {}): CampaignInput {
  return p26(undefined, {
    eventCode: "DHB26-TRANCOSO",
    eventName: "Deep House Bible Trancoso",
    campaignKey: "[DHB26-TRANCOSO] On Sale",
    resultEvent: "landing_page_view",
    signup: { event: "CompleteRegistration", registrations180: 420, landing30: 2343, ticket30: 0 },
    landingUrl: "https://dhb.crqln.com/l/trancoso",
    ticketUrl: "https://www.skiddle.com/e/40000000/",
    videoPlays: 5120,
    adSets: [
      adSet({ adsetId: "120250286438010453", name: "DHB Primary 2 — Primary", weekSpend: 30, weekResults: 20, ...(copyPixel === undefined ? {} : { meta: { dailyBudgetMinor: 1000, pixelId: copyPixel } }) }),
      adSet({ adsetId: "120250286438010454", name: "Broad", weekSpend: 70, weekResults: 20 }),
    ],
    ...extra,
  });
}

const defaultOf = (input: CampaignInput, which: "retargeting" | "registrations_lookalike") => audienceLines(input, ONSALE_PHASE).lines.find((line) => line.ruleId === `missing_default.${which}`)!;

describe("missing_default.retargeting says what Apply builds when the copied ad set has no pixel", () => {
  it("no pixel, the campaign has video: the video viewers only, never landing-page visitors", () => {
    const line = defaultOf(trancoso(null), "retargeting");
    assert.equal(line.target.extra, RETARGETING_VIDEO_ONLY);
    assert.equal(RETARGETING_VIDEO_ONLY, "Builds 1 audience: video viewers, last 60 days. The ad set it copies has no pixel, so landing-page and ticket-link visitors can't be built.");
    assert.doesNotMatch(String(line.target.extra), /landing-page visitors \d|ticket-link visitors \d|registrations/);
    assert.equal(RETENTION.video, 60, "the window ensureDefaultAudiences gives the video audience");
    assert.equal(line.blockedReason, null);
    assert.equal(line.evidence.copyPixelId, null);
    assert.equal(line.evidence.videoPlays, 5120);
  });

  it("no pixel and no video views: blocked, with the reason", () => {
    const line = defaultOf(trancoso(null, { videoPlays: 0 }), "retargeting");
    assert.equal(line.blockedReason, NO_PIXEL_NO_VIDEO);
    assert.equal(NO_PIXEL_NO_VIDEO, "The ad set it copies has no pixel and this campaign's ads have no video views, so there's no audience to build.");
    assert.equal(line.target.extra, null, "nothing to list");
  });

  it("a pixel on the copied ad set, or the pixel not read: the four sources, as before", () => {
    for (const pixel of ["645185673672763", undefined]) {
      const line = defaultOf(trancoso(pixel, { videoPlays: 0 }), "retargeting");
      assert.equal(line.target.extra, "Builds 4 audiences, targeted together: landing-page visitors 2343 · ticket-link visitors 0 · video viewers · registrations 420 (our counts, last 30–180 days)", String(pixel));
      assert.equal(line.blockedReason, null);
    }
  });

  it("the lookalike seeds on the pixel too: no pixel on the copied ad set blocks it", () => {
    assert.equal(defaultOf(trancoso(null), "registrations_lookalike").blockedReason, NO_PIXEL_NO_REGISTRATIONS);
    assert.equal(NO_PIXEL_NO_REGISTRATIONS, "The ad set it copies has no pixel, so there are no registrations to build from.");
    assert.equal(defaultOf(trancoso("645185673672763"), "registrations_lookalike").blockedReason, null);
  });
});

describe("RT9 (2026-11-17-retargeting-campaign.html): the Retargeting default moves from campaign to show", () => {
  const note = "Retargeting runs in its own campaign, DHB26-TRANCOSO · Retargeting.";
  it("a show that takes its own Retargeting campaign gets no per-campaign Retargeting line, and the panel one note", () => {
    const input = trancoso("645185673672763", { retargeting: { takes: true, note } });
    assert.equal(defaultOf(input, "retargeting"), undefined);
    assert.ok(defaultOf(input, "registrations_lookalike"), "the lookalike default stands");
    assert.equal(buildProposal(input, ONSALE_PHASE).notes.retargeting, note);
  });

  it("a show that can't take it (no pixel, or a pixel that sells elsewhere) keeps the default as today, with no note", () => {
    const input = trancoso("645185673672763", { retargeting: { takes: false, note: null } });
    assert.ok(defaultOf(input, "retargeting"));
    assert.equal(buildProposal(input, ONSALE_PHASE).notes.retargeting, undefined);
  });
});
