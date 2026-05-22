/**
 * lib/google-search/sitelink-defaults.ts
 *
 * Generate sensible default sitelinks for a new Google Search plan.
 *
 * Used in three places (so the operator gets the same starting set
 * regardless of how the plan was created):
 *   1. POST /api/google-search                  — blank plan creation
 *   2. POST /api/google-search/import           — xlsx import flow
 *   3. Wizard "Reset to defaults" button (TBD) — manual re-seed
 *
 * All four sitelinks default to NULL `final_url` so the push adapter
 * inherits the plan landing URL — the operator overrides per-sitelink
 * in the wizard when needed.
 *
 * Character limits (25 / 35) are validated downstream in
 * `validation.ts`; the defaults are conservatively under those caps.
 */
import type { GoogleSearchSitelinkDraft } from "./types.ts";

export interface SitelinkSeedContext {
  /** Optional venue name from `events.venue_name`. Used to flavour the "Venue Info" defaults. */
  venueName?: string | null;
}

/**
 * Return the canonical 4-sitelink seed set. Defaults to the LWE-style
 * "Tickets / Lineup / Venue Info / FAQ" set sized for music events; the
 * operator is expected to refine in the wizard.
 */
export function defaultSitelinkSeeds(
  context: SitelinkSeedContext = {},
): GoogleSearchSitelinkDraft[] {
  const venue = (context.venueName ?? "").trim();

  return [
    {
      link_text: "Tickets",
      description1: "Secure your place",
      description2: "Limited availability",
      final_url: null,
      sort_order: 0,
    },
    {
      link_text: "Lineup",
      description1: "See the full lineup",
      description2: "Artists & stages",
      final_url: null,
      sort_order: 1,
    },
    {
      link_text: "Venue Info",
      // If we know the venue name, surface it on description 1 — otherwise
      // fall back to the generic "Where to find us" copy.
      description1: venue ? truncate(venue, 35) : "Where to find us",
      description2: "Getting there",
      final_url: null,
      sort_order: 2,
    },
    {
      link_text: "FAQ",
      description1: "Times, age policy & more",
      description2: "Everything you need to know",
      final_url: null,
      sort_order: 3,
    },
  ];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}
