/**
 * Read-across view of `ad_plans` from the canvas.
 *
 * `ad_plans` owns the money, the day grid and the ticket target.
 * `campaign_plans` owns the launch. This module never writes `ad_plans`
 * and never subtracts the target from the paid-media projection.
 */

import { formatGbp } from "./launch-face.ts";
import { scheduledDayCount } from "./budget-split.ts";
import {
  phaseWindowTotal,
  reconcileCampaignPlanPhases,
} from "./phase-reconcile.ts";
import type { CampaignPlanPhase } from "./phase.ts";
import type { VizLineKind } from "../viz/tokens.ts";

export const NO_CAMPAIGN_BUDGET_YET =
  "no campaign budget yet — set one on the event's Plan tab ▸";

export const NO_TICKET_TARGET_YET =
  "no ticket target yet — set one on the event's Plan tab ▸";

export const NEW_PLAN_NEEDS_PHASE = "a new plan needs a phase";

export type AdPlanReadRow = {
  eventId: string;
  totalBudget: number | null;
  startDate: string;
  endDate: string;
  ticketTarget: number | null;
};

export type CampaignPlanSibling = {
  id: string;
  eventId: string;
  phase: CampaignPlanPhase | null;
  totalDailyBudget: number;
  startDate: string | null;
  endDate: string | null;
};

export function eventPlanTabHref(eventId: string): string {
  return `/events/${eventId}?tab=plan`;
}

export function phaseWord(phase: CampaignPlanPhase): string {
  if (phase === "on_sale") return "on-sale";
  if (phase === "waiting_list") return "waiting-list";
  return "presale";
}

export function existingPhaseOffer(phase: CampaignPlanPhase): string {
  const article = phase === "on_sale" ? "an" : "a";
  return `this show already has ${article} ${phaseWord(phase)} plan — open it ▸`;
}

export function findExistingPhasePlan(
  siblings: readonly CampaignPlanSibling[],
  eventId: string,
  phase: CampaignPlanPhase | null | undefined,
  excludeId?: string,
): { id: string; phase: CampaignPlanPhase } | null {
  if (!eventId || !phase) return null;
  const hit = siblings.find(
    (row) =>
      row.eventId === eventId &&
      row.phase === phase &&
      row.id !== excludeId,
  );
  return hit ? { id: hit.id, phase } : null;
}

export type CampaignBudgetLine =
  | {
      kind: "measured";
      amount: number;
      days: number | null;
      text: string;
    }
  | {
      kind: "not-yet";
      sentence: string;
      href: string;
    };

export type CampaignBudgetLines = {
  campaign: CampaignBudgetLine;
  thisPhase: {
    kind: "measured" | "not-yet";
    amount: number | null;
    days: number | null;
    text: string;
  };
  unallocated: { amount: number; text: string } | null;
};

function acrossDays(amount: number, days: number | null): string {
  if (days == null) return formatGbp(amount);
  return `${formatGbp(amount)} across ${days} ${days === 1 ? "day" : "days"}`;
}

export function campaignBudgetLines(input: {
  eventId: string;
  adPlan: AdPlanReadRow | null;
  thisPhase: {
    totalDailyBudget: number;
    startDate: string | null;
    endDate: string | null;
  };
  siblingPhases: ReadonlyArray<{
    totalDailyBudget: number;
    startDate: string | null;
    endDate: string | null;
  }>;
}): CampaignBudgetLines {
  const phaseDays = scheduledDayCount(
    input.thisPhase.startDate,
    input.thisPhase.endDate,
  );
  const phaseTotal = phaseWindowTotal(
    input.thisPhase.totalDailyBudget,
    input.thisPhase.startDate,
    input.thisPhase.endDate,
  );
  const thisPhase =
    phaseTotal == null
      ? {
          kind: "not-yet" as const,
          amount: null,
          days: phaseDays,
          text: "this phase — set start and end",
        }
      : {
          kind: "measured" as const,
          amount: phaseTotal,
          days: phaseDays,
          text: `this phase ${acrossDays(phaseTotal, phaseDays)}`,
        };

  if (input.adPlan == null || input.adPlan.totalBudget == null) {
    return {
      campaign: {
        kind: "not-yet",
        sentence: NO_CAMPAIGN_BUDGET_YET,
        href: eventPlanTabHref(input.eventId),
      },
      thisPhase,
      unallocated: null,
    };
  }

  const campaignDays = scheduledDayCount(
    input.adPlan.startDate,
    input.adPlan.endDate,
  );
  const campaignTotal = input.adPlan.totalBudget;
  const reconciled = reconcileCampaignPlanPhases({
    campaignTotal,
    phases: [...input.siblingPhases, input.thisPhase],
  });

  return {
    campaign: {
      kind: "measured",
      amount: campaignTotal,
      days: campaignDays,
      text: `campaign ${acrossDays(campaignTotal, campaignDays)}`,
    },
    thisPhase,
    unallocated: {
      amount: reconciled.unallocated,
      text: `${formatGbp(reconciled.unallocated)} unallocated`,
    },
  };
}

export type CampaignTicketTargetLine = {
  kind: VizLineKind;
  value: number | null;
  display: string;
  sentence: string | null;
  href: string | null;
};

export function campaignTicketTargetLine(input: {
  eventId: string;
  ticketTarget: number | null;
}): CampaignTicketTargetLine {
  if (input.ticketTarget == null) {
    return {
      kind: "not-yet",
      value: null,
      display: "—",
      sentence: NO_TICKET_TARGET_YET,
      href: eventPlanTabHref(input.eventId),
    };
  }
  return {
    kind: "measured",
    value: input.ticketTarget,
    display: `${input.ticketTarget} tickets`,
    sentence: null,
    href: null,
  };
}

export function adPlanForEvent(
  rows: readonly AdPlanReadRow[],
  eventId: string | null | undefined,
): AdPlanReadRow | null {
  if (!eventId) return null;
  return rows.find((row) => row.eventId === eventId) ?? null;
}
