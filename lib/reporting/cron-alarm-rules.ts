/**
 * Pure decision layer for the cron alarms. No DB, no Slack — so the
 * judgement can be tested without either.
 */
import {
  CRON_ALARMS,
  MISSING_INTERVAL_MULTIPLIER,
  NOT_REPORTING_GRACE_MS,
  type AlarmCondition,
  type CronAlarmSpec,
} from "./cron-alarm-config.ts";

export interface CronRunFact {
  cronName: string;
  startedAt: string;
  ok: boolean;
  rowsWritten: number;
  rowsConsidered: number;
  detail: Record<string, unknown>;
}

/** What the evaluator reads from the DB so the rules stay pure. */
export interface AlarmEvidence {
  /** Most recent run per cron, if any. */
  latestRunByCron: Map<string, CronRunFact>;
  /** Events whose claimed campaigns spent in the lookback window. */
  eventsWithRecentMetaSpend: number;
  /** Events with a ticket source and a show today or later. */
  eventsExpectingTickets: number;
  /** Events with tier-channel sales inside the 7-day window. */
  eventsInTierChannelWindow: number;
  /**
   * When this watcher first ran. Null on the very first run — nothing has
   * been observed yet, so "not reporting" cannot mean anything.
   */
  evaluatorFirstRunAt?: string | null;
  /** First `cron_runs` row per cron, for the per-cron half of the grace. */
  firstSeenByCron?: Map<string, string>;
}

/** The three counts, without the run maps — what goes in the detail jsonb. */
export type AlarmCounts = Pick<
  AlarmEvidence,
  "eventsWithRecentMetaSpend" | "eventsExpectingTickets" | "eventsInTierChannelWindow"
>;

export function evaluateCronAlarms(
  evidence: AlarmEvidence,
  now: Date,
  specs: CronAlarmSpec[] = CRON_ALARMS,
): AlarmCondition[] {
  const out: AlarmCondition[] = [];

  for (const spec of specs) {
    const run = evidence.latestRunByCron.get(spec.cronName);
    const dueAfterMinutes = spec.intervalMinutes * MISSING_INTERVAL_MULTIPLIER;

    // (a) Not reporting. A cron that never ran at all is the loudest case,
    // and the one a freshness monitor cannot see: a table that was already
    // cold stays cold whether or not anything tried to warm it.
    const lastSeenAt = run?.startedAt ?? null;
    const ageMinutes = lastSeenAt
      ? (now.getTime() - new Date(lastSeenAt).getTime()) / 60000
      : Number.POSITIVE_INFINITY;
    // Grace: silent until 24h after the later of this watcher's first run
    // and this cron's own first row. Without it, day one is a dozen alerts
    // that only say "the table is new".
    const inGrace = withinNotReportingGrace(evidence, spec.cronName, now);

    if (!inGrace && ageMinutes > dueAfterMinutes) {
      out.push({ kind: "not_reporting", cronName: spec.cronName, lastSeenAt, dueAfterMinutes });
      // A cron that isn't reporting cannot also have written an
      // implausible zero — one alarm, not two, for one fault.
      continue;
    }
    if (!run) continue;

    // (b) Implausible zero. A zero is only a fault when something was
    // expected; 0 of 0 candidates is a quiet day and must stay silent, or
    // the alarm trains people to ignore it.
    if (run.rowsWritten > 0) continue;
    const reason = implausibleZeroReason(spec.zeroRule, evidence);
    if (reason) {
      out.push({ kind: "implausible_zero", cronName: spec.cronName, rule: spec.zeroRule, reason });
    }
  }
  return out;
}

/**
 * Whether "not reporting" is still graced for one cron. Exported so the
 * evaluator reports the same set it acts on rather than recomputing it.
 */
export function withinNotReportingGrace(
  evidence: AlarmEvidence,
  cronName: string,
  now: Date,
): boolean {
  const from = laterOf(
    evidence.evaluatorFirstRunAt ?? null,
    evidence.firstSeenByCron?.get(cronName) ?? null,
  );
  if (from === null) return true;
  return now.getTime() - new Date(from).getTime() < NOT_REPORTING_GRACE_MS;
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function implausibleZeroReason(
  rule: CronAlarmSpec["zeroRule"],
  evidence: AlarmEvidence,
): string | null {
  switch (rule) {
    case "rollup_meta":
      return evidence.eventsWithRecentMetaSpend > 0
        ? `${evidence.eventsWithRecentMetaSpend} event(s) had claimed-campaign spend in the lookback window`
        : null;
    case "tickets":
      return evidence.eventsExpectingTickets > 0
        ? `${evidence.eventsExpectingTickets} event(s) have a ticket source and a show today or later`
        : null;
    case "tier_channel":
      return evidence.eventsInTierChannelWindow > 0
        ? `${evidence.eventsInTierChannelWindow} event(s) with tier-channel sales are inside the window`
        : null;
    case "never":
      return null;
  }
}
