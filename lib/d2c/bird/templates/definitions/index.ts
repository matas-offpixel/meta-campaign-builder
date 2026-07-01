/**
 * lib/d2c/bird/templates/definitions/index.ts
 *
 * Brand registry: maps a brand key → its template definitions + Bird routing
 * (master project + WABA channel group). To add a brand, create a definitions
 * file and add an entry here. Project/channelGroup can be omitted to have the
 * CLI resolve/create a `{brand}_master` project and read its WABA.
 */

import type { BrandTemplateDefinition } from "../types.ts";
import { throwbackTemplates } from "./throwback.ts";
import { jackiesTemplates } from "./jackies.ts";

export interface BrandConfig {
  key: string;
  /** Existing Bird master project id. If omitted the CLI finds/creates one. */
  projectId?: string;
  /** WABA channel group id. If omitted the CLI resolves it from the project. */
  channelGroupId?: string;
  templates: BrandTemplateDefinition[];
}

export const BRANDS: Record<string, BrandConfig> = {
  throwback: {
    key: "throwback",
    // "throwback_template-presale-live" master (proven via Porto media URL).
    projectId: "08bab722-597a-41dd-b415-aa256d78325f",
    // Throwback WABA — discovered from the live approved template's channelGroupIds.
    channelGroupId: "6ae0be5c-2d1e-4b8b-ab6e-4362e60354a6",
    templates: throwbackTemplates,
  },
  jackies: {
    key: "jackies",
    // No dedicated master project yet — CLI will find/create `jackies_master`.
    channelGroupId: "5023d43f-5d40-494b-b024-1fad53e8338a",
    templates: jackiesTemplates,
  },
};

export function getBrandConfig(brand: string): BrandConfig {
  const cfg = BRANDS[brand.trim().toLowerCase()];
  if (!cfg) {
    throw new Error(
      `Unknown brand "${brand}". Known brands: ${Object.keys(BRANDS).join(", ")}.`,
    );
  }
  return cfg;
}

export { throwbackTemplates, jackiesTemplates };
