/**
 * lib/dashboard/objective-budget/compute.ts
 *
 * HE6's figures for one scope (a show, or the whole client) and one
 * period. Pure: `ObjectiveBudgetInput` in, `ObjectiveBudgetResult` out.
 *
 * The objective rows run over [from, to]. The budget runs since launch to
 * `to`, because a plan isn't per period.
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
  return {
    scope: {
      kind: scope.kind,
      eventIds: [...eventIds],
      label: show ? show.name : `${input.client.name} · all shows and brand campaigns`,
    },
    period,
    rows: objectiveRows(input, paid, eventIds, period.from, period.to),
    paidInPeriod: paidTotals(paid, eventIds, period.from, period.to),
    budget: budgetPicture(input, scope.kind, eventIds, period.to, paidTotals(paid, eventIds, null, period.to)),
  };
}
