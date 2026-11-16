/**
 * lib/dashboard/objective-budget/compute.ts
 *
 * HE6's figures for one scope (a show, or the whole client) and one
 * period. Pure: `ObjectiveBudgetInput` in, `ObjectiveBudgetResult` out.
 *
 * The objective rows run over [from, to]. The budget runs since launch to
 * `to`, because a plan isn't per period. Brand campaigns stay in a client
 * scope, and their spend is returned on its own (`brand`, `paidBrand`).
 *
 * Relative imports only (node --test).
 */

import { budgetPicture } from "./budget.ts";
import { objectiveRows } from "./objectives.ts";
import { paidDays, paidTotals } from "./paid.ts";
import type { ObjectiveBudgetInput, ObjectiveBudgetResult, Period } from "./types.ts";

export type Scope = { kind: "client" } | { kind: "show"; eventId: string };

export function computeObjectiveBudget(input: ObjectiveBudgetInput, scope: Scope, period: Period): ObjectiveBudgetResult {
  const eventIds =
    scope.kind === "client" ? new Set(input.events.map((e) => e.eventId)) : new Set(input.events.some((e) => e.eventId === scope.eventId) ? [scope.eventId] : []);
  const paid = paidDays(input, period.to);
  const show = scope.kind === "show" ? input.events.find((e) => e.eventId === scope.eventId) : null;
  const brandIds = new Set(input.events.filter((e) => e.kind === "brand_campaign" && eventIds.has(e.eventId)).map((e) => e.eventId));
  const { rows, metaClassification } = objectiveRows(input, paid, eventIds, period.from, period.to);
  return {
    scope: {
      kind: scope.kind,
      eventIds: [...eventIds],
      label: show ? show.name : `${input.client.name} · all shows and brand campaigns`,
    },
    period,
    rows,
    paidInPeriod: paidTotals(paid, eventIds, period.from, period.to),
    brand: { eventIds: [...brandIds], paidInPeriod: paidTotals(paid, brandIds, period.from, period.to) },
    metaClassification,
    budget: budgetPicture(
      input,
      scope.kind,
      eventIds,
      period.to,
      paidTotals(paid, eventIds, null, period.to),
      paidTotals(paid, brandIds, null, period.to).all,
    ),
  };
}
