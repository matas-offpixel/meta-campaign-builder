/**
 * lib/d2c/fire-type.ts
 *
 * Pure utilities for the "fire type" concept introduced by PR #657 broadcast
 * pivot: distinguishes how Approving a scheduled send actually behaves.
 *
 * DRAFT_REVIEW jobs (announce, reminder, presale_live, gen_sale):
 *   Approve → creates a Bird DRAFT campaign. No message leaves the door.
 *   Matas schedules manually from Bird UI.
 *
 * DIRECT_FIRE jobs (autoresp_setup, community_early):
 *   Approve → IMMEDIATELY fires Bird broadcasts to real recipients.
 *   No further intervention. High-consequence action.
 */

import type { D2CJobType } from "./types";

export type FireType = "draft_review" | "direct_fire";

/** Jobs that create a Bird draft campaign for review — no immediate send. */
export const DRAFT_REVIEW_JOB_TYPES = new Set<D2CJobType>([
  "announce",
  "reminder",
  "presale_live",
  "gen_sale",
]);

/** Jobs that immediately send to real recipients on approval. */
export const DIRECT_FIRE_JOB_TYPES = new Set<D2CJobType>([
  "autoresp_setup",
  "community_early",
]);

export function getFireType(jobType: D2CJobType | null | undefined): FireType {
  if (jobType && DIRECT_FIRE_JOB_TYPES.has(jobType)) return "direct_fire";
  return "draft_review";
}

export function isDirectFire(jobType: D2CJobType | null | undefined): boolean {
  return getFireType(jobType) === "direct_fire";
}

/**
 * Returns true when any send in the batch is a direct-fire job.
 * Used to block the approve-all shortcut — those sends need individual review.
 */
export function batchContainsDirectFire(
  sends: ReadonlyArray<{ job_type: D2CJobType | null }>,
): boolean {
  return sends.some((s) => isDirectFire(s.job_type));
}

/** Human label for use in badges. */
export const FIRE_TYPE_LABEL: Record<FireType, string> = {
  draft_review: "DRAFT REVIEW",
  direct_fire: "SENDS NOW",
};

export const FIRE_TYPE_BADGE_CLASS: Record<FireType, string> = {
  draft_review: "bg-slate-100 text-slate-600",
  direct_fire: "bg-amber-100 text-amber-800 font-semibold",
};
