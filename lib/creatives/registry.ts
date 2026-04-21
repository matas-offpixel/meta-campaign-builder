/**
 * lib/creatives/registry.ts
 *
 * Lookup from CreativeProviderName → implementation. Same pattern as
 * the ticketing + d2c registries.
 */

import type {
  CreativeProvider,
  CreativeProviderName,
} from "@/lib/creatives/types";
import { canvaProvider } from "@/lib/creatives/canva/provider";
import { bannerbearProvider } from "@/lib/creatives/bannerbear/provider";
import { placidProvider } from "@/lib/creatives/placid/provider";
import { manualProvider } from "@/lib/creatives/manual/provider";

const providers: Record<CreativeProviderName, CreativeProvider> = {
  canva: canvaProvider,
  bannerbear: bannerbearProvider,
  placid: placidProvider,
  manual: manualProvider,
};

export function getCreativeProvider(
  name: CreativeProviderName,
): CreativeProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown creative provider: ${name}`);
  }
  return provider;
}

export function listCreativeProviderNames(): CreativeProviderName[] {
  return Object.keys(providers) as CreativeProviderName[];
}
