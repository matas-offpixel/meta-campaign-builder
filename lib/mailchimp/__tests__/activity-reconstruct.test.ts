/**
 * lib/mailchimp/__tests__/activity-reconstruct.test.ts
 *
 * Guards against writing fabricated zero-value Mailchimp snapshot rows when
 * the /lists/{id}/activity window is incomplete.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reconstructDailyCumulatives,
  isWritableMailchimpDailySnapshot,
} from "../activity-reconstruct.ts";

function row(day: string, subs: number, unsubs = 0) {
  return { day, subs, unsubs };
}

describe("reconstructDailyCumulatives — uncertain days omitted", () => {
  it("does not emit zero-value rows when backward walk would go negative", () => {
    const activity = [
      row("2026-05-22", 0),
      row("2026-05-23", 0),
      row("2026-05-24", 0),
      row("2026-05-25", 0),
      row("2026-05-26", 0),
      row("2026-05-27", 375),
      row("2026-05-28", 500),
      row("2026-05-29", 500),
      row("2026-05-30", 500),
      row("2026-05-31", 500),
      row("2026-06-01", 390),
      row("2026-06-02", 775),
    ];
    const result = reconstructDailyCumulatives(activity, 3040, {
      eventStartAt: "2026-05-22",
    });

    assert.ok(!result.some((r) => r.cumulative === 0), "must not write zero rows");
    assert.ok(!result.some((r) => r.day < "2026-05-28"));
    assert.equal(result[0]!.day, "2026-05-28");
    assert.equal(result[0]!.cumulative, 375);
  });

  it("activity window shorter than campaign start omits early days (not as zeros)", () => {
    // Campaign started 8 days before the newest activity; API only returned 5 days.
    const activity = [
      row("2026-05-28", 10),
      row("2026-05-29", 20),
      row("2026-05-30", 30),
      row("2026-05-31", 40),
      row("2026-06-01", 50),
    ];
    const result = reconstructDailyCumulatives(activity, 150, {
      eventStartAt: "2026-05-25",
    });

    assert.equal(result.length, 5);
    assert.equal(result[0]!.day, "2026-05-28");
    assert.ok(result.every((r) => r.cumulative > 0));
    assert.ok(!result.some((r) => r.day < "2026-05-28"));
  });

  it("stops at activity gaps wider than 2 days", () => {
    const activity = [
      row("2026-06-01", 10),
      row("2026-05-31", 10),
      row("2026-05-30", 10),
      row("2026-05-20", 100), // 10-day gap → older rows dropped
    ];
    const result = reconstructDailyCumulatives(activity, 40);

    const days = result.map((r) => r.day);
    assert.deepEqual(days, ["2026-05-30", "2026-05-31", "2026-06-01"]);
  });

  it("Ironworks Mailchimp UI curve: 3 on 22 May climbing to 3,040 on 2 Jun", () => {
    const days = [
      "2026-05-22", "2026-05-23", "2026-05-24",
      "2026-05-25", "2026-05-26", "2026-05-27",
      "2026-05-28", "2026-05-29", "2026-05-30",
      "2026-05-31", "2026-06-01", "2026-06-02",
    ];
    const dailySubs = [3, 49, 10, 100, 200, 400, 600, 700, 600, 300, 50];
    const headSum = dailySubs.reduce((s, n) => s + n, 0);
    dailySubs.push(3040 - headSum);
    const activity = days.map((day, i) => row(day, dailySubs[i]!));
    const result = reconstructDailyCumulatives(activity, 3040, {
      eventStartAt: "2026-05-22",
    });

    assert.equal(result.length, 12);
    assert.equal(result[0]!.day, "2026-05-22");
    assert.equal(result[0]!.cumulative, 3);
    assert.equal(result[1]!.day, "2026-05-23");
    assert.equal(result[1]!.cumulative, 52);
    assert.equal(result[11]!.cumulative, 3040);
    assert.ok(result.every((r) => r.cumulative > 0));
  });

  it("isWritableMailchimpDailySnapshot rejects zero", () => {
    assert.equal(isWritableMailchimpDailySnapshot(0), false);
    assert.equal(isWritableMailchimpDailySnapshot(3), true);
  });
});
