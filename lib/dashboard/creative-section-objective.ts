/**
 * Signup vs purchase for one ad-day, from the same Meta objective reading
 * the launch snapshot uses. Presale (registration, leads) is a signup
 * campaign. A purchase or initiate-checkout promoted event is a purchase
 * campaign. Traffic, awareness and a sales campaign whose event is not
 * known yet are neither, so their results stay out of both columns.
 */

import { phaseFromMetaObjective } from "../launched-ad-sets/snapshot.ts";

import type { CreativeObjective } from "./creative-section.ts";

export function creativeObjective(input: {
  campaignObjective: string | null | undefined;
  optimizationGoal: string | null | undefined;
  promotedEvent: string | null | undefined;
}): CreativeObjective | null {
  const phase = phaseFromMetaObjective({
    campaignObjective: input.campaignObjective,
    optimizationGoal: input.optimizationGoal,
    promotedEvent: input.promotedEvent,
  });
  if (phase === "presale") return "signup";
  const event = (input.promotedEvent ?? "").trim().toUpperCase();
  if (event === "PURCHASE" || event === "INITIATED_CHECKOUT") return "purchase";
  return null;
}
