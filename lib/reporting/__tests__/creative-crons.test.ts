import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ACTIVE_EVENT_START_CUTOFF_MS,
  ACTIVE_PRESET_START_CUTOFF_MS,
  INSIGHTS_ACCOUNT_RESERVE_MS,
  hasRoomFor,
  orderAccountPairsStalestFirst,
  presetFailed,
  summariseActiveCreativesRun,
  summariseInsightsRun,
  type InsightsPairResult,
  type PresetOutcome,
} from "../creative-crons.ts";

const SOFT_TIMEOUT_MS = 790_000;
const MAX_DURATION_MS = 800_000;

describe("hasRoomFor", () => {
  it("lets an insights account start only with its reserve left", () => {
    // 16 Nov 06:30: the third account started at 9 min and ran to 13 min.
    assert.equal(hasRoomFor(373_000, 10_000 + INSIGHTS_ACCOUNT_RESERVE_MS, SOFT_TIMEOUT_MS), true);
    assert.equal(hasRoomFor(540_000, 10_000 + INSIGHTS_ACCOUNT_RESERVE_MS, SOFT_TIMEOUT_MS), false);
  });

  it("keeps the slowest active-creatives preset inside the 800 s cap", () => {
    const slowestPresetMs = 166_000; // UTB0044 last_30d, 16 Nov
    assert.ok(ACTIVE_PRESET_START_CUTOFF_MS + slowestPresetMs < MAX_DURATION_MS);
    assert.ok(ACTIVE_EVENT_START_CUTOFF_MS < ACTIVE_PRESET_START_CUTOFF_MS);
  });
});

describe("orderAccountPairsStalestFirst", () => {
  const pairs = [
    { userId: "u", adAccountId: "act_fresh" },
    { userId: "u", adAccountId: "act_never" },
    { userId: "u", adAccountId: "act_old" },
  ];

  it("puts a never-snapshotted account first, then the oldest", () => {
    const last = new Map([
      ["u::act_fresh", Date.UTC(2026, 10, 16)],
      ["u::act_old", Date.UTC(2026, 9, 30)],
    ]);
    assert.deepEqual(
      orderAccountPairsStalestFirst(pairs, last).map((p) => p.adAccountId),
      ["act_never", "act_old", "act_fresh"],
    );
  });

  it("does not mutate its input", () => {
    const copy = [...pairs];
    orderAccountPairsStalestFirst(pairs, new Map());
    assert.deepEqual(pairs, copy);
  });
});

describe("summariseInsightsRun", () => {
  const ok = (id: string, written = 2000): InsightsPairResult => ({
    adAccountId: id,
    presetsRun: 2,
    snapshotsWritten: written,
    errors: [],
  });

  it("treats accounts left for the next run as deferred, not failed", () => {
    const now = Date.UTC(2026, 10, 16, 6, 43);
    const summary = summariseInsightsRun(
      [
        ok("act_a"),
        ok("act_b"),
        { adAccountId: "act_c", presetsRun: 0, snapshotsWritten: 0, skipped: "timeout", errors: [] },
      ],
      new Map([["act_c", now - 17 * 24 * 3_600_000]]),
      now,
    );
    assert.equal(summary.ok, true);
    assert.equal(summary.error, null);
    assert.equal(summary.detail.accountsRefreshed, 2);
    assert.deepEqual(summary.detail.accountsDeferred, ["act_c"]);
    assert.equal(summary.detail.stalestDeferredHours, 408);
  });

  it("fails on an account error and says which account and why", () => {
    const summary = summariseInsightsRun([
      ok("act_a"),
      {
        adAccountId: "act_b",
        presetsRun: 0,
        snapshotsWritten: 0,
        errors: [{ preset: "last_7d", message: "User request limit reached" }],
      },
    ]);
    assert.equal(summary.ok, false);
    assert.match(summary.error ?? "", /1 of 2 accounts failed: act_b last_7d: User request limit reached/);
    assert.deepEqual(summary.detail.accountsFailed, [
      { account: "act_b", error: "last_7d: User request limit reached" },
    ]);
  });

  it("fails when an account has no token", () => {
    const summary = summariseInsightsRun([
      { adAccountId: "act_a", presetsRun: 0, snapshotsWritten: 0, skipped: "no_token", errors: [] },
    ]);
    assert.equal(summary.ok, false);
    assert.match(summary.error ?? "", /no Meta token for act_a/);
  });

  it("clips a long error so the run row stays readable", () => {
    const summary = summariseInsightsRun([
      { adAccountId: "act_a", presetsRun: 0, snapshotsWritten: 0, errors: [{ preset: "last_7d", message: "x".repeat(2000) }] },
    ]);
    assert.ok((summary.error ?? "").length <= 500);
  });
});

describe("presetFailed", () => {
  const p = (over: Partial<PresetOutcome>): PresetOutcome => ({
    preset: "maximum",
    kind: "ok",
    wroteSnapshot: true,
    ...over,
  });

  it("is false for a written preset, a skip and a deferred preset", () => {
    assert.equal(presetFailed(p({})), false);
    assert.equal(presetFailed(p({ kind: "skip", wroteSnapshot: false, skipReason: "no_linked_campaigns" })), false);
    assert.equal(presetFailed(p({ kind: "skip", wroteSnapshot: false, deferred: true })), false);
  });

  it("is true for a Meta error and for an ok fetch whose write failed", () => {
    assert.equal(presetFailed(p({ kind: "error", wroteSnapshot: false, error: "rate limited" })), true);
    assert.equal(presetFailed(p({ wroteSnapshot: false, error: "upsert failed" })), true);
  });
});

describe("summariseActiveCreativesRun", () => {
  const written = (preset: string): PresetOutcome => ({ preset, kind: "ok", wroteSnapshot: true });
  const skip = (reason: string): PresetOutcome => ({ preset: "maximum", kind: "skip", wroteSnapshot: false, skipReason: reason });
  const deferred = (preset: string): PresetOutcome => ({ preset, kind: "skip", wroteSnapshot: false, skipReason: "time_budget", deferred: true });

  it("is ok when the only non-writes are skips and deferrals, and counts them", () => {
    const summary = summariseActiveCreativesRun(
      [
        { eventId: "1", eventCode: "UTB0043-New", presetsWritten: 4, presetResults: ["maximum", "last_30d", "last_14d", "last_7d"].map(written) },
        { eventId: "2", eventCode: "UTB0044-New", presetsWritten: 2, presetResults: [written("maximum"), written("last_30d"), deferred("last_14d"), deferred("last_7d")] },
        { eventId: "3", eventCode: "OLD1", presetsWritten: 0, presetResults: [skip("no_linked_campaigns"), skip("no_linked_campaigns")] },
        { eventId: "4", eventCode: null, presetsWritten: 0, presetResults: [skip("no_event_code")] },
      ],
      40,
    );
    assert.equal(summary.ok, true);
    assert.equal(summary.error, null);
    assert.deepEqual(summary.detail, {
      events: 44,
      eventsRefreshed: 2,
      eventsNotStarted: 40,
      eventsPartial: 1,
      eventsSkipped: { no_linked_campaigns: 1, no_event_code: 1 },
      eventsFailed: [],
    });
  });

  it("fails on a Meta error or a throw, naming the event by its code", () => {
    const summary = summariseActiveCreativesRun(
      [
        { eventId: "1", eventCode: "UTB0043-New", presetsWritten: 3, presetResults: [written("maximum"), { preset: "last_7d", kind: "error", wroteSnapshot: false, error: "Meta 500" }] },
        { eventId: "evt-2", eventCode: null, presetsWritten: 0, presetResults: [], error: "boom" },
      ],
      0,
    );
    assert.equal(summary.ok, false);
    assert.match(summary.error ?? "", /2 of 2 events failed: UTB0043-New last_7d: Meta 500; evt-2 boom/);
    assert.equal(summary.detail.eventsFailed.length, 2);
  });
});
