/**
 * P2's gates (R4, HR4). Live needs both:
 *   a) ONSALE_REFRESH_APPLY_ENABLED is exactly "1" on the deployment
 *      (default off), and
 *   b) the event is armed Live (onsale_refresh_arms.mode = 'live', default
 *      shadow).
 * Even then nothing applies without Matas's Apply click. A Pause creative
 * line also needs OFFPIXEL_META_AD_STATUS_WRITES_ENABLED = "true"
 * (lib/meta/ad-status-write.ts). Pure: no database, no Meta.
 */

import { adStatusWritesEnabled } from "../meta/ad-status-write.ts";

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
};

export function applyGates(env: Record<string, string | undefined>, arm: ArmMode | null | undefined): ApplyGates {
  const globalEnabled = applyEnabled(env);
  const armed: ArmMode = arm === "live" ? "live" : "shadow";
  return { globalEnabled, arm: armed, mode: globalEnabled && armed === "live" ? "live" : "shadow", pauseWritesEnabled: adStatusWritesEnabled(env) };
}
