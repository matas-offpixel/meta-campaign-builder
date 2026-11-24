/**
 * The stage result of one ad-day, for pairs and phase curves: the same
 * `resultsOf` RP1's observed tests read (approve.ts), on the ad set's own stage.
 *
 *   registration  Complete Registration (the registrations column)
 *   ticket_sale   Initiate Checkout when the ad set optimises for it, else purchases
 *   unknown       none
 *
 * The stage is what Meta says the ad set is for (`stageOfTest`, joins.ts's
 * meta_objective rung). joins.ts's stageOf is not changed. Pure.
 */

import { resultsOf } from "../../creative-tests/approve.ts";
import { stageOfTest, type ObservedAdDay } from "./observed-tests.ts";

export type FindingStage = "registration" | "ticket_sale" | "unknown";

/** What a stage's result is called in a finding's metric: cost_per_{result}. */
export type StageResultKind = "complete_registration" | "initiate_checkout" | "purchase";

export type StageDay = Pick<ObservedAdDay, "date" | "spend" | "landing_page_views" | "registrations" | "actions" | "promoted_event" | "optimization_goal" | "campaign_objective"> & { purchases?: number | string | null };

export function stageResultKind(day: Pick<StageDay, "promoted_event" | "optimization_goal" | "campaign_objective">): { stage: FindingStage; result: StageResultKind | null } {
  const stage = stageOfTest(day);
  if (stage === "registration") return { stage, result: "complete_registration" };
  if (stage === "ticket_sale") return { stage, result: (day.promoted_event ?? "").trim().toUpperCase() === "INITIATED_CHECKOUT" ? "initiate_checkout" : "purchase" };
  return { stage, result: null };
}

export function stageResult(day: StageDay, result: StageResultKind): number {
  if (result === "purchase") return Number(day.purchases) || 0;
  return resultsOf(day, result);
}

export const RESULT_WORDS: Readonly<Record<StageResultKind, string>> = {
  complete_registration: "signup",
  initiate_checkout: "checkout",
  purchase: "purchase",
};
