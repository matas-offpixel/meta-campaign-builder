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

const providers: Record<TicketingProviderName, TicketingProvider> = {
  eventbrite: eventbriteProvider,
  fourthefans: fourthefansProvider,
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
