/**
 * Meta launch entity status.
 *
 * Wizard default is ACTIVE (spend starts immediately — 2026-06-04 product
 * decision, pinned by launch-active-by-default.test.ts). Plan fan-out
 * (Phase D) passes createPaused so every new campaign / ad set / ad is
 * created PAUSED. Attach-to-existing-live-campaign never uses this helper
 * for the already-live parent — only newly created children.
 */

export type MetaLaunchEntityStatus = "ACTIVE" | "PAUSED";

export function resolveMetaLaunchEntityStatus(opts?: {
  createPaused?: boolean;
}): MetaLaunchEntityStatus {
  return opts?.createPaused === true ? "PAUSED" : "ACTIVE";
}
