/**
 * lib/d2c/registry.ts
 *
 * Lookup table from D2C provider name to implementation. Same shape
 * as `lib/ticketing/registry.ts`. Callers always go through
 * `getProvider` rather than importing concrete providers — flipping
 * in a new provider is a one-line edit here.
 */

import type { D2CProvider, D2CProviderName } from "@/lib/d2c/types";
import { mailchimpProvider } from "@/lib/d2c/mailchimp/provider";
import { klaviyoProvider } from "@/lib/d2c/klaviyo/provider";
import { birdProvider } from "@/lib/d2c/bird/provider";
import { firetextProvider } from "@/lib/d2c/firetext/provider";

const providers: Record<D2CProviderName, D2CProvider> = {
  mailchimp: mailchimpProvider,
  klaviyo: klaviyoProvider,
  bird: birdProvider,
  firetext: firetextProvider,
};

export function getD2CProvider(name: D2CProviderName): D2CProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown D2C provider: ${name}`);
  }
  return provider;
}

export function listD2CProviderNames(): D2CProviderName[] {
  return Object.keys(providers) as D2CProviderName[];
}
