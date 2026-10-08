/**
 * Google launcher v2 PR 1 — budgets, CPC caps, bid floor, negatives.
 *
 * Runs against the real Ironworks build sheets:
 *   IRW0001 Jamie Jones   — numeric "Max CPC cap (£)" column
 *   IRW0004 CamelPhat     — phased "Cap (£) A → B" strings
 *   IRW0005 Appetite      — phased "Cap (£) A/B → C" strings, C5 Paused,
 *                           `costume` negatives scoped away from C3
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { effectivePlanDailyBudget, formatPounds, resolveCampaignDailyBudgets } from "../budget.ts";
import { resolveAdGroupCpcMicros, resolveCpcCeilingMicros } from "../bids.ts";
import { findNegativeKeywordConflicts, negativeBlocksKeyword } from "../negative-conflicts.ts";
import { campaignPushPreview } from "../push-preview.ts";
import { validateGoogleSearchPlan } from "../validation.ts";
import { parseCpcCapCell, parseGoogleSearchPlanXlsx } from "../xlsx-import.ts";
import type {
  GoogleSearchNegative,
  GoogleSearchPlanDraftTree,
  GoogleSearchPlanTree,
  GoogleSearchStructureMode,
} from "../types.ts";

const FIXTURES = new URL("./fixtures/", import.meta.url);

function parseFixture(file: string, structureMode: GoogleSearchStructureMode) {
  return parseGoogleSearchPlanXlsx(new Uint8Array(readFileSync(new URL(file, FIXTURES))), { structureMode });
}

const JAMIE_JONES = "IRW0001_JamieJones_GoogleSearch_BuildSheet.xlsx";
const CAMELPHAT = "IRW0004_CamelPhat_GoogleSearch_BuildSheet.xlsx";
const APPETITE = "IRW0005_AppetiteHalloween_GoogleSearch_BuildSheet.xlsx";

/** Give a parsed draft ids the way createGoogleSearchPlanTreeFromDraft does. */
function hydrate(draft: GoogleSearchPlanDraftTree): GoogleSearchPlanTree {
  const now = "2026-10-08T00:00:00Z";
  const campaignIds = new Map<string, string>();
  const adGroupIds = new Map<string, string>();
  const campaigns = draft.campaigns.map((c, ci) => {
    const id = `c-${ci}`;
    campaignIds.set(c.name, id);
    return {
      ...c,
      id,
      plan_id: "plan-1",
      pushed_resource_name: null,
      created_at: now,
      negatives: [] as GoogleSearchNegative[],
      ad_groups: c.ad_groups.map((ag, ai) => {
        const agId = `${id}-ag-${ai}`;
        adGroupIds.set(`${c.name}::${ag.name}`, agId);
        return {
          ...ag,
          id: agId,
          campaign_id: id,
          pushed_resource_name: null,
          created_at: now,
          keywords: ag.keywords.map((k, ki) => ({
            ...k,
            id: `${agId}-kw-${ki}`,
            ad_group_id: agId,
            pushed_resource_name: null,
            created_at: now,
          })),
          rsas: ag.rsas.map((r, ri) => ({
            ...r,
            id: `${agId}-rsa-${ri}`,
            ad_group_id: agId,
            pushed_resource_name: null,
            created_at: now,
          })),
        };
      }),
    };
  });
  const planNegatives: GoogleSearchNegative[] = [];
  draft.negatives.forEach((n, i) => {
    const { scope, ...rest } = n;
    const base = { ...rest, id: `neg-${i}`, plan_id: "plan-1", pushed_resource_name: null, created_at: now };
    if (scope.kind === "plan") {
      planNegatives.push({ ...base, campaign_id: null, ad_group_id: null });
      return;
    }
    const campaignId = campaignIds.get(scope.campaign_name);
    assert.ok(campaignId, `negative scoped to unknown campaign ${scope.campaign_name}`);
    const adGroupId =
      scope.kind === "ad_group" ? adGroupIds.get(`${scope.campaign_name}::${scope.ad_group_name}`) : null;
    if (scope.kind === "ad_group") assert.ok(adGroupId, `unknown ad group ${scope.ad_group_name}`);
    campaigns
      .find((c) => c.id === campaignId)!
      .negatives.push({ ...base, campaign_id: campaignId, ad_group_id: adGroupId ?? null });
  });
  return {
    plan: {
      ...draft.plan,
      id: "plan-1",
      user_id: "user-1",
      event_id: null,
      google_ads_account_id: "acct-1",
      status: "draft",
      pushed_at: null,
      created_at: now,
      updated_at: now,
    },
    campaigns,
    plan_negatives: planNegatives,
    sitelinks: [],
  };
}

// ─── 1.2 CPC caps ─────────────────────────────────────────────────────

describe("CPC cap import", () => {
  it("parses phased cap cells unrounded", () => {
    assert.deepEqual(parseCpcCapCell("0.80 → 1.10"), [0.8, 1.1]);
    assert.deepEqual(parseCpcCapCell("1.30→1.80"), [1.3, 1.8]);
    assert.deepEqual(parseCpcCapCell(0.95), [0.95]);
    assert.deepEqual(parseCpcCapCell("£0.70"), [0.7]);
    assert.deepEqual(parseCpcCapCell(""), []);
  });

  it("imports all five CamelPhat caps from the phased 'Cap (£) A → B' column", () => {
    const draft = parseFixture(CAMELPHAT, "campaign_per_theme");
    assert.equal(draft.campaigns.length, 5);
    assert.deepEqual(
      draft.campaigns.map((c) => c.bid_adjustments.max_cpc_cap),
      [0.8, 1.3, 0.8, 0.9, 0.9],
    );
    assert.deepEqual(
      draft.campaigns.map((c) => c.bid_adjustments.max_cpc_cap_phases),
      [
        [0.8, 1.1],
        [1.3, 1.8],
        [0.8, 1.0],
        [0.9, 1.2],
        [0.9, 1.4],
      ],
    );
  });

  it("imports Appetite's caps from 'Cap (£) A/B → C'", () => {
    const draft = parseFixture(APPETITE, "campaign_per_theme");
    assert.deepEqual(
      draft.campaigns.map((c) => c.bid_adjustments.max_cpc_cap),
      [0.7, 1.1, 0.8, 0.9, 1.3],
    );
  });

  it("still reads Jamie Jones' numeric 'Max CPC cap (£)' column", () => {
    const draft = parseFixture(JAMIE_JONES, "campaign_per_theme");
    assert.deepEqual(
      draft.campaigns.map((c) => c.bid_adjustments.max_cpc_cap),
      [0.8, 1.3, 1, 0.6, 0.9],
    );
  });

  it("ceiling = round(cap × 1e6), else the £2.00 default", () => {
    assert.deepEqual(resolveCpcCeilingMicros({ max_cpc_cap: 0.8 }), { micros: 800_000, fromSheet: true });
    assert.deepEqual(resolveCpcCeilingMicros({ max_cpc_cap: 1.3 }), { micros: 1_300_000, fromSheet: true });
    assert.deepEqual(resolveCpcCeilingMicros({}), { micros: 2_000_000, fromSheet: false });
  });
});

// ─── 1.3 Bid floor ────────────────────────────────────────────────────

describe("ad-group bid", () => {
  it("default_cpc 0.7 → 700000, not the £1 budget floor", () => {
    assert.equal(String(resolveAdGroupCpcMicros(0.7)), "700000");
  });
  it("PostgREST numeric strings are read as numbers", () => {
    assert.equal(resolveAdGroupCpcMicros("0.80"), 800_000);
  });
  it("floor is 1p; missing → £0.25", () => {
    assert.equal(resolveAdGroupCpcMicros(0.001), 10_000);
    assert.equal(resolveAdGroupCpcMicros(null), 250_000);
  });
});

// ─── 1.1 Budget ───────────────────────────────────────────────────────

describe("plan budget", () => {
  it("£500 over 17 days → £29.41/day and 29_410_000 micros on a single campaign", () => {
    const tree = hydrate(parseFixture(CAMELPHAT, "single_campaign"));
    tree.plan.total_budget = 500;
    tree.plan.date_range = { since: "2026-10-08", until: "2026-10-24" };
    tree.campaigns[0].daily_budget = null;
    assert.equal(effectivePlanDailyBudget(tree.plan), 29.41);
    assert.equal(formatPounds(effectivePlanDailyBudget(tree.plan)!), "£29.41");
    const [budget] = resolveCampaignDailyBudgets(tree);
    assert.equal(budget.micros, 29_410_000);
    assert.equal(budget.source, "plan_split");
    const [row] = campaignPushPreview(tree);
    assert.equal(row.daily, "£29.41");
    // Merged single campaign takes the highest source cap (C2 £1.30).
    assert.equal(row.ceiling, "£1.30");
  });

  it("Review lists each CamelPhat campaign's ceiling from its cap", () => {
    const tree = hydrate(parseFixture(CAMELPHAT, "campaign_per_theme"));
    assert.deepEqual(
      campaignPushPreview(tree).map((r) => [r.ceiling, r.ceilingFromSheet]),
      [
        ["£0.80", true],
        ["£1.30", true],
        ["£0.80", true],
        ["£0.90", true],
        ["£0.90", true],
      ],
    );
  });

  it("reads the plan total from the 'Budget & Phasing' tab", () => {
    const camel = parseFixture(CAMELPHAT, "single_campaign");
    assert.equal(camel.plan.total_budget, 500);
    // 2026-10-07 → 2026-10-24 inclusive = 18 days
    assert.equal(camel.plan.daily_budget, 27.78);
    assert.equal(camel.campaigns[0].daily_budget, 27.78);
    assert.equal(parseFixture(APPETITE, "campaign_per_theme").plan.total_budget, 500);
    assert.equal(parseFixture(JAMIE_JONES, "campaign_per_theme").plan.total_budget, 300);
  });

  it("campaign_per_theme splits the plan daily budget over the campaigns that serve", () => {
    const tree = hydrate(parseFixture(APPETITE, "campaign_per_theme"));
    for (const c of tree.campaigns) c.daily_budget = null;
    // £500 / 40 days = £12.50/day; C5 is Paused in the sheet → 4 serving → £3.12 each.
    const budgets = resolveCampaignDailyBudgets(tree);
    assert.deepEqual(budgets.map((b) => b.micros), [3_120_000, 3_120_000, 3_120_000, 3_120_000, 3_120_000]);
    assert.deepEqual(budgets.map((b) => b.serves), [true, true, true, true, false]);
    assert.ok(budgets.every((b) => b.source === "plan_split"));
  });

  it("Review blocks when campaign budgets overspend the plan by more than 10%", () => {
    // Appetite as stored in prod: 5 × £10/day (C5 paused) for 40 days against £500.
    const tree = hydrate(parseFixture(APPETITE, "campaign_per_theme"));
    for (const c of tree.campaigns) c.daily_budget = 10;
    const issue = validateGoogleSearchPlan(tree).find((i) => i.code === "budget_exceeds_plan");
    assert.ok(issue);
    assert.equal(issue.severity, "error");
    assert.equal(issue.message, "Campaigns would spend £1600.00 over 40 days against a £500.00 plan.");
  });

  it("Review does not block within the 10% tolerance", () => {
    const tree = hydrate(parseFixture(APPETITE, "campaign_per_theme"));
    for (const c of tree.campaigns) c.daily_budget = 3.4; // 4 × 3.40 × 40 = £544 ≤ £550
    assert.equal(validateGoogleSearchPlan(tree).some((i) => i.code === "budget_exceeds_plan"), false);
  });

  it("Review hard-blocks the £5 last resort", () => {
    const tree = hydrate(parseFixture(CAMELPHAT, "campaign_per_theme"));
    tree.plan.total_budget = null;
    tree.plan.daily_budget = null;
    for (const c of tree.campaigns) c.daily_budget = null;
    const fallbacks = validateGoogleSearchPlan(tree).filter((i) => i.code === "budget_fallback_daily");
    assert.equal(fallbacks.length, 5);
    assert.ok(fallbacks.every((i) => i.severity === "error"));
    assert.match(fallbacks[0].message, /No daily budget resolved — push would spend £5\.00\/day/);
  });
});

// ─── 1.4 Negatives ────────────────────────────────────────────────────

describe("negative match semantics", () => {
  const neg = (keyword: string, match_type: "BROAD" | "PHRASE" | "EXACT") => ({ keyword, match_type });
  it("phrase: words contiguous and in order", () => {
    assert.equal(negativeBlocksKeyword(neg("costume", "PHRASE"), "costume party london"), true);
    assert.equal(negativeBlocksKeyword(neg("costume party", "PHRASE"), "london costume party"), true);
    assert.equal(negativeBlocksKeyword(neg("party costume", "PHRASE"), "costume party london"), false);
    assert.equal(negativeBlocksKeyword(neg("costume", "PHRASE"), "costumes london"), false);
  });
  it("broad: every word, any order", () => {
    assert.equal(negativeBlocksKeyword(neg("london party", "BROAD"), "costume party london"), true);
    assert.equal(negativeBlocksKeyword(neg("london rave", "BROAD"), "costume party london"), false);
  });
  it("exact: the whole keyword only", () => {
    assert.equal(negativeBlocksKeyword(neg("costume party london", "EXACT"), "Costume Party London"), true);
    assert.equal(negativeBlocksKeyword(neg("costume party", "EXACT"), "costume party london"), false);
  });
});

describe("single-campaign negatives — CamelPhat", () => {
  const tree = hydrate(parseFixture(CAMELPHAT, "single_campaign"));

  it("no campaign-scoped negative becomes plan-scoped", () => {
    const perTheme = parseFixture(CAMELPHAT, "campaign_per_theme");
    const sheetPlanScoped = perTheme.negatives.filter((n) => n.scope.kind === "plan").length;
    assert.equal(tree.plan_negatives.length, sheetPlanScoped);
    const competitorNegatives = perTheme.negatives.filter((n) => n.scope.kind === "campaign").map((n) => n.keyword);
    assert.ok(competitorNegatives.length > 0);
    const planKeywords = new Set(tree.plan_negatives.map((n) => n.keyword));
    const widened = competitorNegatives.filter(
      (k) => planKeywords.has(k) && !perTheme.negatives.some((n) => n.scope.kind === "plan" && n.keyword === k),
    );
    assert.deepEqual(widened, [], "0 plan-scoped competitor negatives");
  });

  it("campaign negatives are ad-group negatives on that campaign's ad groups", () => {
    const negatives = tree.campaigns[0].negatives;
    assert.ok(negatives.length > 0);
    assert.ok(negatives.every((n) => n.ad_group_id != null));
  });

  it("conquest ad groups keep every keyword — nothing blocks them", () => {
    const conflicts = findNegativeKeywordConflicts(tree);
    assert.deepEqual(
      conflicts.map((c) => `${c.adGroupName}: ${c.negative} → ${c.keyword}`),
      [],
    );
    assert.equal(validateGoogleSearchPlan(tree).some((i) => i.code === "negative_blocks_keyword"), false);
  });
});

describe("negative conflicts — Appetite costume", () => {
  it("as the sheet scopes them, `costume` stays off C3 and nothing conflicts", () => {
    const tree = hydrate(parseFixture(APPETITE, "single_campaign"));
    const costume = findNegativeKeywordConflicts(tree).filter((c) => c.negative === "costume");
    assert.deepEqual(costume, []);
  });

  it("widened to plan scope (the old single-campaign import), Review blocks costume vs costume party london", () => {
    const tree = hydrate(parseFixture(APPETITE, "single_campaign"));
    const merged = tree.campaigns[0];
    tree.plan_negatives = [
      ...tree.plan_negatives,
      ...merged.negatives.map((n) => ({ ...n, campaign_id: null, ad_group_id: null })),
    ];
    merged.negatives = [];
    const issues = validateGoogleSearchPlan(tree).filter((i) => i.code === "negative_blocks_keyword");
    const pair = issues.find((i) => /"costume" \(phrase\) blocks keyword "costume party london"/.test(i.message));
    assert.ok(pair, issues.map((i) => i.message).join("\n"));
    assert.equal(pair.severity, "error");
    assert.match(pair.message, /plan negative/);
  });
});
