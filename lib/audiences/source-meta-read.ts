import type { AudienceSourceMeta } from "../types/audience.ts";

/**
 * Forward-compatible coercion when reading `source_meta` from JSONB (legacy rows
 * stored `urlContains` as a single string).
 */
export function migrateAudienceSourceMetaRead(
  meta: AudienceSourceMeta | Record<string, unknown>,
): AudienceSourceMeta | Record<string, unknown> {
  if (!meta || typeof meta !== "object") return meta;
  const m = meta as Record<string, unknown>;
  if (m.subtype !== "website_pixel") return meta;
  if (typeof m.urlContains !== "string") return meta;
  return {
    ...m,
    urlContains: m.urlContains ? [m.urlContains] : [],
  };
}
