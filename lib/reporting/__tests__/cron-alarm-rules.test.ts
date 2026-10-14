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

  it("covers the not-yet-shipped internal-counts cron with the grace rule", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const spec = CRON_ALARMS.filter((s) => s.cronName === "internal-counts-ingest");
    assert.equal(spec.length, 1, "listed before Phase 1 ships the route");
    // Phase 1 has not shipped, so it has no row of its own; the grace is
    // measured from the watcher's first run and must be silent inside it.
    const graced = evaluateCronAlarms(
      evidence({ evaluatorFirstRunAt: "2026-10-14T00:00:00Z", firstSeenByCron: new Map() }),
      NOW, spec);
    assert.deepEqual(graced, []);
  });

  it("excludes the crons that are 0 by design", async () => {
    const { CRON_ALARMS } = await import("../cron-alarm-config.ts");
    const names = CRON_ALARMS.map((s) => s.cronName);
    for (const excluded of ["match-attribution", "show-week-burst", "bm-page-scan", "mailchimp-backfill-tick"]) {
      assert.ok(!names.includes(excluded), `${excluded} must not be alarmed`);
    }
    assert.ok(!names.some((n) => n.startsWith("d2c-")), "d2c crons are idle");
  });
});
