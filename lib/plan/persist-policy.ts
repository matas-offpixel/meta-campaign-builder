/**
 * A plan row is created on the first operator edit (or Prepare), never
 * by navigating to /plan/new. Visiting the page with a default event
 * selected must not persist a stray "Untitled plan".
 *
 * System-derived defaults (platform selection from an all-zero budget,
 * Daily mode, split presets, lifetime re-split) are not operator edits.
 */
export type PlanEditSource =
  | "operator"
  | "derived-lifetime"
  | "derived-selection"
  | "derived-budget-mode"
  | "derived-split";

export function shouldMarkUserEdit(source: PlanEditSource): boolean {
  return source === "operator";
}

export function shouldPersistPlanOnChange(input: {
  hasUserEdit: boolean;
  eventId: string | null | undefined;
}): boolean {
  return input.hasUserEdit === true && Boolean(input.eventId?.trim());
}

/** Visiting /plan/new and leaving without an operator edit must not write. */
export function newPlanVisitPersists(input: {
  eventId: string | null | undefined;
  sources: readonly PlanEditSource[];
}): boolean {
  const hasUserEdit = input.sources.some(shouldMarkUserEdit);
  return shouldPersistPlanOnChange({ hasUserEdit, eventId: input.eventId });
}
