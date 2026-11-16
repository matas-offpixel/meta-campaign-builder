/**
 * lib/reporting/creative-crons.ts
 *
 * Pure helpers shared by `/api/cron/refresh-creative-insights` and
 * `/api/cron/refresh-active-creatives`: their time budgets, the order
 * the insights cron walks ad accounts in, and what each run records in
 * `cron_runs`.
 *
 * Why this exists (16 Nov 2026): both crons ended every run with
 * `ok=false`, `rows_written=0`, `detail={}` and no error text, and some
 * runs left no row at all.
 *   - `rows` read `rowsWritten`, a field neither route returns, so a run
 *     that wrote 10,552 snapshots recorded 0.
 *   - The reasons for a partial run lived only in `results[]`, which the
 *     run log never read, and the 207 body had no `error`.
 *   - Budgets were checked only before starting an account or event, so
 *     one started late ran past Vercel's 800 s cap and the platform
 *     killed the request (504) before the run could be recorded.
 *   - The insights cron walked accounts in PostgREST's return order, so
 *     the same accounts came last and went unrefreshed for 8–17 days.
 *   - Active creatives counted a `skip` (an event with no code, account
 *     or matching campaigns) as a failure.
 *
 * No `@/` imports: the node test runner cannot resolve the alias.
 */
import { orderByStalestFirst } from "../dashboard/cron-rotation.ts";

// ─── Budgets ────────────────────────────────────────────────────────

/**
 * Both routes set `maxDuration = 800`. These reserves are how much room
 * must remain before a unit of work starts, measured on 16 Nov 2026:
 * the slowest insights account took 6 min 3 s for two presets (about
 * 3 min each); the slowest active-creatives preset took 2 min 46 s.
 */
export const INSIGHTS_ACCOUNT_RESERVE_MS = 360_000;
export const INSIGHTS_PRESET_RESERVE_MS = 200_000;
/** Active creatives: no new event after 8 min, no new preset after 10 min. */
export const ACTIVE_EVENT_START_CUTOFF_MS = 480_000;
export const ACTIVE_PRESET_START_CUTOFF_MS = 600_000;

/** True when `reserveMs` of work can still start and finish inside `budgetMs`. */
export function hasRoomFor(elapsedMs: number, reserveMs: number, budgetMs: number): boolean {
  return elapsedMs + reserveMs <= budgetMs;
}

// ─── Insights: account order ────────────────────────────────────────

export interface AccountPair {
  userId: string;
  adAccountId: string;
}

export function accountPairKey(pair: AccountPair): string {
  return `${pair.userId}::${pair.adAccountId}`;
}

/**
 * Least-recently-snapshotted account first; an account with no
 * snapshot leads. Turns the time budget into a rotation, so an account
 * left over by one run leads the next.
 */
export function orderAccountPairsStalestFirst<T extends AccountPair>(
  pairs: readonly T[],
  lastSnapshotAtByKey: ReadonlyMap<string, number>,
): T[] {
  const keyed = pairs.map((pair) => ({ id: accountPairKey(pair), pair }));
  return orderByStalestFirst(keyed, lastSnapshotAtByKey).map((row) => row.pair);
}

// ─── Run logs ───────────────────────────────────────────────────────

const ERROR_TEXT_MAX = 500;

function clip(text: string): string {
  return text.length > ERROR_TEXT_MAX ? `${text.slice(0, ERROR_TEXT_MAX - 1)}…` : text;
}

export interface InsightsPairResult {
  adAccountId: string;
  presetsRun: number;
  snapshotsWritten: number;
  skipped?: "no_token" | "timeout";
  errors: { preset: string; message: string }[];
}

export interface InsightsRunSummary {
  ok: boolean;
  error: string | null;
  detail: {
    accounts: number;
    accountsRefreshed: number;
    /** Left for the next run by the time budget. Not a failure: the next run starts with them. */
    accountsDeferred: string[];
    accountsNoToken: string[];
    accountsFailed: { account: string; error: string }[];
    /** Hours since the stalest deferred account was last snapshotted. Grows if the rotation stalls. */
    stalestDeferredHours: number | null;
  };
}

/**
 * A run fails when an account errors or has no token. An account the
 * budget left for the next run is reported, not failed.
 */
export function summariseInsightsRun(
  results: readonly InsightsPairResult[],
  lastSnapshotAtByAccount: ReadonlyMap<string, number> = new Map(),
  nowMs: number = Date.now(),
): InsightsRunSummary {
  const failed = results
    .filter((r) => r.errors.length > 0)
    .map((r) => ({
      account: r.adAccountId,
      error: r.errors.map((e) => `${e.preset}: ${e.message}`).join(" | "),
    }));
  const noToken = results.filter((r) => r.skipped === "no_token").map((r) => r.adAccountId);
  const deferred = results.filter((r) => r.skipped === "timeout").map((r) => r.adAccountId);
  const refreshed = results.filter((r) => r.presetsRun > 0 && r.errors.length === 0).length;

  let stalestDeferredHours: number | null = null;
  for (const account of deferred) {
    const at = lastSnapshotAtByAccount.get(account);
    const hours = at === undefined ? null : Math.round(((nowMs - at) / 3_600_000) * 10) / 10;
    if (hours === null) continue;
    if (stalestDeferredHours === null || hours > stalestDeferredHours) stalestDeferredHours = hours;
  }

  const ok = failed.length === 0 && noToken.length === 0;
  const parts: string[] = [];
  if (failed.length > 0) {
    parts.push(
      `${failed.length} of ${results.length} accounts failed: ${failed.map((f) => `${f.account} ${f.error}`).join("; ")}`,
    );
  }
  if (noToken.length > 0) parts.push(`no Meta token for ${noToken.join(", ")}`);

  return {
    ok,
    error: ok ? null : clip(parts.join(". ")),
    detail: {
      accounts: results.length,
      accountsRefreshed: refreshed,
      accountsDeferred: deferred,
      accountsNoToken: noToken,
      accountsFailed: failed.map((f) => ({ account: f.account, error: clip(f.error) })),
      stalestDeferredHours,
    },
  };
}

export interface PresetOutcome {
  preset: string;
  kind: "ok" | "skip" | "error";
  wroteSnapshot: boolean;
  error?: string;
  skipReason?: string;
  /** Not started because the run's time budget was spent. */
  deferred?: boolean;
}

/**
 * A preset fails on a Meta error, or when its fetch was fine but the
 * snapshot was not written. A skip (no event code, no ad account, no
 * matching campaigns) and a preset left for the next run are not failures.
 */
export function presetFailed(p: PresetOutcome): boolean {
  if (p.deferred) return false;
  return p.kind === "error" || (p.kind === "ok" && !p.wroteSnapshot);
}

export interface ActiveEventResult {
  eventId: string;
  eventCode?: string | null;
  presetsWritten: number;
  presetResults: readonly PresetOutcome[];
  /** Set when the event threw before or between presets. */
  error?: string;
}

export interface ActiveCreativesRunSummary {
  ok: boolean;
  error: string | null;
  detail: {
    events: number;
    eventsRefreshed: number;
    /** Events the budget never started. Not a failure: stalest-first ordering puts them first next run. */
    eventsNotStarted: number;
    /** Events started but with presets left for the next run. */
    eventsPartial: number;
    eventsSkipped: Record<string, number>;
    eventsFailed: { event: string; error: string }[];
  };
}

export function summariseActiveCreativesRun(
  results: readonly ActiveEventResult[],
  eventsNotStarted: number,
): ActiveCreativesRunSummary {
  const failed: { event: string; error: string }[] = [];
  const skipped: Record<string, number> = {};
  let refreshed = 0;
  let partial = 0;

  for (const r of results) {
    const label = r.eventCode || r.eventId;
    const failures = r.presetResults.filter(presetFailed);
    if (r.error || failures.length > 0) {
      const text = r.error ?? failures.map((p) => `${p.preset}: ${p.error ?? p.kind}`).join(" | ");
      failed.push({ event: label, error: clip(text) });
    }
    if (r.presetsWritten > 0) refreshed += 1;
    if (r.presetResults.some((p) => p.deferred)) partial += 1;
    const skip = r.presetResults.find((p) => p.kind === "skip" && !p.deferred);
    if (skip && r.presetsWritten === 0 && failures.length === 0 && !r.error) {
      const reason = skip.skipReason ?? "skip";
      skipped[reason] = (skipped[reason] ?? 0) + 1;
    }
  }

  const ok = failed.length === 0;
  return {
    ok,
    error: ok
      ? null
      : clip(
          `${failed.length} of ${results.length} events failed: ${failed.map((f) => `${f.event} ${f.error}`).join("; ")}`,
        ),
    detail: {
      events: results.length + eventsNotStarted,
      eventsRefreshed: refreshed,
      eventsNotStarted,
      eventsPartial: partial,
      eventsSkipped: skipped,
      eventsFailed: failed,
    },
  };
}
