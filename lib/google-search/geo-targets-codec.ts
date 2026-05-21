/**
 * lib/google-search/geo-targets-codec.ts
 *
 * Round-trips the in-memory `(geo_targets[], geo_target_type)` pair to
 * the on-disk `google_search_plans.geo_targets jsonb` column WITHOUT a
 * migration.
 *
 * Wire shapes (the column accepts either):
 *
 *   - Legacy (pre-Phase-5): `[{ location, bid_modifier_pct? }, ...]`
 *     → parsed as `{ targets: <those>, geo_target_type: "PRESENCE" }`.
 *   - Phase 5: `{ targets: [...], geo_target_type: "PRESENCE" | "PRESENCE_OR_INTEREST" }`
 *
 * Writers always emit the Phase-5 wrapping object so re-saves
 * upgrade legacy rows in place. Readers handle both shapes.
 *
 * Why no migration: per PR #449 spec the geo-target-type setting goes
 * in the existing jsonb column. A typed column would be cleaner but
 * is out of scope for this PR.
 */

import {
  DEFAULT_GEO_TARGET_TYPE,
  GEO_TARGET_TYPES,
  type GoogleSearchGeoTarget,
  type GoogleSearchGeoTargetType,
} from "./types.ts";

export interface DecodedGeoTargetsColumn {
  targets: GoogleSearchGeoTarget[];
  geo_target_type: GoogleSearchGeoTargetType;
}

/**
 * Coerce the raw value of `google_search_plans.geo_targets` into the
 * in-memory pair. Returns the defaults for `null`/`undefined`/garbage
 * so the wizard never blows up on a malformed jsonb cell.
 */
export function parseGeoTargetsColumn(raw: unknown): DecodedGeoTargetsColumn {
  // Legacy array shape: pre-Phase-5 plans persist a plain array.
  if (Array.isArray(raw)) {
    return {
      targets: normaliseTargets(raw),
      geo_target_type: DEFAULT_GEO_TARGET_TYPE,
    };
  }
  // Phase-5 wrapping object: `{ targets, geo_target_type }`.
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const targets = Array.isArray(obj.targets) ? normaliseTargets(obj.targets) : [];
    const geo_target_type =
      typeof obj.geo_target_type === "string" &&
      (GEO_TARGET_TYPES as readonly string[]).includes(obj.geo_target_type)
        ? (obj.geo_target_type as GoogleSearchGeoTargetType)
        : DEFAULT_GEO_TARGET_TYPE;
    return { targets, geo_target_type };
  }
  return { targets: [], geo_target_type: DEFAULT_GEO_TARGET_TYPE };
}

/**
 * Pack the in-memory pair into the wire shape. Always emits the
 * Phase-5 wrapping object — legacy rows upgrade on the next save.
 */
export function serializeGeoTargetsColumn(
  decoded: DecodedGeoTargetsColumn,
): { targets: GoogleSearchGeoTarget[]; geo_target_type: GoogleSearchGeoTargetType } {
  return {
    targets: normaliseTargets(decoded.targets),
    geo_target_type: decoded.geo_target_type,
  };
}

function normaliseTargets(raw: unknown[]): GoogleSearchGeoTarget[] {
  const out: GoogleSearchGeoTarget[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const location = typeof e.location === "string" ? e.location : null;
    if (!location) continue;
    const bidModifier =
      typeof e.bid_modifier_pct === "number" && Number.isFinite(e.bid_modifier_pct)
        ? e.bid_modifier_pct
        : null;
    out.push({ location, bid_modifier_pct: bidModifier });
  }
  return out;
}
