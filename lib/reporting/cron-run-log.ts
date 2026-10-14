/**
 * One row per cron run. The thing `cron_health_reports` cannot say.
 *
 * The existing monitor samples the freshest write in each table and flags
 * staleness. That catches "the table went cold", but a cron that runs on
 * time, returns `ok: true` and writes zero rows keeps the table exactly as
 * warm as it was — so the monitor stays green. Two real examples:
 *
 *   snapshot-tier-channel-sales-daily  reported ok for a week while its
 *                                      48 h filter matched nothing
 *   the rollup tickets leg             dead since 3 Sep, never alarmed
 *
 * So every cron records what it actually did, and the evaluator decides
 * whether a zero was plausible. `rowsConsidered` is what makes that
 * judgement possible: 0 written of 0 candidates is a quiet day, 0 written
 * of 54 is a fault.
 *
 * Never throws. A failure to log must not fail the cron it is logging —
 * the run already happened, and losing the log is strictly better than
 * losing the work.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CronRunRecord {
  cronName: string;
  startedAt: string;
  ok: boolean;
  rowsWritten: number;
  rowsConsidered?: number;
  /** Evidence the evaluator needs, kept DB-side so it never calls Meta. */
  detail?: Record<string, unknown>;
  error?: string | null;
}

export async function recordCronRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: Pick<SupabaseClient<any>, "from">,
  run: CronRunRecord,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("cron_runs").insert({
      cron_name: run.cronName,
      started_at: run.startedAt,
      finished_at: new Date().toISOString(),
      ok: run.ok,
      rows_written: run.rowsWritten,
      rows_considered: run.rowsConsidered ?? 0,
      detail: run.detail ?? {},
      error: run.error ?? null,
    });
    if (error) {
      console.warn(`[cron-run-log] ${run.cronName} insert failed: ${error.message}`);
    }
  } catch (err) {
    console.warn(
      `[cron-run-log] ${run.cronName} threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
