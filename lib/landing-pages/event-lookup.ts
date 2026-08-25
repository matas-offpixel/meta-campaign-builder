/**
 * lib/landing-pages/event-lookup.ts
 *
 * Event-id → LP lookup shape. No wizard-facing helper existed; public
 * resolution is slug-chain only (`getLandingPageContext`). This assembles
 * the record the canonical-URL resolver needs from a joined event row.
 *
 * `customHost` is always null in this repo today — there is no
 * `custom_domains` table. Pass a host only when one is explicitly
 * configured; never invent www.
 */

export interface EventLandingPageRecord {
  eventId: string;
  clientSlug: string | null;
  eventSlug: string | null;
  hasPage: boolean;
  pageEventId: string | null;
  customHost: string | null;
}

export function assembleEventLandingPageRecord(input: {
  eventId: string | null;
  eventSlug: string | null;
  clientSlug: string | null;
  pageEventId: string | null;
  customHost?: string | null;
}): EventLandingPageRecord | null {
  if (!input.eventId) return null;
  return {
    eventId: input.eventId,
    clientSlug: input.clientSlug,
    eventSlug: input.eventSlug,
    hasPage: input.pageEventId != null,
    pageEventId: input.pageEventId,
    customHost: input.customHost ?? null,
  };
}
