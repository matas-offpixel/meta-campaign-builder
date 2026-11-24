import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateCronAlarms, type AlarmEvidence, type CronRunFact } from "../cron-alarm-rules.ts";
import { alarmDedupeKey, type CronAlarmSpec } from "../cron-alarm-config.ts";

const NOW = new Date("2026-10-14T12:00:00Z");
const run = (over: Partial<CronRunFact> = {}): CronRunFact => ({
  cronName: "rollup-sync-events",
  startedAt: "2026-10-14T11:00:00Z",
  ok: true, rowsWritten: 10, rowsConsidered: 10, detail: {}, ...over,
});
/** Long past the 24h grace by default, so a test that says nothing about
 * the grace period is testing the staleness rule it means to test. */
const SETTLED = "2026-10-01T00:00:00Z";
const evidence = (over: Partial<AlarmEvidence> = {}): AlarmEvidence => ({
  latestRunByCron: new Map(),
  eventsWithRecentMetaSpend: 0,
  eventsExpectingTickets: 0,
  eventsInTierChannelWindow: 0,
  evaluatorFirstRunAt: SETTLED,
  firstSeenByCron: new Map([
    ["rollup-sync-events", SETTLED],
    ["rollup-sync-events:meta", SETTLED],
    ["snapshot-tier-channel-sales-daily", SETTLED],
    ["sync-ticketing", SETTLED],
    ["cron-alarm-evaluator", SETTLED],
  ]),
  ...over,
});
const SPEC: CronAlarmSpec[] = [
  { cronName: "rollup-sync-events", intervalMinutes: 360, zeroRule: "rollup_meta" },
];
const TIER: CronAlarmSpec[] = [
  { cronName: "snapshot-tier-channel-sales-daily", intervalMinutes: 1440, zeroRule: "tier_channel" },
];

describe("evaluateCronAlarms", () => {
  it("is silent when a cron ran recently and wrote rows", () => {
    const out = evaluateCronAlarms(
      evidence({ latestRunByCron: new Map([["rollup-sync-events", run()]]) }), NOW, SPEC);
    assert.deepEqual(out, []);
  });

  it("alarms when a cron has never reported at all", () => {
    const out = evaluateCronAlarms(evidence(), NOW, SPEC);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.kind, "not_reporting");
    assert.equal((out[0] as { lastSeenAt: string | null }).lastSeenAt, null);
  });

  it("waits 2x the interval before calling a cron missing", () => {
    // 7h late on a 6h cron: inside 2x, still quiet.
    const quiet = evaluateCronAlarms(evidence({
      latestRunByCron: new Map([["rollup-sync-events", run({ startedAt: "2026-10-14T05:00:00Z" })]]),
    }), NOW, SPEC);
    assert.deepEqual(quiet, []);
    // 13h late: past 2x, alarm.
    const loud = evaluateCronAlarms(evidence({
      latestRunByCron: new Map([["rollup-sync-events", run({ startedAt: "2026-10-13T23:00:00Z" })]]),
    }), NOW, SPEC);
    assert.equal(loud[0]?.kind, "not_reporting");
  });

  it("stays silent on a zero when nothing was expected", () => {
    const out = evaluateCronAlarms(evidence({
      latestRunByCron: new Map([["rollup-sync-events", run({ rowsWritten: 0, rowsConsidered: 0 })]]),
      eventsWithRecentMetaSpend: 0,
    }), NOW, SPEC);
    assert.deepEqual(out, [], "a quiet day must not train people to ignore the alarm");
  });

  it("alarms on a zero when claimed campaigns did spend", () => {
    const out = evaluateCronAlarms(evidence({
      latestRunByCron: new Map([["rollup-sync-events", run({ rowsWritten: 0 })]]),
      eventsWithRecentMetaSpend: 3,
    }), NOW, SPEC);
    assert.equal(out[0]?.kind, "implausible_zero");
    assert.match((out[0] as { reason: string }).reason, /3 event/);
  });

  it("does not alarm the tier-channel zero while every event is out of window", () => {
    // Today's real state: all 54 events with tier-channel sales are >7d past.
    const out = evaluateCronAlarms(evidence({
      latestRunByCron: new Map([["snapshot-tier-channel-sales-daily",
        run({ cronName: "snapshot-tier-channel-sales-daily", rowsWritten: 0, rowsConsidered: 0 })]]),
      eventsInTierChannelWindow: 0,
    }), NOW, TIER);
    assert.deepEqual(out, []);
  });

  it("raises one alarm, not two, for a cron that is simply absent", () => {
    const out = evaluateCronAlarms(evidence({ eventsWithRecentMetaSpend: 9 }), NOW, SPEC);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.kind, "not_reporting");
  });

  it("says nothing on day one, when cron_runs is simply new", () => {
    // The watcher's own first run: no evaluator row yet, so every entry
    // looks like it has never reported. A dozen Slack messages that only
    // say "this table is new" would teach people to mute the channel.
    const out = evaluateCronAlarms(
      evidence({ evaluatorFirstRunAt: null, firstSeenByCron: new Map() }),
      NOW,
      SPEC,
    );
    assert.deepEqual(out, []);
  });

  it("keeps a cron graced for 24h after the watcher's first run", () => {
    const graced = evaluateCronAlarms(
      evidence({ evaluatorFirstRunAt: "2026-10-13T13:00:00Z", firstSeenByCron: new Map() }),
      NOW, SPEC);
    assert.deepEqual(graced, [], "23h in: still settling");
    const loud = evaluateCronAlarms(
      evidence({ evaluatorFirstRunAt: "2026-10-13T11:00:00Z", firstSeenByCron: new Map() }),
      NOW, SPEC);
    assert.equal(loud[0]?.kind, "not_reporting", "25h in: the silence is real");
  });

  it("grants a late-added cron its own grace, not the watcher's expired one", () => {
    // Watcher settled a fortnight ago; this cron first reported an hour
    // ago and is on a 6h schedule. It cannot be late yet.
    const out = evaluateCronAlarms(
      evidence({
        evaluatorFirstRunAt: SETTLED,
        firstSeenByCron: new Map([["rollup-sync-events", "2026-10-14T11:00:00Z"]]),
        latestRunByCron: new Map([["rollup-sync-events", run({ startedAt: "2026-10-14T11:00:00Z" })]]),
      }),
      NOW, SPEC);
    assert.deepEqual(out, []);
  });

  it("still alarms an implausible zero on day one", () => {
    // The grace covers silence, not a lie: a cron that ran and wrote an
    // impossible zero is telling the truth about itself from run one.
    const out = evaluateCronAlarms(
      evidence({
        evaluatorFirstRunAt: null,
        firstSeenByCron: new Map(),
        latestRunByCron: new Map([["rollup-sync-events", run({ rowsWritten: 0 })]]),
        eventsWithRecentMetaSpend: 4,
      }),
      NOW, SPEC);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.kind, "implausible_zero");
  });

  it("gives each condition a stable dedupe key", () => {
    assert.equal(
      alarmDedupeKey({ kind: "not_reporting", cronName: "x", lastSeenAt: null, dueAfterMinutes: 1 }),
      "cron_not_reporting:x");
    assert.equal(
      alarmDedupeKey({ kind: "implausible_zero", cronName: "x", rule: "tickets", reason: "r" }),
      "cron_zero:x:tickets");
  });
});

describe("the agreed alarm set", () => {
  it("keeps sync-ticketing silent now that no connection is active", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const spec = CRON_ALARMS.filter((s) => s.cronName === "sync-ticketing");
    // 4theFans' two connections were paused on 14 Oct, so the cron
    // legitimately considers 0 and writes 0 on every run.
    const out = evaluateCronAlarms(
      evidence({
        latestRunByCron: new Map([[
          "sync-ticketing",
          run({ cronName: "sync-ticketing", rowsWritten: 0, rowsConsidered: 0 }),
        ]]),
        eventsExpectingTickets: 0,
      }),
      NOW,
      spec,
    );
    assert.deepEqual(out, [], "no active connections means no tickets expected");
  });

  it("still alarms sync-ticketing if an event genuinely expects tickets", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const spec = CRON_ALARMS.filter((s) => s.cronName === "sync-ticketing");
    const out = evaluateCronAlarms(
      evidence({
        latestRunByCron: new Map([[
          "sync-ticketing",
          run({ cronName: "sync-ticketing", rowsWritten: 0, rowsConsidered: 0 }),
        ]]),
        eventsExpectingTickets: 2,
      }),
      NOW, spec,
    );
    assert.equal(out[0]?.kind, "implausible_zero");
  });

  it("tolerates the overnight gap without crying every morning", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const spec = CRON_ALARMS.filter((s) => s.cronName === "rollup-sync-events:meta");
    // 19:00 run, evaluated at 06:00 — 11h, inside 2x720.
    const out = evaluateCronAlarms(
      evidence({
        latestRunByCron: new Map([[
          "rollup-sync-events:meta",
          run({ cronName: "rollup-sync-events:meta", startedAt: "2026-10-13T19:00:00Z" }),
        ]]),
      }),
      new Date("2026-10-14T06:00:00Z"), spec,
    );
    assert.deepEqual(out, []);
  });

  it("watches the watcher", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const spec = CRON_ALARMS.filter((s) => s.cronName === "cron-alarm-evaluator");
    assert.equal(spec.length, 1, "the evaluator must be in its own alarm set");
    const out = evaluateCronAlarms(evidence(), NOW, spec);
    assert.equal(out[0]?.kind, "not_reporting");
  });

  it("does not alarm a cron that was never built", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    assert.equal(
      CRON_ALARMS.some((s) => s.cronName === "internal-counts-ingest"),
      false,
    );
  });

  it("excludes the crons that are 0 by design", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const names = CRON_ALARMS.map((s) => s.cronName);
    for (const excluded of ["match-attribution", "show-week-burst", "mailchimp-backfill-tick"]) {
      assert.ok(!names.includes(excluded), `${excluded} must not be alarmed`);
    }
    assert.ok(!names.some((n) => n.startsWith("d2c-")), "d2c crons are idle");
  });
});

describe("night_all_zero rule (bm-page-scan, three runs a London night)", () => {
  const BM: CronAlarmSpec[] = [
    { cronName: "bm-page-scan", intervalMinutes: 1440, zeroRule: "night_all_zero", runsPerNight: 3 },
  ];
  // Night of 22 Nov 2026 (GMT, so UTC = London): runs 21:15, 01:15, 04:15.
  const R1 = "2026-11-22T21:15:00Z";
  const R2 = "2026-11-23T01:15:00Z";
  const R3 = "2026-11-23T04:15:00Z";
  const bmRun = (startedAt: string, over: Partial<CronRunFact> = {}) =>
    run({ cronName: "bm-page-scan", startedAt, rowsWritten: 0, rowsConsidered: 70, ...over });
  const ev = (runs: CronRunFact[]) =>
    evidence({
      latestRunByCron: new Map([["bm-page-scan", runs[0]]]),
      recentRunsByCron: new Map([["bm-page-scan", runs]]),
      firstSeenByCron: new Map([["bm-page-scan", SETTLED]]),
    });
  const at = (iso: string) => new Date(iso);

  it("puts 21:15, 01:15 and 04:15 UTC in one London night, in GMT and in BST", async () => {
    const { londonNightKey } = await import("../cron-alarm-rules.ts");
    assert.equal(londonNightKey(R1), "2026-11-22");
    assert.equal(londonNightKey(R2), "2026-11-22");
    assert.equal(londonNightKey(R3), "2026-11-22");
    // BST: 21:15 UTC is 22:15 London, 04:15 UTC is 05:15 London.
    assert.equal(londonNightKey("2026-06-10T21:15:00Z"), "2026-06-10");
    assert.equal(londonNightKey("2026-06-11T04:15:00Z"), "2026-06-10");
    // Noon London starts the next night.
    assert.equal(londonNightKey("2026-11-23T12:00:00Z"), "2026-11-23");
  });

  it("is silent after a rate-limited zero while the night's other runs are still to come", () => {
    const out = evaluateCronAlarms(ev([bmRun(R1)]), at("2026-11-22T22:15:00Z"), BM);
    assert.deepEqual(out, []);
    const out2 = evaluateCronAlarms(ev([bmRun(R2), bmRun(R1)]), at("2026-11-23T02:15:00Z"), BM);
    assert.deepEqual(out2, []);
  });

  it("is silent when any run that night scanned a BM", () => {
    const runs = [bmRun(R3), bmRun(R2, { rowsWritten: 18 }), bmRun(R1)];
    assert.deepEqual(evaluateCronAlarms(ev(runs), at("2026-11-23T05:15:00Z"), BM), []);
  });

  it("alarms once all three runs that night scanned 0", () => {
    const runs = [bmRun(R3), bmRun(R2), bmRun(R1)];
    const out = evaluateCronAlarms(ev(runs), at("2026-11-23T05:15:00Z"), BM);
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, "implausible_zero");
    assert.match((out[0] as { reason: string }).reason, /0 of 70 done in all 3 run\(s\) on the night of 2026-11-22/);
  });

  it("ignores the previous night's runs", () => {
    // Last night's three zeros, then tonight's first zero: tonight isn't complete.
    const runs = [
      bmRun("2026-11-23T21:15:00Z"),
      bmRun(R3), bmRun(R2), bmRun(R1),
    ];
    assert.deepEqual(evaluateCronAlarms(ev(runs), at("2026-11-23T22:15:00Z"), BM), []);
  });

  it("alarms a night that ended with fewer runs, all zero", () => {
    const runs = [bmRun(R2), bmRun(R1)];
    const out = evaluateCronAlarms(ev(runs), at("2026-11-23T13:15:00Z"), BM);
    assert.equal(out.length, 1);
    assert.match((out[0] as { reason: string }).reason, /all 2 run\(s\)/);
  });

  it("alarms a hard failure at once, even on the night's first run", () => {
    const out = evaluateCronAlarms(
      ev([bmRun(R1, { ok: false, rowsConsidered: 0 })]),
      at("2026-11-22T22:15:00Z"),
      BM,
    );
    assert.equal(out.length, 1);
    assert.match((out[0] as { reason: string }).reason, /failed/);
  });

  it("is silent on 0 of 0 all night (every BM under an archived client)", () => {
    const runs = [R3, R2, R1].map((t) => bmRun(t, { rowsConsidered: 0 }));
    assert.deepEqual(evaluateCronAlarms(ev(runs), at("2026-11-23T05:15:00Z"), BM), []);
  });

  it("still alarms a scan that stopped reporting for two days", () => {
    const out = evaluateCronAlarms(ev([bmRun("2026-11-21T04:15:00Z")]), at("2026-11-23T05:15:00Z"), BM);
    assert.equal(out[0]?.kind, "not_reporting");
  });

  it("is wired into CRON_ALARMS with the night rule and the 48 h no-run window", async () => {
    const { CRON_ALARMS, MISSING_INTERVAL_MULTIPLIER } = await import("../cron-alarm-config.ts");
    const spec = CRON_ALARMS.find((s) => s.cronName === "bm-page-scan");
    assert.deepEqual(spec, {
      cronName: "bm-page-scan",
      intervalMinutes: 1440,
      zeroRule: "night_all_zero",
      runsPerNight: 4,
    });
    assert.equal(spec!.intervalMinutes * MISSING_INTERVAL_MULTIPLIER, 48 * 60);
  });
});

describe("night_all_zero rule with the 80 % usage stop (four runs a London night)", () => {
  const BM: CronAlarmSpec[] = [
    { cronName: "bm-page-scan", intervalMinutes: 1440, zeroRule: "night_all_zero", runsPerNight: 4 },
  ];
  // Night of 24 Nov 2026 (GMT): 21:15, 22:45, 01:15, 04:15 UTC.
  const R1 = "2026-11-24T21:15:00Z";
  const R2 = "2026-11-24T22:45:00Z";
  const R3 = "2026-11-25T01:15:00Z";
  const R4 = "2026-11-25T04:15:00Z";
  const usageStopped = { stopped_by: "app_usage_80", stopped_at_usage: true, bms_skipped_usage: 50 };
  const bmRun = (startedAt: string, over: Partial<CronRunFact> = {}) =>
    run({ cronName: "bm-page-scan", startedAt, rowsWritten: 0, rowsConsidered: 70, ...over });
  const ev = (runs: CronRunFact[]) =>
    evidence({
      latestRunByCron: new Map([["bm-page-scan", runs[0]]]),
      recentRunsByCron: new Map([["bm-page-scan", runs]]),
      firstSeenByCron: new Map([["bm-page-scan", SETTLED]]),
    });

  it("puts 22:45 UTC in the same London night, in GMT and in BST", async () => {
    const { londonNightKey } = await import("../cron-alarm-rules.ts");
    assert.equal(londonNightKey(R2), "2026-11-24");
    // BST: 22:45 UTC is 23:45 London.
    assert.equal(londonNightKey("2026-06-10T22:45:00Z"), "2026-06-10");
  });

  it("does not alarm a run that stopped at 80 % after scanning BMs", () => {
    const runs = [R4, R3, R2, R1].map((t) => bmRun(t, { rowsWritten: 20, detail: usageStopped }));
    assert.deepEqual(evaluateCronAlarms(ev(runs), new Date("2026-11-25T05:15:00Z"), BM), []);
    // The latest run alone, usage-stopped with one BM done, is not a zero either.
    const one = [bmRun(R4, { rowsWritten: 1, detail: usageStopped })];
    assert.deepEqual(evaluateCronAlarms(ev(one), new Date("2026-11-25T13:00:00Z"), BM), []);
  });

  it("waits for all four runs before calling a zero night", () => {
    const three = [R3, R2, R1].map((t) => bmRun(t));
    assert.deepEqual(evaluateCronAlarms(ev(three), new Date("2026-11-25T02:00:00Z"), BM), []);
    const four = [R4, R3, R2, R1].map((t) => bmRun(t));
    const out = evaluateCronAlarms(ev(four), new Date("2026-11-25T05:15:00Z"), BM);
    assert.equal(out.length, 1);
    assert.match((out[0] as { reason: string }).reason, /all 4 run\(s\)/);
  });
});
