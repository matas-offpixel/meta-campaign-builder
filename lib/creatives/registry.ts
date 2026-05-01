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
import { getBannerbearProvider } from "@/lib/creatives/bannerbear/provider";
import { placidProvider } from "@/lib/creatives/placid/provider";
import { manualProvider } from "@/lib/creatives/manual/provider";

const providers: Record<
  Exclude<CreativeProviderName, "bannerbear">,
  CreativeProvider
> = {
  canva: canvaProvider,
  placid: placidProvider,
  manual: manualProvider,
};

const ALL_NAMES: CreativeProviderName[] = [
  "canva",
  "bannerbear",
  "placid",
  "manual",
];

export function getCreativeProvider(
  name: CreativeProviderName,
): CreativeProvider {
  if (name === "bannerbear") {
    return getBannerbearProvider();
  }
  const provider =
    providers[name as Exclude<CreativeProviderName, "bannerbear">];
  if (!provider) {
    throw new Error(`Unknown creative provider: ${name}`);
  }
  return provider;
}

export function listCreativeProviderNames(): CreativeProviderName[] {
  return [...ALL_NAMES];
}
