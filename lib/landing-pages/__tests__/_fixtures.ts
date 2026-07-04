import type { LandingPageContext, PageEventRow, SignupSubmission } from "../types.ts";

/**
 * Shared fixture defaults for the PR-6 columns so individual tests only
 * spell the fields they exercise. Values mirror the migration-136 column
 * defaults (empty arrays, box_logo, attribution on).
 */

/** page_events PR-6 presentation columns, all "unset". */
export const PAGE_EVENT_PRESENTATION_DEFAULTS: Pick<
  PageEventRow,
  | "artwork_palette"
  | "hero_images"
  | "countdown_target_at"
  | "countdown_label"
  | "youtube_url"
  | "bottom_images"
> = {
  artwork_palette: null,
  hero_images: [],
  countdown_target_at: null,
  countdown_label: "tickets on sale in",
  youtube_url: null,
  bottom_images: [],
};

/** client_landing_pages PR-6 columns at their migration defaults. */
export const LANDING_PAGE_PRESENTATION_DEFAULTS: Pick<
  NonNullable<LandingPageContext["landingPage"]>,
  "privacy_policy_url" | "logo_style" | "box_logo_text" | "show_off_pixel_attribution"
> = {
  privacy_policy_url: null,
  logo_style: "box_logo",
  box_logo_text: null,
  show_off_pixel_attribution: true,
};

/** A minimal valid post-PR-6 submission — override per test. */
export function makeSubmission(
  overrides: Partial<SignupSubmission> = {},
): SignupSubmission {
  return {
    email: "fan@example.com",
    phone_e164: null,
    phone_country_code: null,
    ig_handle: null,
    tt_handle: null,
    consent_wa_opt_in: false,
    utm: {},
    referrer_url: null,
    source: null,
    capi_event_id: null,
    ...overrides,
  };
}
