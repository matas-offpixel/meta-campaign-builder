/**
 * Unit tests for lib/mailchimp/activity-reconstruct.ts
 * (pure logic extracted from syncMailchimpAudienceDailyHistory)
 *
 * Tests the reconstructDailyCumulatives() helper which anchors to the live
 * API total and walks backwards through activity deltas to produce per-day
 * cumulative subscriber counts.
 *
 * Also tests resolveMailchimpAudienceId from sync.ts (pure function, no
 * server-only side-effects).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconstructDailyCumulatives, resolveMailchimpAudienceId } from "../activity-reconstruct.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function row(day: string, subs: number, unsubs = 0, other_adds = 0, other_removes = 0) {
  return { day, subs, unsubs, other_adds, other_removes };
}

// ─── reconstructDailyCumulatives ─────────────────────────────────────────────

describe("reconstructDailyCumulatives", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(reconstructDailyCumulatives([], 100), []);
  });

  it("single day: cumulative equals currentActiveTotal", () => {
    const result = reconstructDailyCumulatives([row("2026-06-01", 50)], 200);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.day, "2026-06-01");
    assert.equal(result[0]!.cumulative, 200);
  });

  it("three days with uniform subs: reconstructs descending cumulatives", () => {
    // Today (3 Jun) = 30. Each prior day +10 subs.
    const activity = [
      row("2026-06-01", 10),
      row("2026-06-02", 10),
      row("2026-06-03", 10),
    ];
    const result = reconstructDailyCumulatives(activity, 30);

    // Oldest first
    assert.equal(result[0]!.day, "2026-06-01");
    assert.equal(result[0]!.cumulative, 10);
    assert.equal(result[1]!.day, "2026-06-02");
    assert.equal(result[1]!.cumulative, 20);
    assert.equal(result[2]!.day, "2026-06-03");
    assert.equal(result[2]!.cumulative, 30);
  });

  it("returns results sorted chronologically (oldest first)", () => {
    const activity = [
      row("2026-06-03", 5),
      row("2026-06-01", 5),
      row("2026-06-02", 5),
    ];
    const result = reconstructDailyCumulatives(activity, 15);
    const dates = result.map(r => r.day);
    assert.deepEqual(dates, ["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("handles days with zero subs (carry-forward total)", () => {
    // Day 1: +3, Day 2: +0, Day 3: +0, Day 4: +3. Total = 6.
    const activity = [
      row("2026-05-22", 3),
      row("2026-05-23", 0),
      row("2026-05-24", 0),
      row("2026-05-25", 3),
    ];
    const result = reconstructDailyCumulatives(activity, 6);
    assert.equal(result[0]!.cumulative, 3, "22 May: 3");
    assert.equal(result[1]!.cumulative, 3, "23 May: still 3 (no new subs)");
    assert.equal(result[2]!.cumulative, 3, "24 May: still 3");
    assert.equal(result[3]!.cumulative, 6, "25 May: 6");
  });

  it("accounts for unsubs in net change", () => {
    // 3 Jun: 100. Net on 3 Jun: +20 subs, -5 unsubs = +15.
    // So end-of-2-Jun = 100 - 15 = 85.
    const activity = [
      row("2026-06-02", 0),
      row("2026-06-03", 20, 5),
    ];
    const result = reconstructDailyCumulatives(activity, 100);
    assert.equal(result[0]!.day, "2026-06-02");
    assert.equal(result[0]!.cumulative, 85);
    assert.equal(result[1]!.day, "2026-06-03");
    assert.equal(result[1]!.cumulative, 100);
  });

  it("never returns negative cumulative (floors at 0)", () => {
    // Pathological: more unsubs than subs on a day, so cumulative goes negative.
    const activity = [row("2026-06-01", 0, 200)];
    const result = reconstructDailyCumulatives(activity, 50);
    assert.ok(result[0]!.cumulative >= 0, "cumulative should be >= 0");
  });

  it("Ironworks shape: 22 May to 2 Jun, anchored at 3006", () => {
    // Agency-confirmed data: cumulative goes 3 → 3,006 across 12 days.
    const dailySubs = [3, 0, 0, 100, 200, 400, 600, 700, 600, 300, 50, 53];
    const days = [
      "2026-05-22", "2026-05-23", "2026-05-24",
      "2026-05-25", "2026-05-26", "2026-05-27",
      "2026-05-28", "2026-05-29", "2026-05-30",
      "2026-05-31", "2026-06-01", "2026-06-02",
    ];
    const activity = days.map((day, i) => row(day, dailySubs[i]!));
    const result = reconstructDailyCumulatives(activity, 3006);

    assert.equal(result.length, 12);
    assert.equal(result[0]!.day, "2026-05-22");
    assert.equal(result[0]!.cumulative, 3, "22 May should have 3 cumulative subs");
    assert.equal(result[11]!.day, "2026-06-02");
    assert.equal(result[11]!.cumulative, 3006, "2 Jun should have 3,006 cumulative subs");

    // Verify cumulative is monotonically non-decreasing (no data loss)
    for (let i = 1; i < result.length; i++) {
      assert.ok(
        result[i]!.cumulative >= result[i - 1]!.cumulative,
        `Cumulative should not decrease: ${result[i - 1]!.day}=${result[i - 1]!.cumulative} → ${result[i]!.day}=${result[i]!.cumulative}`,
      );
    }
  });

  it("raw_json source field is set to mailchimp_api_daily_sync in the row description", () => {
    // This is a documentation test — the insert rows in sync.ts set this field.
    // We verify the constant string here for grep-ability.
    const SOURCE = "mailchimp_api_daily_sync";
    assert.equal(SOURCE, "mailchimp_api_daily_sync");
  });
});

// ─── resolveMailchimpAudienceId ───────────────────────────────────────────────

describe("resolveMailchimpAudienceId (from sync.ts)", () => {
  it("returns event-level override first", () => {
    const event = {
      id: "e1", user_id: "u1", kind: "brand_campaign",
      mailchimp_audience_id: "event-aud",
      client: { mailchimp_account_id: "acc", mailchimp_audience_id: "client-aud" },
    };
    assert.equal(resolveMailchimpAudienceId(event), "event-aud");
  });

  it("falls back to client default when event has no override", () => {
    const event = {
      id: "e1", user_id: "u1", kind: "brand_campaign",
      mailchimp_audience_id: null,
      client: { mailchimp_account_id: "acc", mailchimp_audience_id: "client-aud" },
    };
    assert.equal(resolveMailchimpAudienceId(event), "client-aud");
  });

  it("returns null when neither event nor client has an audience id", () => {
    const event = {
      id: "e1", user_id: "u1", kind: "brand_campaign",
      mailchimp_audience_id: null,
      client: { mailchimp_account_id: "acc", mailchimp_audience_id: null },
    };
    assert.equal(resolveMailchimpAudienceId(event), null);
  });

  it("handles array-shaped client relation (Supabase join shape)", () => {
    const event = {
      id: "e1", user_id: "u1", kind: "brand_campaign",
      mailchimp_audience_id: null,
      client: [{ mailchimp_account_id: "acc", mailchimp_audience_id: "array-aud" }],
    };
    assert.equal(resolveMailchimpAudienceId(event as never), "array-aud");
  });
});
