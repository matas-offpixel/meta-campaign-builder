import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  budgetedLaunchAdapters,
  CAMPAIGN_PLAN_OBJECTIVE_INTENTS,
  CAMPAIGN_PLAN_STATUSES,
  deriveCampaignPlanStatus,
  IDLE_PLAN_LAUNCH,
  isCampaignPlanObjectiveIntent,
  isCampaignPlanStatus,
  type CampaignPlanLaunchRecord,
  type CampaignPlanLaunches,
} from "../types.ts";

function launch(
  status: CampaignPlanLaunchRecord["status"],
): CampaignPlanLaunchRecord {
  return {
    ...IDLE_PLAN_LAUNCH,
    status,
    platformCampaignId: status === "live" ? "ext_1" : null,
    error: status === "failed" ? "adapter error" : null,
  };
}

function launches(
  overrides: Partial<CampaignPlanLaunches>,
): CampaignPlanLaunches {
  return {
    meta: IDLE_PLAN_LAUNCH,
    tiktok: IDLE_PLAN_LAUNCH,
    google: IDLE_PLAN_LAUNCH,
    ...overrides,
  };
}

describe("campaign plan status model", () => {
  it("treats live_partial as first-class when siblings disagree", () => {
    const status = deriveCampaignPlanStatus(
      launches({
        meta: launch("live"),
        tiktok: launch("failed"),
      }),
    );
    assert.equal(status, "live_partial");
    assert.ok(CAMPAIGN_PLAN_STATUSES.includes("live_partial"));
    assert.notEqual(status, "failed");
    assert.notEqual(status, "live");
  });

  it("is live only when every attempted adapter that is not idle/skipped succeeded", () => {
    assert.equal(
      deriveCampaignPlanStatus(
        launches({
          meta: launch("live"),
          tiktok: launch("skipped"),
          google: launch("idle"),
        }),
      ),
      "live",
    );
  });

  it("is failed only when at least one adapter failed and none are live", () => {
    assert.equal(
      deriveCampaignPlanStatus(launches({ google: launch("failed") })),
      "failed",
    );
  });

  it("is launching if any adapter is still in flight, even with a sibling live", () => {
    assert.equal(
      deriveCampaignPlanStatus(
        launches({
          meta: launch("live"),
          tiktok: launch("launching"),
        }),
      ),
      "launching",
    );
  });

  it("stays draft when nothing has been attempted", () => {
    assert.equal(deriveCampaignPlanStatus(launches({})), "draft");
  });
});

describe("campaign plan intent invariants", () => {
  it("objective intent is the internal CampaignObjective set, not a platform enum", () => {
    for (const intent of CAMPAIGN_PLAN_OBJECTIVE_INTENTS) {
      assert.equal(isCampaignPlanObjectiveIntent(intent), true);
    }
    assert.equal(isCampaignPlanObjectiveIntent("OUTCOME_SALES"), false);
    assert.equal(isCampaignPlanObjectiveIntent("TRAFFIC"), false);
    assert.equal(isCampaignPlanStatus("live_partial"), true);
    assert.equal(isCampaignPlanStatus("partially_pushed"), false);
  });

  it("zero daily budget means that adapter is not in the launch set", () => {
    const adapters = budgetedLaunchAdapters({
      totalDaily: 80,
      metaDaily: 50,
      tiktokDaily: 30,
      googleDaily: 0,
    });
    assert.ok(adapters.includes("meta"));
    assert.ok(adapters.includes("tiktok"));
    assert.ok(!adapters.includes("google"));
  });
});

describe("campaign_plans schema — no platform enum", () => {
  const sql = readFileSync("supabase/migrations/157_campaign_plans.sql", "utf8");

  it("does not declare a platform enum or platform text check on campaign_plans", () => {
    const intentTable = sql.slice(
      sql.indexOf("create table if not exists campaign_plans"),
      sql.indexOf("create table if not exists campaign_plan_meta_launch"),
    );
    assert.match(intentTable, /objective_intent/);
    assert.match(intentTable, /live_partial/);
    assert.doesNotMatch(intentTable, /platform\s+text/);
    assert.doesNotMatch(intentTable, /check \(platform in/);
    assert.doesNotMatch(intentTable, /'meta',\s*'tiktok',\s*'google'/);
  });

  it("stores adapter outcomes in named 1:1 tables, not a platform-keyed child", () => {
    assert.match(sql, /create table if not exists campaign_plan_meta_launch/);
    assert.match(sql, /create table if not exists campaign_plan_tiktok_launch/);
    assert.match(sql, /create table if not exists campaign_plan_google_launch/);
    assert.match(sql, /auth\.uid\(\) = user_id/);
    assert.match(sql, /references google_search_plans/);
    assert.doesNotMatch(sql, /create table if not exists campaign_plan_launches/);
  });
});
