import type { GuardEvent, VenueDefault, VenueDefaults } from "./types.ts";

/**
 * Venue ad accounts and pixels until the venue card exists.
 *
 * // replaced by venue card (R2)
 *
 * Migration 266 (CC-1, `cc/replicate-core`) adds `venues.meta_ad_account_id`
 * and `venues.meta_pixel_id`, and the event's own override. When it is
 * applied, `loadVenueDefaults()` below reads those columns instead and this
 * map goes. Every value is a full id read from production on 24 Nov 2026
 * (SELECTs only) and the overnight Task 5 report of 23 Nov:
 *
 * - account: `launched_ad_sets.ad_account_id` per `events.venue_key` and
 *   `events.meta_ad_account_id` on every event of that venue; the name is
 *   `bm_ad_accounts.name`.
 * - pixel: the pixel on the venue's published drafts in the last 45 days
 *   (`draft_json.settings.metaPixelId`) and Task 5 §2 (the ads' pixel by
 *   spend since 1 Sep, from `promoted_object.pixel_id`); the name is
 *   `bm_pixels.name`.
 *
 * Electric Brixton has no ad account in the app and no events (Task 5 §2),
 * so it holds no values: a check never fires on a value that isn't stored.
 */
export const ELECTRIC_CLIENT_ID = "f9045034-2788-4b1d-94d1-1a5ab7fa5ac8";

const ELECTRIC_VENUES: readonly VenueDefault[] = [
  {
    key: "nx newcastle",
    name: "NX Newcastle",
    city: "Newcastle",
    // 316 launched ad sets; events.meta_ad_account_id on every NX event.
    adAccountId: "606252931141334",
    adAccountName: "NX Promoter",
    // NX Live Skiddle: 414 ad sets / £24.4k since 1 Sep (Task 5); 19 of the
    // venue's published drafts in 45 days.
    pixelId: "645185673672763",
    pixelName: "NX Live Skiddle",
  },
  {
    key: "electric bristol",
    name: "Electric Bristol",
    city: "Bristol",
    // 69 launched ad sets; events.meta_ad_account_id on every EBR event.
    adAccountId: "2011069725849568",
    adAccountName: "Electric Bristol Live",
    // ELECTRIC BRISTOL SKIDDLE: 70 ad sets / £3.5k since 1 Sep (Task 5).
    pixelId: "800268622344093",
    pixelName: "ELECTRIC BRISTOL SKIDDLE",
  },
  {
    key: "electric studios",
    name: "Electric Studios",
    city: "Sheffield",
    // 113 launched ad sets; events.meta_ad_account_id on every ES event.
    adAccountId: "1073273492854557",
    adAccountName: "ELECTRIC STUDIOS SHEFFIELD",
    // Electric Studios Universe Pixel: 119 ad sets / £6.1k since 1 Sep, and
    // the CIRQLIN brand pixel (Task 5). Skiddle shows override it per event.
    pixelId: "2261755947685271",
    pixelName: "Electric Studios Universe Pixel",
  },
  {
    key: "electric brixton",
    name: "Electric Brixton",
    city: "London",
    adAccountId: null,
    adAccountName: null,
    pixelId: null,
    pixelName: null,
  },
];

/**
 * Event-level pixels that differ from the venue's (RC4's override), keyed
 * by event id, until 266's event column holds them.
 */
const ELECTRIC_EVENT_PIXEL_OVERRIDES: Readonly<Record<string, string>> = {
  // ES27-DAVEPEARCE: page, Skiddle and draft all on "Electric Group -
  // Sheffield Pixel" (Task 5 §2, §5 A3).
  "2bb459a9-b2eb-4e00-a2ba-c5b8ddae7b55": "1987031252241238",
};

const VENUES_BY_CLIENT: Readonly<Record<string, readonly VenueDefault[]>> = {
  [ELECTRIC_CLIENT_ID]: ELECTRIC_VENUES,
};

const EVENT_PIXEL_OVERRIDES_BY_CLIENT: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [ELECTRIC_CLIENT_ID]: ELECTRIC_EVENT_PIXEL_OVERRIDES,
};

/** Digits only: "act_606…" and "606…" compare equal. */
export function accountDigits(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().replace(/^act_/i, "");
  return /^\d+$/.test(value) ? value : null;
}

export function venueKeyOf(raw: string | null | undefined): string | null {
  const key = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return key || null;
}

/**
 * Venue defaults from the constant map. Pure, so tests and the dry-run
 * script share it with the launch path.
 */
export function venueDefaultsFromMap(
  event: Pick<GuardEvent, "id" | "clientId" | "venueKey" | "venueName" | "metaAdAccountId">,
): VenueDefaults {
  const venues = (event.clientId && VENUES_BY_CLIENT[event.clientId]) || [];
  const key = venueKeyOf(event.venueKey) ?? venueKeyOf(event.venueName);
  const eventVenue = venues.find((venue) => venue.key === key) ?? null;
  const eventAccount = accountDigits(event.metaAdAccountId);
  const eventPixel =
    (event.clientId && EVENT_PIXEL_OVERRIDES_BY_CLIENT[event.clientId]?.[event.id]) || null;
  return {
    eventVenue,
    venues,
    override: {
      adAccountId: eventAccount && eventAccount !== eventVenue?.adAccountId ? eventAccount : null,
      pixelId: eventPixel && eventPixel !== eventVenue?.pixelId ? eventPixel : null,
    },
  };
}

/**
 * The one read of venue defaults. When migration 266 is applied, the
 * body becomes the read of `venues.meta_ad_account_id` / `meta_pixel_id`
 * (and the event's override columns); nothing else changes.
 */
export async function loadVenueDefaults(
  _supabase: unknown,
  event: Pick<GuardEvent, "id" | "clientId" | "venueKey" | "venueName" | "metaAdAccountId">,
): Promise<VenueDefaults> {
  return venueDefaultsFromMap(event);
}

/** Every venue row in the map, for the PR's printed table and the dry run. */
export function venueMapRows(): Array<VenueDefault & { clientId: string }> {
  return Object.entries(VENUES_BY_CLIENT).flatMap(([clientId, venues]) =>
    venues.map((venue) => ({ ...venue, clientId })),
  );
}

export function eventPixelOverrideRows(): Array<{ clientId: string; eventId: string; pixelId: string }> {
  return Object.entries(EVENT_PIXEL_OVERRIDES_BY_CLIENT).flatMap(([clientId, map]) =>
    Object.entries(map).map(([eventId, pixelId]) => ({ clientId, eventId, pixelId })),
  );
}
