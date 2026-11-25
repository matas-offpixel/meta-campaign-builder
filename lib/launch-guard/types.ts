/**
 * Shapes for the pre-launch check (brief R4, design record
 * 2026-11-24-campaign-creator-replicate RC3). Pure data: no Supabase,
 * no Meta, no React, so lib/launch-guard stays unit-testable under
 * `node --experimental-strip-types --test`.
 */

import type { PinPresetKey } from "../meta/location-pins.ts";

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
  /**
   * The draft's Facebook page or Instagram account is another client's
   * (RC3, 24 Nov amendment). One key for both; the finding's field says which.
   */
  | "page_other_client"
  /** Ops' ruling 4 (24 Nov): the event's venue has no account or pixel stored. A warning. */
  | "venue_not_set"
  /** RC8 (#1362): a published draft's page or Instagram isn't the live ads'. A warning. */
  | "identity_not_live"
  /**
   * #1370 LP4: a location is a known-ambiguous Meta city (Leeds, Kent). A
   * warning. Words and map live in lib/meta/location-pins.ts.
   */
  | "region_mismatch";

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
  | "audience_name"
  | "page"
  | "instagram"
  | "location";

/** One place a check looked at: the field, the ad (or audience) name, the value. */
export interface GuardFinding {
  field: GuardField;
  adName: string | null;
  value: string;
  /** The whole text the value was found in (a link's URL), when it differs from the value. */
  source?: string;
}

/**
 * What a fix button does to the draft. Applied by applyLaunchCheckFix().
 * `names` are the page names, handles and account names inside the label:
 * the button sets its own words in capitals and these keep their case (RC8).
 */
export type LaunchCheckFix = (

  | { action: "set_pixel"; label: string; pixelId: string }
  | { action: "set_account"; label: string; adAccountId: string }
  | { action: "rename"; label: string; name: string }
  | { action: "show_ads"; label: string; field: GuardField }
  | { action: "use_event_page"; label: string; from: string; to: string }
  | { action: "keep_link"; label: string; url: string }
  | { action: "open_captions"; label: string }
  /** "Change the page" / "Change the Instagram account": back to where it is picked. */
  | { action: "change_identity"; label: string; field: "page" | "instagram"; where: "settings" | "creatives" }
  /** "Open the venue card". TODO(R2): the venue card's own route once it exists. */
  | { action: "open_venue_card"; label: string; clientId: string | null }
  /** "Use the live ads' page: {live page}": the draft (never Meta) takes the live ads' page or Instagram. */
  | { action: "use_live_identity"; label: string; field: "page" | "instagram"; from: string; to: string }
  /** "Keep {draft page}": who kept which page or Instagram, and when (RC8). */
  | { action: "keep_identity"; label: string; field: "page" | "instagram"; id: string }
  /** location.region_mismatch.fix: every open location on that Meta city key becomes the preset's pin (#1370 LP5). */
  | { action: "use_location_pin"; label: string; cityKey: string; preset: PinPresetKey }
  /** "Add a pin" (no preset for the city): back to Locations. */
  | { action: "open_locations"; label: string }
  /** "Keep Leeds, Kent": who kept it and when, on each selection, the way #1370 stores it. */
  | { action: "keep_location"; label: string; cityKey: string }
) & { names?: readonly string[] };

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

/** "Keep {draft page}" (RC8): the page or Instagram id kept, who kept it and when. */
export interface KeptIdentity {
  id: string;
  /** The name or handle shown in the kept line, as it read when kept. */
  name: string | null;
  keptBy: string;
  keptAt: string;
}

/** One field of the live ads' identity: the page or account most live ads use. */
export interface LiveField {
  id: string;
  /** Page name, or the Instagram username without "@". */
  name: string | null;
  /** Live ads on this page / account. */
  count: number;
  /** Another client holds it (page_other_client's sources): never offered as the answer (RC8a). */
  otherClient: boolean;
}

/** The live ads' page and Instagram for a published draft, read once at launch review (RC8). */
export interface LiveIdentity {
  campaignId: string;
  /** ISO time of the read, for "Read from the live ads at {date, time}". */
  readAt: string;
  page: LiveField | null;
  instagram: LiveField | null;
  /** Names of the draft's own page and Instagram, read with the live ones. */
  draftNames: Record<string, string>;
}

/**
 * Who a Facebook page or Instagram account belongs to, for page_other_client.
 * Built by loadIdentityOwnership() from clients.default_page_ids /
 * default_instagram_actor_id and the BM scan (bm_pages / bm_ig_accounts,
 * mapped to a client by clients.meta_business_id). Earlier drafts are not
 * a source: a copied draft would make the mistake look like ownership.
 */
export interface IdentityOwner {
  kind: "page" | "instagram";
  /** Page id, or the Instagram user id (an actor or asset id matches too). */
  id: string;
  /** Page name, or the Instagram username without "@". */
  name: string | null;
  /** The event's client holds it: a default, or any page or account in its BM (owned or shared). */
  ownClient: boolean;
  /** Other clients that hold it as a default or own it in their BM, names as stored. */
  otherClients: readonly string[];
  /** Stored as an artist's page or Instagram: never flagged (RC3). */
  artist: boolean;
}

export interface IdentityOwnership {
  /** The event's client's name, as stored. */
  clientName: string | null;
  owners: readonly IdentityOwner[];
}
