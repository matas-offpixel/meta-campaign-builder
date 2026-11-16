/**
 * A new ad set's Retry re-checks the money it stored, on live figures,
 * before any write (16 Nov, Apply armed Live on Kream and Locklead):
 *
 * - headroom: the copy's daily budget for the days left still fits the
 *   plan's headroom against spend to date;
 * - a move: still inside the 20 % cap, and the giver as it is now stays at
 *   £1.00 a day after giving;
 * - the copy's daily budget is still the one funded.
 *
 * Refused with the existing sentences, and nothing is written. Money already
 * committed (the giver already given, or the ad set already made) is
 * finished, never moved twice. A campaign-budget line is unaffected.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APPLY_ENV, applyGates } from "../apply-gates.ts";
import { applyAccepted, type ApplyDeps, type RefreshMeta } from "../apply.ts";
import type { NewAdSetDeps } from "../apply-adsets.ts";
import { BUDGET_CHANGED, NO_BUDGET_TO_START, recheckFunding, type Funding } from "../new-adset.ts";
import { memoryDb, type MemoryDb } from "./memory-db.ts";

const ENV = { [APPLY_ENV]: "1", OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: "true", OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: "true", ENABLE_OPTIMISATION_WRITES: "1" };
const WHERE = { campaignIds: ["c1"], adAccountId: "act_9", draftId: "d1" };
// Accepted on Mon 7 Dec; the show is Sun 27 Dec.
const ACCEPT_DAY = new Date("2026-12-07T09:04:00Z");
const DAYS_LATER = new Date("2026-12-12T09:04:00Z");

const HEADROOM: Funding = { mode: "headroom", dailyGbp: 14.5 };
const MOVE: Funding = { mode: "move", dailyGbp: 14.5, fromAdsetId: "302", fromName: "Lineup — Primary" };

/** A retargeting line that failed after its money was decided (an audience still building), so Retry starts from the stored funding. */
function failedLine(appliedResult: Record<string, unknown>) {
  return {
    id: "rt",
    proposal_id: "p1",
    position: 1,
    kind: "missing_default",
    title: "Retargeting",
    state: "failed",
    reason: "The audience is still being built on Meta.",
    target: {},
    evidence: {},
    applied_result: { source: "retargeting", ...appliedResult },
    write: { kind: "new_adset", source: "retargeting", signupEvent: "CompleteRegistration", country: "GB", landingUrl: "https://puzzle.crqln.com/l/p26-bday", ticketUrl: null, copyFrom: { adsetId: "303", name: "Adv+", dailyGbp: 14.5 }, giver: { adsetId: "302", name: "Lineup — Primary" }, budgetLevel: "ad_set", eventCode: "P26-BDAY", ...WHERE },
  };
}

function seed(line: Record<string, unknown>, spend: number): MemoryDb {
  return memoryDb(
    {
      events: [{ id: "e1", user_id: "u1", budget_marketing: 4500, event_date: "2026-12-27" }],
      event_daily_rollups: [{ event_id: "e1", date: "2026-12-06", ad_spend: spend }],
      onsale_refresh_proposals: [{ id: "p1", event_id: "e1", campaign_key: "On Sale", campaign_ids: ["c1"], window_end: "2026-12-06", cycle_monday: "2026-12-07" }],
      onsale_refresh_lines: [line],
      onsale_refresh_audiences: [],
      campaign_drafts: [{ id: "d1", event_id: "e1", user_id: "u1", ad_account_id: "act_9", status: "published", meta_campaign_id: "c1", import_campaign_id: null, creatives: [] }],
      launched_ad_sets: [],
      meta_write_idempotency: [],
    },
    { onsale_refresh_proposals: { table: "onsale_refresh_proposals", key: "proposal_id" } },
  );
}

/** Meta, faked. `writes` holds every write: audiences, budgets, ad sets, ads. */
function fakes(opts: { cbo?: boolean; giver?: number; copyDaily?: number } = {}) {
  const writes: string[] = [];
  const giver = { daily: opts.giver ?? 4000 };
  const meta: NewAdSetDeps["meta"] = {
    async readAdSetForCopy(id) {
      return id === "303" ? { id, name: "Adv+", campaign_id: "c1", effective_status: "ACTIVE", status: "ACTIVE", targeting: { geo_locations: { countries: ["GB"] } }, daily_budget: opts.cbo ? undefined : String(opts.copyDaily ?? 1450), promoted_object: { pixel_id: "645185673672763" } } : null;
    },
    async readCampaignBudget() {
      return opts.cbo ? { daily: 20000, lifetime: null } : { daily: null, lifetime: null };
    },
    async listAdsForCopy() {
      return [{ id: "a1", name: "Ad 1", creativeId: "cr1", effectiveStatus: "ACTIVE" }];
    },
    async readAdSet(id) {
      return { id, campaignId: "c1", dailyBudget: id === "302" ? giver.daily : 1450 };
    },
    async createAdSet() {
      writes.push("adset");
      return "new-adset";
    },
    async createAd() {
      writes.push("ad");
      return "new-ad";
    },
    async updateAdSetDailyBudget(id, minor) {
      writes.push(`budget:${id}:${minor}`);
      if (id === "302") giver.daily = minor;
    },
    async checkInterests(interests) {
      return { valid: [...interests], retired: [] };
    },
    async audienceState() {
      return "ready";
    },
  };
  const ensureAudience: NewAdSetDeps["ensureAudience"] = async (spec) => {
    writes.push(`audience:${spec.part}`);
    return { metaAudienceId: `aud-${spec.part}`, reused: false };
  };
  return { writes, giver, adsets: { meta, ensureAudience } };
}

async function retry(mem: MemoryDb, fake: ReturnType<typeof fakes>, now: Date) {
  const deps: ApplyDeps = { db: mem.db, env: ENV, meta: {} as RefreshMeta, copyFromDrive: async () => ({ ok: false, reason: "no Drive" }), upload: async () => ({}), adsets: fake.adsets, now };
  await applyAccepted({ deps, eventId: "e1", userId: "u1", gates: applyGates(ENV, "live"), retry: true });
  return mem.tables.onsale_refresh_lines!.find((row) => row.id === "rt")!;
}

describe("Retry re-checks a new ad set's stored headroom on today's figures", () => {
  it("still fits (£14.50 × 20 days = £290 of £640 left): it goes ahead on the stored funding", async () => {
    const fake = fakes();
    const row = await retry(seed(failedLine({ funding: HEADROOM }), 3860), fake, ACCEPT_DAY);
    assert.equal(row.state, "applied", String(row.reason));
    assert.ok(fake.writes.includes("adset"));
    assert.ok(!fake.writes.some((w) => w.startsWith("budget:")), "headroom moves nothing");
  });

  it("a retry five days later with more spend (£14.50 × 15 days = £217.50 > £200 left): refused, nothing written; the next retry checks the same funding again", async () => {
    const mem = seed(failedLine({ funding: HEADROOM }), 4300);
    const fake = fakes();
    const row = await retry(mem, fake, DAYS_LATER);
    assert.equal(row.state, "failed");
    assert.equal(row.reason, NO_BUDGET_TO_START);
    assert.equal(row.reason, "No budget to start it: set this event's budget, or there's nothing left to move this refresh.");
    assert.deepEqual(fake.writes, [], "no audience, budget, ad set or ad");
    assert.deepEqual((row.applied_result as { funding: Funding }).funding, HEADROOM, "kept, so a later retry re-checks the line's own funding");
    const again = await retry(mem, fake, new Date("2026-12-13T09:04:00Z"));
    assert.equal(again.reason, NO_BUDGET_TO_START);
    assert.deepEqual(fake.writes, []);
  });

  it("the copy's daily budget changed since (£14.50 → £20.00): refused as a changed budget, nothing written", async () => {
    const fake = fakes({ copyDaily: 2000 });
    const row = await retry(seed(failedLine({ funding: HEADROOM }), 3860), fake, ACCEPT_DAY);
    assert.equal(row.reason, BUDGET_CHANGED);
    assert.deepEqual(fake.writes, []);
  });
});

describe("Retry re-checks a new ad set's stored move: the 20 % cap and the giver's floor", () => {
  it("still inside the cap (a week £101.50 of £128) and the giver stays over £1.00: the giver gives once, the ad set is made", async () => {
    const fake = fakes();
    const row = await retry(seed(failedLine({ funding: MOVE }), 3860), fake, ACCEPT_DAY);
    assert.equal(row.state, "applied", String(row.reason));
    assert.deepEqual(fake.writes.filter((w) => w.startsWith("budget:")), ["budget:302:2550"]);
  });

  it("days later the cap has shrunk (£60 left, cap £12 < £101.50): refused, nothing written", async () => {
    const fake = fakes();
    const row = await retry(seed(failedLine({ funding: MOVE }), 4440), fake, DAYS_LATER);
    assert.equal(row.reason, NO_BUDGET_TO_START);
    assert.deepEqual(fake.writes, []);
  });

  it("the giver is now at £15.00 a day: giving £14.50 leaves 50p, under the floor — refused before the audiences, nothing written", async () => {
    const fake = fakes({ giver: 1500 });
    const row = await retry(seed(failedLine({ funding: MOVE }), 3860), fake, ACCEPT_DAY);
    assert.equal(row.reason, NO_BUDGET_TO_START);
    assert.deepEqual(fake.writes, [], "no audience is built for a line that can't be funded");
  });

  it("the giver's budget changed after its plan was stored: refused, nothing written", async () => {
    const fake = fakes({ giver: 3000 });
    const row = await retry(seed(failedLine({ funding: MOVE, giverPlan: { adsetId: "302", before: 4000, after: 2550 } }), 3860), fake, ACCEPT_DAY);
    assert.equal(row.reason, BUDGET_CHANGED);
    assert.deepEqual(fake.writes, []);
  });

  it("the giving side was already written: the retry finishes the line with no second move, even though the cap has shrunk since", async () => {
    const fake = fakes({ giver: 2550 });
    const row = await retry(seed(failedLine({ funding: MOVE, giverPlan: { adsetId: "302", before: 4000, after: 2550 }, step: "adset" }), 4440), fake, DAYS_LATER);
    assert.equal(row.state, "applied", String(row.reason));
    assert.ok(!fake.writes.some((w) => w.startsWith("budget:")), "the giver isn't moved twice");
    assert.equal(fake.writes.filter((w) => w === "adset").length, 1);
    assert.equal(fake.giver.daily, 2550);
  });
});

describe("a campaign-budget line is unaffected", () => {
  it("CBO shares the campaign budget: a retry days later with spend near the plan still applies", async () => {
    const fake = fakes({ cbo: true });
    const row = await retry(seed(failedLine({ funding: { mode: "cbo" } }), 4490), fake, DAYS_LATER);
    assert.equal(row.state, "applied", String(row.reason));
    assert.ok(!fake.writes.some((w) => w.startsWith("budget:")));
  });

  it("recheckFunding, pure: CBO stored on a campaign that left CBO is a changed budget; nothing stored as none passes", () => {
    const live = { dailyGbp: 14.5, budget: 4500, spend: 3860, today: "2026-12-07", eventDate: "2026-12-27", appliedMovesGbp: 0 };
    assert.equal(recheckFunding({ mode: "cbo" }, live), BUDGET_CHANGED);
    assert.equal(recheckFunding({ mode: "none" }, live), NO_BUDGET_TO_START);
    assert.equal(recheckFunding(HEADROOM, live), null);
    assert.equal(recheckFunding(MOVE, live), null);
    assert.equal(recheckFunding(MOVE, { ...live, appliedMovesGbp: 30 }), NO_BUDGET_TO_START, "£128 − £30 already moved this refresh < £101.50");
  });
});
