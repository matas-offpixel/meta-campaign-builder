/**
 * Freshness alarm for the rollup tickets leg.
 *
 * The 2026-07 dead-leg sat silent for a quarter because nothing compared
 * snapshot ingest to rollup writes. If snapshots keep landing and the
 * collapsed lifetime grew, but every event's rollup tickets stay 0,
 * fire Slack ads_urgent. A new client with no snapshots is not an alarm.
 * A quiet week with no lifetime growth is not an alarm.
 */

import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";

export const ROLLUP_TICKETS_DEAD_DEDUPE_KEY = "rollup_tickets_dead";
export const ROLLUP_TICKETS_DEAD_SNAPSHOT_MIN = 50;
export const ROLLUP_TICKETS_DEAD_WINDOW_DAYS = 7;

export interface RollupTicketsFreshnessInput {
  snapshotRowsInWindow: number;
  /** Sum of per-event (max lifetime − min lifetime) in the window. */
  snapshotLifetimeGrowthInWindow: number;
  rollupTicketsSumInWindow: number;
  snapshotMin?: number;
}

export function shouldAlarmRollupTicketsDead(
  input: RollupTicketsFreshnessInput,
): boolean {
  const min = input.snapshotMin ?? ROLLUP_TICKETS_DEAD_SNAPSHOT_MIN;
  if (input.snapshotRowsInWindow < min) return false;
  if (input.snapshotLifetimeGrowthInWindow <= 0) return false;
  return input.rollupTicketsSumInWindow === 0;
}

export function rollupTicketsDeadAlarmText(input: RollupTicketsFreshnessInput): string {
  return (
    `Rollup tickets leg is dead: ${input.snapshotRowsInWindow} ticket_sales_snapshots ` +
    `row(s) landed in the trailing window and collapsed lifetime grew by ` +
    `${input.snapshotLifetimeGrowthInWindow}, but event_daily_rollups.tickets_sold ` +
    `sums to ${input.rollupTicketsSumInWindow} across every event. ` +
    `Snapshots are ingesting; rollups are not.`
  );
}

export async function notifyRollupTicketsDeadIfNeeded(
  input: RollupTicketsFreshnessInput,
  notify: (opts: NotifyOptions) => Promise<NotifyResult>,
): Promise<{ alarmed: boolean; result?: NotifyResult }> {
  if (!shouldAlarmRollupTicketsDead(input)) {
    return { alarmed: false };
  }
  const result = await notify({
    channel: "ads_urgent",
    text: rollupTicketsDeadAlarmText(input),
    dedupeKey: ROLLUP_TICKETS_DEAD_DEDUPE_KEY,
    respectBusinessHours: false,
  });
  return { alarmed: true, result };
}
