/**
 * lib/optimisation/gates.ts
 *
 * Three-of-three live-write gate for task #120 PR B, mirroring
 * `d2cDryRunGates` / `shouldD2CDryRun` in `lib/d2c/types.ts`.
 *
 * A Meta budget write happens only when ALL of:
 *   a) env ENABLE_OPTIMISATION_WRITES === "1"
 *   b) campaign_drafts.optimisation_automation_enabled = true
 *   c) campaign_drafts.optimisation_automation_live = true
 *
 * Anything less → dry-run (insert decision, dry_run=true, applied=false),
 * exactly as PR A does today.
 *
 * A Meta pause write (status=PAUSED) needs those three AND a fourth:
 *   d) env ENABLE_OPTIMISATION_PAUSE_WRITES === "1"
 *
 * The fourth gate is checked in addition to the three — never instead of
 * them, and never folded into `optimisationDryRunGates`. Closing (d)
 * leaves budget writes armed and restores today's pause behaviour
 * (shadow row + ads_urgent Slack). Shipping (d) unset is the point.
 *
 * Pure — no `@/` imports, no env reads inside the helper. Callers pass the
 * already-resolved booleans so the 8-row truth table is unit-testable.
 */

export type OptimisationDryRunReason =
  | "writes_killswitch"
  | "not_enabled"
  | "not_live";

export interface OptimisationDryRunGates {
  dryRun: boolean;
  reason: OptimisationDryRunReason | null;
}

/**
 * @param writesEnabled  `ENABLE_OPTIMISATION_WRITES === "1"`
 * @param enabled        `campaign_drafts.optimisation_automation_enabled`
 * @param live           `campaign_drafts.optimisation_automation_live`
 */
export function optimisationDryRunGates(
  writesEnabled: boolean,
  enabled: boolean,
  live: boolean,
): OptimisationDryRunGates {
  if (!writesEnabled) {
    return { dryRun: true, reason: "writes_killswitch" };
  }
  if (!enabled) {
    return { dryRun: true, reason: "not_enabled" };
  }
  if (!live) {
    return { dryRun: true, reason: "not_live" };
  }
  return { dryRun: false, reason: null };
}

export function shouldOptimisationDryRun(
  writesEnabled: boolean,
  enabled: boolean,
  live: boolean,
): boolean {
  return optimisationDryRunGates(writesEnabled, enabled, live).dryRun;
}

/** Env reader used by the cron route — exact `"1"` match, same as ENABLE_OPTIMISATION_AUTOMATION. */
export function isOptimisationWritesEnabledFromEnv(
    env: Record<string, string | undefined> = process.env,
  ): boolean {
    return env.ENABLE_OPTIMISATION_WRITES === "1";
  }

/**
 * Fourth gate — exact `"1"`, same discipline as
 * {@link isOptimisationWritesEnabledFromEnv}. Does not change budget-write
 * dry-run. Unset (the default) keeps pause recommend-only.
 */
export function isOptimisationPauseWritesEnabledFromEnv(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ENABLE_OPTIMISATION_PAUSE_WRITES === "1";
}

export type OptimisationPauseDryRunReason =
  | OptimisationDryRunReason
  | "pause_writes_killswitch";

export interface OptimisationPauseDryRunGates {
  dryRun: boolean;
  reason: OptimisationPauseDryRunReason | null;
}

/**
 * Pause-write gate: the three budget-write gates plus
 * `ENABLE_OPTIMISATION_PAUSE_WRITES === "1"`. First closed gate wins, so
 * a campaign that is not live still reports `not_live`, not
 * `pause_writes_killswitch`.
 */
export function optimisationPauseDryRunGates(
  writesEnabled: boolean,
  enabled: boolean,
  live: boolean,
  pauseWritesEnabled: boolean,
): OptimisationPauseDryRunGates {
  const base = optimisationDryRunGates(writesEnabled, enabled, live);
  if (base.dryRun) {
    return base;
  }
  if (!pauseWritesEnabled) {
    return { dryRun: true, reason: "pause_writes_killswitch" };
  }
  return { dryRun: false, reason: null };
}

/** Plan-fan-out-shaped probe for the writes killswitch. Does not change the gate. */
export function optimisationWritesGateState(
  env: Record<string, string | undefined> = process.env,
): { writesEnabled: boolean; skippedReason: "killswitch" | null } {
  const writesEnabled = isOptimisationWritesEnabledFromEnv(env);
  return {
    writesEnabled,
    skippedReason: writesEnabled ? null : "killswitch",
  };
}
