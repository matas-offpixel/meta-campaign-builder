/**
 * lib/meta/placement-config.ts
 *
 * Wizard-wide manual placement control (Step 5 "Placements" section, task
 * #117). Distinct from `lib/meta/placements.ts`, which resolves the narrower
 * platform-derived preset for a single "boost existing post" creative — that
 * module still wins on top of this one for ad sets carrying an existing-post
 * creative (see `app/api/meta/launch-campaign/route.ts`).
 *
 * ── Reproducer ────────────────────────────────────────────────────────────
 * East End Dubs Newcastle signup campaign (act 606252931141334, campaign
 * 120251192078210755), 2026-08-07: all 42 ads shipped to EVERY Meta
 * placement — Audience Network, Marketplace, Business Explorer, Search —
 * instead of the operator-intended FB Feed + IG Feed. Root cause: nothing in
 * the wizard ever set `publisher_platforms` for a normal (non-existing-post)
 * ad set, so Meta defaulted to Advantage+ Placements = automatic = every
 * placement it's eligible for.
 *
 * Dependency-free on purpose (no Graph client) so this is exhaustively unit
 * testable offline.
 */

import type { InstagramPlacementPosition, PlacementConfig } from "@/lib/types";

export const DEFAULT_PLACEMENT_CONFIG: PlacementConfig = { mode: "advantage_plus" };

/**
 * Instagram positions Meta rejects for this API version (2026-08-18,
 * IRW0001 Jamie Jones launch — code=100 subcode=2490589
 * "IG Explore placement is deprecated … and cannot be selected").
 * Stripped in {@link buildPlacementConfigTargeting} so saved drafts /
 * localStorage autosaves that still carry them cannot brick launches.
 */
const DEPRECATED_IG_POSITIONS = new Set<InstagramPlacementPosition>([
  "explore",
  "explore_home",
]);

/**
 * Resolve which `PlacementConfig` applies to a given ad set.
 *
 * Precedence: per-ad-set override > campaign-wide draft setting > Meta's
 * automatic Advantage+ Placements (the implicit default for any draft that
 * pre-dates this field, or that never set it at all).
 */
export function resolveEffectivePlacementConfig(
  campaignWide: PlacementConfig | undefined,
  perAdSetOverride: PlacementConfig | undefined,
): PlacementConfig {
  return perAdSetOverride ?? campaignWide ?? DEFAULT_PLACEMENT_CONFIG;
}

export interface PlacementConfigTargeting {
  publisher_platforms: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  audience_network_positions?: string[];
  device_platforms?: string[];
}

/**
 * Convert a resolved `PlacementConfig` into the Meta ad-set targeting fields.
 *
 * Returns `null` for `mode: "advantage_plus"` (the fields must be OMITTED
 * entirely — Meta interprets their absence as "automatic placements", not
 * an empty/explicit automatic setting) and for a `"manual"` config with no
 * platforms selected (nothing to send — safer to fall back to automatic
 * than launch an ad set that can serve nowhere).
 */
export function buildPlacementConfigTargeting(
  config: PlacementConfig | undefined,
): PlacementConfigTargeting | null {
  const effective = config ?? DEFAULT_PLACEMENT_CONFIG;
  if (effective.mode !== "manual") return null;

  const platforms = effective.publisherPlatforms ?? [];
  if (platforms.length === 0) return null;

  const result: PlacementConfigTargeting = { publisher_platforms: [...platforms] };

  if (platforms.includes("facebook") && (effective.facebookPositions?.length ?? 0) > 0) {
    result.facebook_positions = [...effective.facebookPositions!];
  }
  if (platforms.includes("instagram") && (effective.instagramPositions?.length ?? 0) > 0) {
    const igPositions = effective.instagramPositions!.filter(
      (p) => !DEPRECATED_IG_POSITIONS.has(p),
    );
    // Same empty-check semantics as before: if filtering leaves nothing,
    // omit the field rather than send an empty array Meta would reject.
    if (igPositions.length > 0) {
      result.instagram_positions = igPositions;
    }
  }
  if (
    platforms.includes("audience_network") &&
    (effective.audienceNetworkPositions?.length ?? 0) > 0
  ) {
    result.audience_network_positions = [...effective.audienceNetworkPositions!];
  }
  if ((effective.devicePlatforms?.length ?? 0) > 0) {
    result.device_platforms = [...effective.devicePlatforms!];
  }

  return result;
}

/** Human-readable summary for the wizard review screen / launch logs. */
export function summarisePlacementConfig(config: PlacementConfig | undefined): string {
  const effective = config ?? DEFAULT_PLACEMENT_CONFIG;
  if (effective.mode !== "manual") return "Advantage+ Placements (automatic)";

  const platforms = effective.publisherPlatforms ?? [];
  if (platforms.length === 0) return "Manual — no placements selected (falls back to automatic)";

  const PLATFORM_LABELS: Record<string, string> = {
    facebook: "Facebook",
    instagram: "Instagram",
    audience_network: "Audience Network",
    messenger: "Messenger",
  };
  return platforms.map((p) => PLATFORM_LABELS[p] ?? p).join(" + ");
}

export interface PlacementConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a manual placement selection before launch. Mirrors the shape of
 * `validatePlacementSelection` in `lib/meta/placements.ts`.
 */
export function validatePlacementConfig(config: PlacementConfig | undefined): PlacementConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const effective = config ?? DEFAULT_PLACEMENT_CONFIG;

  if (effective.mode !== "manual") return { valid: true, errors, warnings };

  const platforms = effective.publisherPlatforms ?? [];
  if (platforms.length === 0) {
    errors.push(
      "Manual placements selected but no platform is enabled. Select at least one of " +
        "Facebook, Instagram, Audience Network, or Messenger.",
    );
  }

  if (platforms.includes("audience_network")) {
    warnings.push(
      "Audience Network placements serve on third-party apps/sites outside Meta's own " +
        "surfaces — inventory quality varies more than Facebook/Instagram Feed.",
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}
