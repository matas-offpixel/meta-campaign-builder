/**
 * Pre-evaluate eligibility for the optimisation tick.
 *
 * `campaign_drafts.status = published` means we once launched the draft.
 * It does not mean the Meta object is delivering, the window is open, or
 * the event is still ahead. These gates run before `evaluate()` and write
 * a named skip so the audit says which one fired.
 *
 * Missing facts fail open — a campaign that is still delivering and
 * in-window must stay eligible. Do not infer ad-set delivery from the
 * campaign (`project_creator_meta_effective_status_doesnt_rollup`).
 */

import {
  isCampaignPlanPhase,
  utcCalendarDate,
  type CampaignPlanPhase,
} from "../plan/phase.ts";
export const ELIGIBILITY_SKIP_ACTIONS = [
  "skip_not_delivering",
  "skip_campaign_ended",
  "skip_event_passed",
  "skip_phase_ended",
] as const;

export type EligibilitySkipAction = (typeof ELIGIBILITY_SKIP_ACTIONS)[number];

/** Meta statuses that are actually delivering. Everything else is a skip. */
const DELIVERING_STATUSES = new Set(["ACTIVE"]);

export interface CampaignEligibilityFacts {
  campaignEndAt?: string | null;
  planEndDate?: string | null;
  eventDate?: string | null;
  planPhase?: CampaignPlanPhase | null;
  generalSaleAt?: string | null;
}

export interface EligibilityInput extends CampaignEligibilityFacts {
  now: Date;
  /**
   * `effective_status` at the grain we would write to — ad set for ABO,
   * campaign for CBO. Null = unknown; fail open.
   */
  effectiveStatus?: string | null;
  subjectNoun?: "ad set" | "campaign";
}

export interface EligibilitySkip {
  action: EligibilitySkipAction;
  reason: string;
}

export function isEligibilitySkipAction(
  action: string,
): action is EligibilitySkipAction {
  return (ELIGIBILITY_SKIP_ACTIONS as readonly string[]).includes(action);
}

export function isDeliveringEffectiveStatus(
  status: string | null | undefined,
): boolean {
  if (status == null || status.trim() === "") return true;
  return DELIVERING_STATUSES.has(status.trim().toUpperCase());
}

/** Instant-or-date is past `now`. Date-only values compare as UTC calendar days. */
export function instantIsPast(
  raw: string | null | undefined,
  now: Date,
): boolean {
  if (!raw?.trim()) return false;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const today = now.toISOString().slice(0, 10);
    return trimmed < today;
  }
  const ms = Date.parse(trimmed);
  if (!Number.isFinite(ms)) return false;
  return ms < now.getTime();
}

export function eventDateHasPassed(
  eventDate: string | null | undefined,
  now: Date,
): boolean {
  const day = eventDate?.trim().slice(0, 10) ?? utcCalendarDate(eventDate);
  if (!day) return false;
  const today = now.toISOString().slice(0, 10);
  return day < today;
}

/**
 * Presale plan after general sale has started. Only when the stored
 * `campaign_plans.phase` is explicitly `presale` — we do not derive a
 * phase from sale dates (that boundary is still open).
 */
export function presalePhaseHasEnded(
  planPhase: CampaignPlanPhase | string | null | undefined,
  generalSaleAt: string | null | undefined,
  now: Date,
): boolean {
  if (!isCampaignPlanPhase(planPhase) || planPhase !== "presale") return false;
  return instantIsPast(generalSaleAt, now);
}

export function evaluateEligibility(input: EligibilityInput): EligibilitySkip | null {
  const noun = input.subjectNoun ?? "ad set";

  if (!isDeliveringEffectiveStatus(input.effectiveStatus)) {
    return {
      action: "skip_not_delivering",
      reason: `${noun} effective_status=${input.effectiveStatus} — not delivering, no write.`,
    };
  }

  const campaignEnded =
    instantIsPast(input.campaignEndAt, input.now) ||
    instantIsPast(input.planEndDate, input.now);
  if (campaignEnded) {
    const which = instantIsPast(input.campaignEndAt, input.now)
      ? `campaign_end_at=${input.campaignEndAt}`
      : `plan end_date=${input.planEndDate}`;
    return {
      action: "skip_campaign_ended",
      reason: `Campaign window has ended (${which}) — skip_campaign_ended.`,
    };
  }

  if (eventDateHasPassed(input.eventDate, input.now)) {
    return {
      action: "skip_event_passed",
      reason: `Event date ${input.eventDate?.slice(0, 10)} is in the past — skip_event_passed.`,
    };
  }

  if (presalePhaseHasEnded(input.planPhase, input.generalSaleAt, input.now)) {
    return {
      action: "skip_phase_ended",
      reason: `Plan phase is presale and general sale started ${input.generalSaleAt} — skip_phase_ended.`,
    };
  }

  return null;
}
