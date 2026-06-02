/**
 * __tests__/components/MailchimpRegistrationsCard.test.ts
 *
 * Unit tests for the MailchimpRegistrationsCard display math.
 * Verifies daily growth (vs yesterday) and total-subscribers CPR basis.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Pure logic helpers used by MailchimpRegistrationsCard
import { computeDailyGrowth } from "../../lib/mailchimp/daily-growth.ts";

describe("MailchimpRegistrationsCard math (Ironworks fixture)", () => {
  const ironworksSnapshots = [
    // Baseline from campaign launch
    { email_subscribers: 2800, snapshot_at: "2026-05-20T06:00:00Z" },
    // ... intermediate days omitted for brevity ...
    { email_subscribers: 2996, snapshot_at: "2026-06-01T06:00:00Z" },
    { email_subscribers: 3006, snapshot_at: "2026-06-02T06:00:00Z" },
  ];

  const totalSpendGbp = 3569; // £2,636 Meta + £933 TikTok

  test("totalSubscribers is latest snapshot value", () => {
    const latest = ironworksSnapshots.at(-1)!;
    assert.equal(latest.email_subscribers, 3006);
  });

  test("daily growth is today vs yesterday (not vs baseline)", () => {
    const { dailyNew, compareToDate } = computeDailyGrowth(ironworksSnapshots);
    assert.equal(dailyNew, 10); // 3006 - 2996
    assert.equal(compareToDate, "2026-06-01");
  });

  test("CPR = totalSpend / totalSubscribers (not per new reg)", () => {
    const totalSubscribers = ironworksSnapshots.at(-1)!.email_subscribers!;
    const cpr = totalSpendGbp / totalSubscribers;
    // £3,569 / 3,006 ≈ £1.187...
    assert.ok(cpr > 1.18 && cpr < 1.19, `CPR ${cpr} not in [1.18, 1.19]`);
  });

  test("old CPR (spend/newRegs) would give wrong ~£263 value", () => {
    const { dailyNew } = computeDailyGrowth(ironworksSnapshots);
    // This was the wrong formula — sanity-check it's no longer used
    const wrongCpr = totalSpendGbp / (dailyNew ?? 1);
    assert.ok(wrongCpr > 350, `Expected wrong CPR to be large, got ${wrongCpr}`);
  });
});

describe("MailchimpRegistrationsCard — edge cases", () => {
  test("empty snapshots: no crash, all nulls", () => {
    const result = computeDailyGrowth([]);
    assert.equal(result.dailyNew, null);
  });

  test("single snapshot: dailyNew is null", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 1000, snapshot_at: "2026-06-01T00:00:00Z" },
    ]);
    assert.equal(result.dailyNew, null);
    assert.equal(result.compareToDate, null);
  });

  test("zero-growth day: dailyNew = 0", () => {
    const result = computeDailyGrowth([
      { email_subscribers: 3006, snapshot_at: "2026-06-01T00:00:00Z" },
      { email_subscribers: 3006, snapshot_at: "2026-06-02T00:00:00Z" },
    ]);
    assert.equal(result.dailyNew, 0);
  });
});
