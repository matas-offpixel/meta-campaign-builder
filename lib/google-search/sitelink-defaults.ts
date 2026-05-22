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
 * 8 sitelinks are seeded by default.
 *
 * WHY 8: Google shows only ~4-6 sitelinks per ad impression, and
 * campaign-level sitelinks take display precedence over account-level
 * ones. Providing 8 campaign-level sitelinks reliably fills every
 * available display slot, crowding out any pre-existing account-level
 * sitelinks that point to the wrong pages (e.g. LWE's generic "What's
 * On" / "About Us" sitelinks). Google's hard cap is 20/campaign; 8 is
 * well within that and exceeds the maximum number ever shown at once.
 *
 * All sitelinks default to NULL `final_url` so the push adapter
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
 * Return the canonical 8-sitelink seed set for a new plan.
 *
 * All link_text ≤25 chars, all description lines ≤35 chars (validated
 * in `validateSitelinks`; defaults are verified in sitelinks.test.ts).
 *
 * The crowd-out strategy: 8 campaign-level sitelinks fill every display
 * slot (Google shows ≤6 at a time) so account-level sitelinks never
 * surface in the ad, without requiring any API call to exclude them
 * (v23 has no per-campaign inheritance-override endpoint).
 */
export function defaultSitelinkSeeds(
  context: SitelinkSeedContext = {},
): GoogleSearchSitelinkDraft[] {
  const venue = (context.venueName ?? "").trim();

  // "The Stages" description uses venue-specific stage names when known;
  // falls back to a generic description for events without named stages.
  const stagesDesc1 = venue ? truncate(`${venue} stages`, 35) : "Stage info";
  const stagesDesc2 = venue ? "Where it happens" : "Where it happens";

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
    {
      link_text: "Set Times",
      description1: "Stage times & schedule",
      description2: "Plan your day",
      final_url: null,
      sort_order: 4,
    },
    {
      link_text: "Travel & Parking",
      description1: "How to get there",
      description2: "Transport & parking",
      final_url: null,
      sort_order: 5,
    },
    {
      link_text: "The Stages",
      description1: stagesDesc1,
      description2: stagesDesc2,
      final_url: null,
      sort_order: 6,
    },
    {
      link_text: "How to Buy",
      description1: "Official tickets only",
      description2: "Buy via the box office",
      final_url: null,
      sort_order: 7,
    },
  ];
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}
