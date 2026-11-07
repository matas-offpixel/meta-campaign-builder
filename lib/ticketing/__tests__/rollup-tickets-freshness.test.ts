import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { NotifyOptions, NotifyResult } from "../../notify/slack.ts";
import {
  ROLLUP_TICKETS_DEAD_DEDUPE_KEY,
  notifyRollupTicketsDeadIfNeeded,
  shouldAlarmRollupTicketsDead,
  snapshotListingGrowth,
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

describe("snapshotListingGrowth", () => {
  it("does not treat two flat listings on one event as growth", () => {
    assert.equal(
      snapshotListingGrowth([
        { event_id: "e", source: "fourthefans", external_event_id: "218", tickets_sold: 218 },
        { event_id: "e", source: "fourthefans", external_event_id: "4318", tickets_sold: 4318 },
        { event_id: "e", source: "fourthefans", external_event_id: "218", tickets_sold: 218 },
        { event_id: "e", source: "fourthefans", external_event_id: "4318", tickets_sold: 4318 },
      ]),
      0,
    );
  });

  it("the loader reads each listing, not one lifetime per event", () => {
    const loader = readFileSync("lib/db/rollup-tickets-freshness-load.ts", "utf8");
    assert.match(loader, /snapshotListingGrowth/);
    assert.match(loader, /external_event_id, connection_id/);
  });

  it("sums real movement on each listing", () => {
    assert.equal(
      snapshotListingGrowth([
        { event_id: "e", source: "fourthefans", external_event_id: "218", tickets_sold: 100 },
        { event_id: "e", source: "fourthefans", external_event_id: "218", tickets_sold: 150 },
        { event_id: "e", source: "fourthefans", connection_id: "c2", tickets_sold: 4 },
        { event_id: "e", source: "fourthefans", connection_id: "c2", tickets_sold: 9 },
      ]),
      55,
    );
  });
});
