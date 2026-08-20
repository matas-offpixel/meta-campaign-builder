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
