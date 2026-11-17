/**
 * Which Facebook page a Lab ad may post as, per event.
 *
 * The Lab launch picks the page in two places (launch.ts): an
 * artist-first-person caption posts as the artist's own page
 * (creative_lab_artists.meta_page_id), every other caption as the round's
 * target page (creative_lab_rounds.page_id). Either can be set by hand, so a
 * rule here is checked on the page each ad would actually post as, after
 * that choice and before any upload.
 *
 * P26-BDAY (Puzzle 4th Birthday): Luke Dean's management asked on
 * 17 Nov 2026 that every Luke Dean ad posts as the Puzzle page, never as
 * his own (luke.dean1). Most of all the UGC caption ads.
 */

export type EventPageRule = {
  eventCode: string;
  /** Pages no ad on this event may post as. */
  blockedPageIds: readonly string[];
  /** Instagram accounts no ad on this event may post as. */
  blockedInstagramIds: readonly string[];
  /** Lab artists (creative_lab_artists.id) whose ads must post as requiredPageId. */
  artistIds: readonly string[];
  requiredPageId: string;
  requiredPageName: string;
  artistName: string;
};

export const PUZZLE_PAGE_ID = "103824529223927";
export const LUKE_DEAN_PAGE_ID = "105860490791937";
export const LUKE_DEAN_INSTAGRAM_ID = "17841400841265609";
export const LUKE_DEAN_LAB_ARTIST_ID = "fe3736d8-4252-4282-bb32-de1e3fdfb359";

export const EVENT_PAGE_RULES: readonly EventPageRule[] = [
  {
    eventCode: "P26-BDAY",
    blockedPageIds: [LUKE_DEAN_PAGE_ID],
    blockedInstagramIds: [LUKE_DEAN_INSTAGRAM_ID],
    artistIds: [LUKE_DEAN_LAB_ARTIST_ID],
    requiredPageId: PUZZLE_PAGE_ID,
    requiredPageName: "Puzzle",
    artistName: "Luke Dean",
  },
];

/**
 * Null when the ad may post as this page, otherwise the reason it may not.
 * An empty page is left to the launch's own checks.
 */
export function pageRefusal(
  args: {
    eventCode: string | null | undefined;
    labArtistId: string | null | undefined;
    pageId: string | null | undefined;
    instagramActorId?: string | null;
  },
  rules: readonly EventPageRule[] = EVENT_PAGE_RULES,
): string | null {
  const eventCode = String(args.eventCode ?? "").trim();
  const pageId = String(args.pageId ?? "").trim();
  const instagramId = String(args.instagramActorId ?? "").trim();
  if (!eventCode) return null;
  for (const rule of rules) {
    if (rule.eventCode !== eventCode) continue;
    if (instagramId && rule.blockedInstagramIds.includes(instagramId)) {
      return `${rule.eventCode}: ${rule.artistName}'s ads post as ${rule.requiredPageName}, not as Instagram account ${instagramId}.`;
    }
    if (!pageId) continue;
    const forArtist = rule.artistIds.includes(String(args.labArtistId ?? "").trim());
    if (rule.blockedPageIds.includes(pageId) || (forArtist && pageId !== rule.requiredPageId)) {
      return `${rule.eventCode}: ${rule.artistName}'s ads post as the ${rule.requiredPageName} page (${rule.requiredPageId}) only, not page ${pageId}.`;
    }
  }
  return null;
}
