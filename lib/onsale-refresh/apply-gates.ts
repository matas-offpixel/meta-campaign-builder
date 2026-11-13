/**
 * P2's gates (R4, HR4). Live needs both:
 *   a) ONSALE_REFRESH_APPLY_ENABLED is exactly "1" on the deployment
 *      (default off), and
 *   b) the event is armed Live (onsale_refresh_arms.mode = 'live', default
 *      shadow).
 * Even then nothing applies without Matas's Apply click. Each write also
 * needs its own gate:
 *   - Pause creative: OFFPIXEL_META_AD_STATUS_WRITES_ENABLED = "true"
 *     (lib/meta/ad-status-write.ts);
 *   - Bring back (a stopped ad set) and Drop:
 *     OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED = "true"
 *     (lib/meta/adset-status-write.ts);
 *   - a within-campaign move: ENABLE_OPTIMISATION_WRITES = "1", the
 *     optimisation budget write's own gate (lib/optimisation/gates.ts).
 * Pure: no database, no Meta.
 */

import { adStatusWritesEnabled } from "../meta/ad-status-write.ts";
import { adsetStatusWritesEnabled } from "../meta/adset-status-write.ts";
import { isOptimisationWritesEnabledFromEnv } from "../optimisation/gates.ts";

export { APPLY_KINDS, REJECT_REASONS, appliesNow, isRejectReason, retriesNow, type RejectReason } from "./line-states.ts";

export const APPLY_ENV = "ONSALE_REFRESH_APPLY_ENABLED";

export type ArmMode = "shadow" | "live";

export function applyEnabled(env: Record<string, string | undefined>): boolean {
  return env[APPLY_ENV] === "1";
}

export type ApplyGates = {
  /** The deployment gate. */
  globalEnabled: boolean;
  /** The event's arm. */
  arm: ArmMode;
  /** What the panel and Apply act on: live only when both gates are open. */
  mode: ArmMode;
  /** The ad-status write gate, for Pause creative lines. */
  pauseWritesEnabled: boolean;
  /** The ad-set status write gate, for Bring back and Drop lines. */
  adsetStatusWritesEnabled: boolean;
  /** The optimisation budget write gate, for moves. */
  budgetWritesEnabled: boolean;
};

export function applyGates(env: Record<string, string | undefined>, arm: ArmMode | null | undefined): ApplyGates {
  const globalEnabled = applyEnabled(env);
  const armed: ArmMode = arm === "live" ? "live" : "shadow";
  return { globalEnabled, arm: armed, mode: globalEnabled && armed === "live" ? "live" : "shadow", pauseWritesEnabled: adStatusWritesEnabled(env), adsetStatusWritesEnabled: adsetStatusWritesEnabled(env), budgetWritesEnabled: isOptimisationWritesEnabledFromEnv(env) };
}
