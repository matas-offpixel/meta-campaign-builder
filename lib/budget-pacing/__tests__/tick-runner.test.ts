import { test } from "node:test";
import assert from "node:assert/strict";

import { runBudgetPacingTick, type BudgetPacingCampaignInput, type BudgetPacingTickDeps } from "../tick-runner.ts";
import type { NotifyOptions, NotifyResult } from "../../notify/slack.ts";

const NOW = new Date("2026-08-05T00:00:00Z");

function campaign(overrides: Partial<BudgetPacingCampaignInput> = {}): BudgetPacingCampaignInput {
  return {
    campaignId: "111",
    campaignName: "Test Campaign",
    currency: "GBP",
    enabledDailyBudgetsMajor: [50], // £50/day
    startDate: "2026-08-01",
    endDate: "2026-08-11", // 10 scheduled days -> £500 planned
    adsManagerUrl: "https://business.facebook.com/adsmanager/manage/campaigns?act=1&selected_campaign_ids=111",
    ...overrides,
  };
}

function baseDeps(overrides: Partial<BudgetPacingTickDeps> = {}): BudgetPacingTickDeps {
  return {
    loadPublishedCampaigns: async () => [campaign()],
    fetchSpendPence: async () => ({ "111": 30000 }), // £300 = 60% of £500
    notify: async () => ({ sent: true }),
    now: NOW,
    ...overrides,
  };
}

test("killswitch off returns immediately without loading campaigns", async () => {
  let loaded = false;
  const summary = await runBudgetPacingTick(
    false,
    baseDeps({ loadPublishedCampaigns: async () => { loaded = true; return []; } }),
  );
  assert.equal(summary.skippedReason, "killswitch");
  assert.equal(loaded, false);
});

test("no campaigns published is a clean no-op success", async () => {
  const summary = await runBudgetPacingTick(true, baseDeps({ loadPublishedCampaigns: async () => [] }));
  assert.equal(summary.ok, true);
  assert.equal(summary.campaignsConsidered, 0);
});

test("60% spend crosses 25/50/60 thresholds and fires one notify per threshold", async () => {
  const notifyCalls: NotifyOptions[] = [];
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    }),
  );
  assert.equal(summary.thresholdsCrossed, 3);
  assert.equal(notifyCalls.length, 3);
  assert.deepEqual(
    notifyCalls.map((c) => c.dedupeKey),
    ["budget_threshold:111:25", "budget_threshold:111:50", "budget_threshold:111:60"],
  );
  for (const call of notifyCalls) {
    assert.equal(call.channel, "ads_ops");
    assert.equal(call.dedupeWindowMs, Number.MAX_SAFE_INTEGER);
  }
});

test("100% (or more) spend crosses every threshold including 100", async () => {
  const notifyCalls: NotifyOptions[] = [];
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({
      fetchSpendPence: async () => ({ "111": 60000 }), // £600 > £500 planned = 120%
      notify: async (opts) => {
        notifyCalls.push(opts);
        return { sent: true };
      },
    }),
  );
  assert.equal(summary.thresholdsCrossed, 7);
  assert.ok(notifyCalls.some((c) => c.dedupeKey === "budget_threshold:111:100"));
});

test("0-spend campaign is skipped with no notify calls", async () => {
  let notifyCalled = false;
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({
      fetchSpendPence: async () => ({ "111": 0 }),
      notify: async () => {
        notifyCalled = true;
        return { sent: true };
      },
    }),
  );
  assert.equal(summary.campaignsSkippedZeroSpend, 1);
  assert.equal(notifyCalled, false);
});

test("a campaign missing from the spend map is treated as 0 spend", async () => {
  const summary = await runBudgetPacingTick(true, baseDeps({ fetchSpendPence: async () => ({}) }));
  assert.equal(summary.campaignsSkippedZeroSpend, 1);
});

test("a campaign with no enabled ad set budget (no valid plan) is skipped before any spend lookup logic runs", async () => {
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({ loadPublishedCampaigns: async () => [campaign({ enabledDailyBudgetsMajor: [] })] }),
  );
  assert.equal(summary.campaignsSkippedNoPlan, 1);
  assert.equal(summary.thresholdsCrossed, 0);
});

test("below the lowest threshold (25%) crosses nothing", async () => {
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({ fetchSpendPence: async () => ({ "111": 10000 }) }), // £100 = 20%
  );
  assert.equal(summary.thresholdsCrossed, 0);
  assert.equal(summary.notificationsSent, 0);
});

test("a deduped notify() result is counted as skipped, not sent, but does not error the tick", async () => {
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({
      notify: async (): Promise<NotifyResult> => ({ sent: false, reason: "deduped" }),
    }),
  );
  assert.equal(summary.notificationsSent, 0);
  assert.equal(summary.notificationsSkipped, 3);
  assert.equal(summary.ok, true);
});

test("one campaign throwing is captured in campaignsErrored without aborting the others", async () => {
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({
      loadPublishedCampaigns: async () => [campaign({ campaignId: "111" }), campaign({ campaignId: "222" })],
      fetchSpendPence: async () => ({ "111": 30000, "222": 30000 }),
      notify: async (opts) => {
        if (opts.dedupeKey?.startsWith("budget_threshold:111")) throw new Error("slack down");
        return { sent: true };
      },
    }),
  );
  assert.equal(summary.campaignsErrored.length, 1);
  assert.equal(summary.campaignsErrored[0].campaignId, "111");
  assert.equal(summary.ok, false);
  // Campaign 222 still got its 3 notifications despite 111 throwing.
  assert.equal(summary.notificationsSent, 3);
});

test("a fetchSpendPence failure marks every campaign errored and does not call notify", async () => {
  let notifyCalled = false;
  const summary = await runBudgetPacingTick(
    true,
    baseDeps({
      fetchSpendPence: async () => {
        throw new Error("Meta API down");
      },
      notify: async () => {
        notifyCalled = true;
        return { sent: true };
      },
    }),
  );
  assert.equal(summary.ok, false);
  assert.equal(summary.campaignsErrored.length, 1);
  assert.equal(notifyCalled, false);
});
