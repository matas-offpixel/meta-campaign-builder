/**
 * A plan row is created on the first operator edit (or Prepare), never
 * by navigating to /plan/new. Visiting the page with a default event
 * selected must not persist a stray "Untitled plan".
 */
export function shouldPersistPlanOnChange(input: {
  hasUserEdit: boolean;
  eventId: string | null | undefined;
}): boolean {
  return input.hasUserEdit === true && Boolean(input.eventId?.trim());
}
