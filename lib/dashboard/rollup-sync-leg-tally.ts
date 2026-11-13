/**
 * Per-leg tallies for the rollup-sync cron's `cron_runs` rows.
 *
 * A leg with nothing to do is not a failed leg. An event whose client has
 * no TikTok account, no Google Ads account, no ticketing link or no Meta
 * ad account is skipped by that leg, and an event with a TikTok account
 * but no TikTok campaign carrying its code in the window has nothing to
 * sync. Counting those as failures is how the TikTok leg read
 * "31 event(s) failed this leg" on every run from 6 to 12 Nov 2026 while
 * making no TikTok error at all: of the 40 events on 12 Nov, 22 had no
 * TikTok campaign under their code, 8 had no TikTok account, 1 had no
 * event code, and 9 synced. The tickets leg read "40 failed" with every
 * event unlinked.
 *
 * `failed` is a leg that was asked to do something and could not: an API
 * error, missing or undecryptable credentials, an account with no
 * advertiser or customer id, or an event whose whole sync threw (no
 * reason at all). Skips are counted by reason and kept in `detail`, so a
 * jump in `no_rows` or `no_tiktok_account` is still visible on the run.
 */

export type RollupLeg = "meta" | "tickets" | "tiktok" | "google";

export const ROLLUP_LEGS: readonly RollupLeg[] = ["meta", "tickets", "tiktok", "google"];

/**
 * Reasons that mean "nothing to do for this event", per leg. A result
 * that is not ok and carries any other reason, or no reason, is a failure.
 */
export const LEG_SKIP_REASONS: Record<RollupLeg, readonly string[]> = {
  meta: ["no_event_code", "no_ad_account"],
  tickets: ["not_linked"],
  tiktok: ["no_event_code", "no_tiktok_account", "no_rows"],
  google: ["no_event_code", "no_google_ads_account"],
};

/** Failures kept per leg per run. The count is always complete; the list is a sample. */
export const LEG_FAILURE_SAMPLE = 50;

export type LegOutcome = "ok" | "skipped" | "failed";

export interface LegEventResult {
  eventCode: string | null;
  ok: boolean;
  reason?: string | null;
  error?: string | null;
  rows?: number | null;
}

export interface LegFailure {
  eventCode: string | null;
  reason: string | null;
  error: string | null;
}

export interface LegTally {
  /** Rows the leg wrote across every event. */
  rows: number;
  /** Events the cron ran, whether or not this leg applied to them. */
  considered: number;
  /** Events this leg was asked to sync: ok + failed. */
  applicable: number;
  ok: number;
  failed: number;
  /** Skip reason → events. */
  skipped: Record<string, number>;
  failures: LegFailure[];
}

export function legOutcome(leg: RollupLeg, result: Pick<LegEventResult, "ok" | "reason">): LegOutcome {
  if (result.ok) return "ok";
  const reason = result.reason?.trim() ?? "";
  return reason && LEG_SKIP_REASONS[leg].includes(reason) ? "skipped" : "failed";
}

export function emptyLegTally(): LegTally {
  return { rows: 0, considered: 0, applicable: 0, ok: 0, failed: 0, skipped: {}, failures: [] };
}

export function emptyLegTallies(): Record<RollupLeg, LegTally> {
  return { meta: emptyLegTally(), tickets: emptyLegTally(), tiktok: emptyLegTally(), google: emptyLegTally() };
}

export function addLegResult(tally: LegTally, leg: RollupLeg, result: LegEventResult): LegOutcome {
  tally.considered += 1;
  tally.rows += result.rows ?? 0;
  const outcome = legOutcome(leg, result);
  if (outcome === "ok") {
    tally.ok += 1;
    tally.applicable += 1;
  } else if (outcome === "skipped") {
    const reason = result.reason!.trim();
    tally.skipped[reason] = (tally.skipped[reason] ?? 0) + 1;
  } else {
    tally.failed += 1;
    tally.applicable += 1;
    if (tally.failures.length < LEG_FAILURE_SAMPLE) {
      tally.failures.push({
        eventCode: result.eventCode,
        reason: result.reason?.trim() || null,
        error: result.error?.trim() || null,
      });
    }
  }
  return outcome;
}

export interface LegRunRecord {
  ok: boolean;
  rowsWritten: number;
  rowsConsidered: number;
  detail: Record<string, unknown>;
  error: string | null;
}

/**
 * The `cron_runs` row for one leg. `rows_considered` stays the number of
 * events the cron ran, which the alarm zero rules read; the applicable
 * count sits in `detail` beside the skips and the failure sample.
 */
export function legRunRecord(tally: LegTally, extraDetail: Record<string, unknown> = {}): LegRunRecord {
  return {
    ok: tally.failed === 0,
    rowsWritten: tally.rows,
    rowsConsidered: tally.considered,
    detail: {
      ...extraDetail,
      failedEvents: tally.failed,
      okEvents: tally.ok,
      applicableEvents: tally.applicable,
      skipped: { ...tally.skipped },
      failures: [...tally.failures],
    },
    error: tally.failed > 0 ? `${tally.failed} event(s) failed this leg` : null,
  };
}
