/**
 * lib/meta/placements.ts
 *
 * Placement helpers for existing-post ad creatives.
 *
 * Meta placement model for manual placements
 * ──────────────────────────────────────────────
 * Ad-set `targeting` fields:
 *   publisher_platforms  → ["instagram"] | ["facebook"] | ["instagram","facebook"]
 *   instagram_positions  → ["stream","story","reels"]         (stream = IG Feed)
 *   facebook_positions   → ["feed","reels"]                   (subset we expose)
 *
 * "Automatic placements" (Meta's default) = omit all three fields entirely.
 *
 * Smart defaults
 * ──────────────
 *   Instagram post: IG Feed + IG Stories + IG Reels  ON
 *                   FB Feed + FB Reels               OFF
 *
 *   Facebook post:  FB Feed + FB Reels               ON
 *                   IG Feed + IG Stories + IG Reels  OFF
 *
 * References
 *   https://developers.facebook.com/docs/marketing-api/targeting-specs#placement
 */

import type { ExistingPostPlacements, ExistingPostSelection } from "@/lib/types";

// ─── Defaults ──────────────────────────────────────────────────────────────

export function defaultPlacementsFor(
  source: "instagram" | "facebook",
): ExistingPostPlacements {
  if (source === "instagram") {
    return {
      igFeed: true,
      igStories: true,
      igReels: true,
      fbFeed: false,
      fbReels: false,
    };
  }
  return {
    igFeed: false,
    igStories: false,
    igReels: false,
    fbFeed: true,
    fbReels: true,
  };
}

/**
 * Return the placements for an existing-post creative, applying smart
 * defaults when the field is absent.
 */
export function resolveExistingPostPlacements(
  existingPost: ExistingPostSelection | undefined,
): ExistingPostPlacements {
  if (!existingPost) {
    return defaultPlacementsFor("instagram");
  }
  if (existingPost.placements) {
    return existingPost.placements;
  }
  return defaultPlacementsFor(existingPost.source ?? "instagram");
}

// ─── Payload builder ──────────────────────────────────────────────────────

export interface PlacementTargeting {
  publisher_platforms: string[];
  instagram_positions?: string[];
  facebook_positions?: string[];
}

/**
 * Convert an `ExistingPostPlacements` toggle state into the Meta ad-set
 * targeting fields for manual placement control.
 *
 * Returns `null` when no placements are enabled — callers should treat this
 * as a validation error (see `validatePlacementSelection`).
 */
export function buildPlacementTargeting(
  placements: ExistingPostPlacements,
): PlacementTargeting | null {
  const igPositions: string[] = [];
  if (placements.igFeed) igPositions.push("stream");
  if (placements.igStories) igPositions.push("story");
  if (placements.igReels) igPositions.push("reels");

  const fbPositions: string[] = [];
  if (placements.fbFeed) fbPositions.push("feed");
  if (placements.fbReels) fbPositions.push("reels");

  const platforms: string[] = [];
  if (igPositions.length > 0) platforms.push("instagram");
  if (fbPositions.length > 0) platforms.push("facebook");

  if (platforms.length === 0) return null;

  const result: PlacementTargeting = { publisher_platforms: platforms };
  if (igPositions.length > 0) result.instagram_positions = igPositions;
  if (fbPositions.length > 0) result.facebook_positions = fbPositions;

  return result;
}

// ─── Validation ───────────────────────────────────────────────────────────

export interface PlacementValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePlacementSelection(
  placements: ExistingPostPlacements,
  existingPostSource?: "instagram" | "facebook",
): PlacementValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const anyEnabled =
    placements.igFeed ||
    placements.igStories ||
    placements.igReels ||
    placements.fbFeed ||
    placements.fbReels;

  if (!anyEnabled) {
    errors.push(
      "At least one placement must be enabled. Select Instagram Feed, Stories, Reels, or Facebook placements.",
    );
  }

  // Warn when an IG post is assigned to FB-only placements.
  // Meta allows cross-posting IG content to FB but the experience may differ.
  const igEnabled = placements.igFeed || placements.igStories || placements.igReels;
  const fbOnly = !igEnabled && (placements.fbFeed || placements.fbReels);
  if (existingPostSource === "instagram" && fbOnly) {
    warnings.push(
      "This Instagram post will be shown on Facebook placements only. " +
        "Ensure the ad account has permission to cross-post this Instagram content to Facebook.",
    );
  }

  // Warn when stories/reels selected but the source is a square/carousel
  // (we can't detect aspect ratio here, so this is a soft hint).
  if (placements.igStories || placements.igReels) {
    warnings.push(
      'Stories and Reels perform best with vertical (9:16) content. ' +
        'Square or landscape images may be cropped.',
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Formatting ───────────────────────────────────────────────────────────

/** Human-readable summary for logs / review screens. */
export function summarisePlacements(placements: ExistingPostPlacements): string {
  const parts: string[] = [];
  if (placements.igFeed) parts.push("IG Feed");
  if (placements.igStories) parts.push("IG Stories");
  if (placements.igReels) parts.push("IG Reels");
  if (placements.fbFeed) parts.push("FB Feed");
  if (placements.fbReels) parts.push("FB Reels");
  return parts.length > 0 ? parts.join(", ") : "(none)";
}

// ─── buildIgExistingPostCreative (Part 3 clean helper) ───────────────────

/**
 * Return the placement targeting object for an ad set that will serve an
 * existing-post creative.
 *
 * This is the canonical entry point used by the launch route. Pass the
 * `existingPost` from the creative draft; the function resolves defaults
 * and returns the ready-to-merge targeting fields (or `null` = automatic).
 */
export function resolveAdSetPlacementTargeting(
  existingPost: ExistingPostSelection | undefined,
): PlacementTargeting | null {
  const placements = resolveExistingPostPlacements(existingPost);
  return buildPlacementTargeting(placements);
}
