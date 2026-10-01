/**
 * The launch route must refuse a lifetime draft whose ad set payload
 * still carries daily_budget, before createMetaCampaign.
 *
 * Run: node --test lib/meta/__tests__/budget-launch-preflight.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  CBO_CAMPAIGN_HAS_NO_BUDGET,
  LIFETIME_WOULD_LAUNCH_DAILY,
  refuseSilentDailyLaunch,
} from "../budget-launch.ts";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../app/api/meta/launch-campaign/route.ts"),
  "utf8",
);

describe("launch budget preflight", () => {
  it("refuses a lifetime draft whose ad set would carry daily_budget", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [{ daily_budget: 2000 }],
    });
    assert.equal(message, LIFETIME_WOULD_LAUNCH_DAILY);
  });

  it("refuses a CBO campaign payload that carries no budget", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "daily",
      budgetLevel: "campaign",
      campaign: {},
      adSets: [{}],
    });
    assert.equal(message, CBO_CAMPAIGN_HAS_NO_BUDGET);
  });

  it("allows a lifetime ABO payload that sends lifetime_budget only", () => {
    const message = refuseSilentDailyLaunch({
      budgetType: "lifetime",
      budgetLevel: "ad_set",
      campaign: {},
      adSets: [{}],
    });
    assert.equal(message, null);
  });

  it("runs before createMetaCampaign in the launch route", () => {
    const refuseAt = routeSrc.indexOf("refuseSilentDailyLaunch(");
    const createAt = routeSrc.indexOf("createMetaCampaign(");
    assert.ok(refuseAt > 0);
    assert.ok(createAt > refuseAt);
  });
});
