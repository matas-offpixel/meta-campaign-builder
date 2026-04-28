/**
 * lib/ticketing/registry.ts
 *
 * Lookup table from provider name to provider implementation. Every
 * caller (sync routes, dashboard, cron) goes through `getProvider`
 * rather than importing concrete providers — so flipping in a new
 * provider is a one-line edit here.
 */

import type {
  TicketingProvider,
  TicketingProviderName,
} from "@/lib/ticketing/types";
import { eventbriteProvider } from "@/lib/ticketing/eventbrite/provider";
import { fourthefansProvider } from "@/lib/ticketing/fourthefans/provider";
import { manualProvider } from "@/lib/ticketing/manual/provider";

const providers: Record<TicketingProviderName, TicketingProvider> = {
  eventbrite: eventbriteProvider,
  fourthefans: fourthefansProvider,
  // PR 3: 4theFans-internal uses the same null-provider semantics as
  // `manual` until the upstream API ships (at which point we swap in
  // the real adapter). Aliasing here means the rest of the stack
  // picks up 'foursomething_internal' with no other code changes.
  foursomething_internal: manualProvider,
  manual: manualProvider,
};

export function getProvider(name: TicketingProviderName): TicketingProvider {
  const provider = providers[name];
  if (!provider) {
    // The DB check constraint matches the union, so this is unreachable
    // unless the schema and the union have drifted. Surface it loudly.
    throw new Error(`Unknown ticketing provider: ${name}`);
  }
  return provider;
}

export function listProviderNames(): TicketingProviderName[] {
  return Object.keys(providers) as TicketingProviderName[];
}
