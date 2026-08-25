import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import type { NotifyOptions, NotifyResult } from "../../notify/slack.ts";
import {
  ROLLUP_TICKETS_DEAD_DEDUPE_KEY,
  notifyRollupTicketsDeadIfNeeded,
  shouldAlarmRollupTicketsDead,
} from "../rollup-tickets-freshness.ts";

describe("shouldAlarmRollupTicketsDead", () => {
  it("fires when snapshots ingested, lifetime grew, and every rollup ticket is zero", () => {
    assert.equal(
      shouldAlarmRollupTicketsDead({
        snapshotRowsInWindow: 80,
        snapshotLifetimeGrowthInWindow: 502,
        rollupTicketsSumInWindow: 0,
      }),
      true,
    );
  });

  it("stays silent for a new client with no snapshots", () => {
    assert.equal(
      shouldAlarmRollupTicketsDead({
        snapshotRowsInWindow: 0,
        snapshotLifetimeGrowthInWindow: 0,
        rollupTicketsSumInWindow: 0,
      }),
      false,
    );
  });

  it("stays silent when snapshots exist but lifetime did not grow (quiet week)", () => {
    assert.equal(
      shouldAlarmRollupTicketsDead({
        snapshotRowsInWindow: 200,
        snapshotLifetimeGrowthInWindow: 0,
        rollupTicketsSumInWindow: 0,
      }),
      false,
    );
  });

  it("stays silent when the rollup leg is writing", () => {
    assert.equal(
      shouldAlarmRollupTicketsDead({
        snapshotRowsInWindow: 80,
        snapshotLifetimeGrowthInWindow: 502,
        rollupTicketsSumInWindow: 502,
      }),
      false,
    );
  });
});

describe("notifyRollupTicketsDeadIfNeeded", () => {
  it("posts ads_urgent with dedupe key rollup_tickets_dead on a dead-leg fixture", async () => {
    const calls: NotifyOptions[] = [];
    const result = await notifyRollupTicketsDeadIfNeeded(
      {
        snapshotRowsInWindow: 80,
        snapshotLifetimeGrowthInWindow: 119,
        rollupTicketsSumInWindow: 0,
      },
      async (opts) => {
        calls.push(opts);
        return { sent: true } satisfies NotifyResult;
      },
    );
    assert.equal(result.alarmed, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.channel, "ads_urgent");
    assert.equal(calls[0]?.dedupeKey, ROLLUP_TICKETS_DEAD_DEDUPE_KEY);
    assert.match(calls[0]?.text ?? "", /Rollup tickets leg is dead/);
  });

  it("does not notify when either side is legitimately quiet", async () => {
    const calls: NotifyOptions[] = [];
    const quiet = await notifyRollupTicketsDeadIfNeeded(
      {
        snapshotRowsInWindow: 0,
        snapshotLifetimeGrowthInWindow: 0,
        rollupTicketsSumInWindow: 0,
      },
      async (opts) => {
        calls.push(opts);
        return { sent: true };
      },
    );
    assert.equal(quiet.alarmed, false);
    assert.equal(calls.length, 0);
  });
});
