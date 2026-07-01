/**
 * lib/d2c/mailchimp/templates/definitions/index.ts
 *
 * Brand registry for Mailchimp templates. Add a new brand by exporting a
 * MailchimpBrandConfig and registering it here.
 */

import type { MailchimpBrandConfig } from "../types.ts";
import { jackiesMailchimpConfig } from "./jackies.ts";
import { throwbackMailchimpConfig } from "./throwback.ts";

const REGISTRY: Record<string, MailchimpBrandConfig> = {
  jackies: jackiesMailchimpConfig,
  throwback: throwbackMailchimpConfig,
};

export function getMailchimpBrandConfig(brand: string): MailchimpBrandConfig {
  const cfg = REGISTRY[brand.trim().toLowerCase()];
  if (!cfg) {
    const known = Object.keys(REGISTRY).join(", ");
    throw new Error(`Unknown Mailchimp brand "${brand}". Known brands: ${known}`);
  }
  return cfg;
}

export function listMailchimpBrands(): string[] {
  return Object.keys(REGISTRY);
}
