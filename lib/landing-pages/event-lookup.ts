import type { LandingPageProvider, PageEventStatus } from "./types.ts";

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
  clientId: string | null;
  clientSlug: string | null;
  eventSlug: string | null;
  hasPage: boolean;
  pageEventId: string | null;
  pageStatus: PageEventStatus | null;
  hasClientConfig: boolean;
  provider: LandingPageProvider | null;
  customHost: string | null;
}

export function assembleEventLandingPageRecord(input: {
  eventId: string | null;
  eventSlug: string | null;
  clientSlug: string | null;
  pageEventId: string | null;
  customHost?: string | null;
  clientId?: string | null;
  pageStatus?: PageEventStatus | null;
  hasClientConfig?: boolean;
  provider?: LandingPageProvider | null;
}): EventLandingPageRecord | null {
  if (!input.eventId) return null;
  return {
    eventId: input.eventId,
    clientId: input.clientId ?? null,
    clientSlug: input.clientSlug,
    eventSlug: input.eventSlug,
    hasPage: input.pageEventId != null,
    pageEventId: input.pageEventId,
    pageStatus: input.pageStatus ?? null,
    hasClientConfig: input.hasClientConfig ?? false,
    provider: input.provider ?? null,
    customHost: input.customHost ?? null,
  };
}
