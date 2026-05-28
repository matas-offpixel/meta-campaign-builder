/**
 * Batch dedupe for venue-spend-allocator invocations inside multi-event
 * rollup loops (cron, force backfill). The allocator is event_code-scoped
 * and writes all sibling fixtures in one pass — repeating it per fixture
 * duplicates Meta ad-level fetches and can platform-kill the lambda.
 */

export const VENUE_ALLOCATOR_ALREADY_RAN = "already_ran_this_batch" as const;

export function venueAllocatorDedupeKey(
  clientId: string,
  eventCode: string,
): string {
  return `${clientId}\u0000${eventCode}`;
}

export function shouldSkipVenueAllocatorBatch(
  clientId: string | null | undefined,
  eventCode: string | null | undefined,
  completedKeys: Set<string> | undefined,
): boolean {
  if (!completedKeys || !clientId || !eventCode) return false;
  return completedKeys.has(venueAllocatorDedupeKey(clientId, eventCode));
}

export function markVenueAllocatorBatchComplete(
  clientId: string | null | undefined,
  eventCode: string | null | undefined,
  completedKeys: Set<string> | undefined,
  allocatorOk: boolean,
): void {
  if (!completedKeys || !clientId || !eventCode || !allocatorOk) return;
  completedKeys.add(venueAllocatorDedupeKey(clientId, eventCode));
}
