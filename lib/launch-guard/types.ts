/**
 * Shapes for the pre-launch check (brief R4, design record
 * 2026-11-24-campaign-creator-replicate RC3). Pure data: no Supabase,
 * no Meta, no React, so lib/launch-guard stays unit-testable under
 * `node --experimental-strip-types --test`.
 */

/** One venue's ad account and pixel. Replaced by the venue card (R2). */
export interface VenueDefault {
  /** `events.venue_key`, e.g. "nx newcastle". */
  key: string;
  /** Display name, e.g. "NX Newcastle". */
  name: string;
  city: string | null;
  /** Digits only, no `act_`. Null when the venue has none stored. */
  adAccountId: string | null;
  /** Meta's name for the account, for the sentence. */
  adAccountName: string | null;
  pixelId: string | null;
  pixelName: string | null;
}

/**
 * What `loadVenueDefaults()` returns for one event: the event's venue,
 * every venue of the client (to name whose pixel or account a draft
 * holds), and the event-level values that differ from its venue.
 */
export interface VenueDefaults {
  /** The event's venue, or null when the client has no venue values. */
  eventVenue: VenueDefault | null;
  /** Every venue the client has, the event's own included. */
  venues: readonly VenueDefault[];
  /**
   * Set only when the event's value differs from its venue's (or there
   * is no venue value): Sheffield's Skiddle pixel on ES27-DAVEPEARCE.
   */
  override: { adAccountId: string | null; pixelId: string | null };
}

/** The event a draft launches for, and every other show it is checked against. */
export interface GuardEvent {
  id: string;
  code: string | null;
  name: string | null;
  clientId: string | null;
  venueName: string | null;
  venueKey: string | null;
  venueCity: string | null;
  signupUrl: string | null;
  ticketUrl: string | null;
  cirqlinPageSlug: string | null;
  /** `events.meta_ad_account_id`, digits or `act_…`. */
  metaAdAccountId: string | null;
  /** `event_artists` → `artists.name`. */
  artists: readonly string[];
}

/** Stable keys (brief R4 + the artist-caption check, record RC3). */
export type LaunchCheckKey =
  | "pixel_not_venue"
  | "account_not_venue"
  | "other_show_reference"
  | "name_code_mismatch"
  | "artist_caption_not_approved"
  | "link_not_event"
  /** Ops' ruling 4 (24 Nov): the event's venue has no account or pixel stored. A warning. */
  | "venue_not_set";

export type LaunchCheckSeverity = "blocker" | "warning";

/** Where in the draft a value was found. */
export type GuardField =
  | "pixel"
  | "ad_account"
  | "campaign_name"
  | "link"
  | "headline"
  | "primary_text"
  | "ad_name"
  | "audience_name";

/** One place a check looked at: the field, the ad (or audience) name, the value. */
export interface GuardFinding {
  field: GuardField;
  adName: string | null;
  value: string;
}

/** What a fix button does to the draft. Applied by applyLaunchCheckFix(). */
export type LaunchCheckFix =
  | { action: "set_pixel"; label: string; pixelId: string }
  | { action: "set_account"; label: string; adAccountId: string }
  | { action: "rename"; label: string; name: string }
  | { action: "show_ads"; label: string; field: GuardField }
  | { action: "use_event_page"; label: string; from: string; to: string }
  | { action: "keep_link"; label: string; url: string }
  | { action: "open_captions"; label: string };

export interface LaunchCheck {
  key: LaunchCheckKey;
  severity: LaunchCheckSeverity;
  /** The short key word: "Pixel", "Another show", … */
  label: string;
  sentence: string;
  evidence: string;
  fixes: LaunchCheckFix[];
  findings: GuardFinding[];
}

export interface LaunchGuardResult {
  /** Blockers first, in the order the checks run, then warnings (RC3). */
  checks: LaunchCheck[];
  blockers: number;
  warnings: number;
  /** The event's code, for "Account, pixel, link and names match {code}." */
  eventCode: string | null;
}

/** "Keep this link" (ruling b): who kept which link on this draft, and when. */
export interface KeptLink {
  url: string;
  keptBy: string;
  keptAt: string;
}
