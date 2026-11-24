import { createDefaultCreative, createDefaultDraft } from "../../lib/campaign-defaults.ts";
import { checkLaunchReferences, renderArtistCaptionCheck } from "../../lib/launch-guard/check.ts";
import type { GuardEvent, LaunchGuardResult } from "../../lib/launch-guard/types.ts";
import { ELECTRIC_CLIENT_ID, venueDefaultsFromMap } from "../../lib/launch-guard/venue-defaults.ts";
import type { AdSetSuggestion, CampaignDraft } from "../../lib/types.ts";

/**
 * RC-C of docs/design-record/2026-11-24-campaign-creator-replicate.html:
 * Review & launch's launch checks. Each frame runs the real
 * checkLaunchReferences on a fixture draft against this week's Electric
 * events (ids, accounts and pixels from production, 24 Nov). The one
 * exception is the artist-caption row on the composite: its detector is a
 * stub until R8b, so the row is the real renderer on fixture input
 * (Glitterbox's team, 4 ads, "Artist · teaser 1–4").
 *
 * - RC-C: the composite, every check on one NX27-GLITTERBOX draft.
 * - RC-C-clean: the clean copy.
 * - RC-C-venue: ops' rulings 3 and 4 (24 Nov): a show at Electric Brixton,
 *   which has no account or pixel stored (a warning, Launch stays on), and
 *   one ad whose link isn't the event's page (the one-ad row).
 */
export const LAUNCH_CHECKS_FRAME_IDS = ["RC-C", "RC-C-clean", "RC-C-venue"] as const;
export type LaunchChecksFrameId = (typeof LAUNCH_CHECKS_FRAME_IDS)[number];

function event(partial: Partial<GuardEvent> & Pick<GuardEvent, "id" | "code">): GuardEvent {
  return {
    name: null,
    clientId: ELECTRIC_CLIENT_ID,
    venueName: null,
    venueKey: null,
    venueCity: null,
    signupUrl: null,
    ticketUrl: null,
    cirqlinPageSlug: null,
    metaAdAccountId: null,
    artists: [],
    ...partial,
  };
}

const NX27_GLITTERBOX = event({
  id: "3b128276-4528-43b7-a102-9d165d14331b",
  code: "NX27-GLITTERBOX",
  name: "Glitterbox",
  venueName: "NX Newcastle",
  venueKey: "nx newcastle",
  signupUrl: "https://crqln.com/l/glitterbox-newcastle",
  cirqlinPageSlug: "glitterbox-newcastle",
  metaAdAccountId: "606252931141334",
  artists: ["Glitterbox"],
});

const OTHERS: GuardEvent[] = [
  event({
    id: "9361ce50-8a5f-4cbd-a7d9-67dc853fc212",
    code: "EBR27-GLITTERBOX",
    name: "Glitterbox",
    venueName: "Electric Bristol",
    venueKey: "electric bristol",
    signupUrl: "https://www.glitterbox-bristol.com",
    cirqlinPageSlug: "glitterbox-bristol",
    metaAdAccountId: "2011069725849568",
    artists: ["Glitterbox"],
  }),
  event({
    id: "407eb204-7498-49aa-983d-d336af81e871",
    code: "NX27-PAULVANDYK",
    name: "Paul Van Dyk",
    venueName: "NX Newcastle",
    venueKey: "nx newcastle",
    signupUrl: "https://www.paulvandyk-newcastle.com",
    cirqlinPageSlug: "paulvandyk-newcastle",
    metaAdAccountId: "606252931141334",
    artists: ["Paul Van Dyk"],
  }),
];

function adSets(n: number): AdSetSuggestion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `as-${i + 1}`,
    name: `Ad set ${i + 1}`,
    sourceType: "blank",
    sourceId: "",
    sourceName: `Ad set ${i + 1}`,
    enabled: true,
  })) as AdSetSuggestion[];
}

function draft(composite: boolean): CampaignDraft {
  const base = createDefaultDraft();
  const pvdAds = ["Lineup Adv+ · Static 1", "Static 2", "Video 1", "Video 2", "Video 3", "Carousel 1"];
  const otherAds = Array.from({ length: 12 }, (_, i) => `Static ${i + 3}`);
  const creatives = [...pvdAds, ...otherAds].map((name, i) => ({
    ...createDefaultCreative("registration"),
    id: `cr-${i + 1}`,
    name,
    headline: "Glitterbox · NX Newcastle",
    captions: [{ id: `cap-${i + 1}`, text: "Glitterbox comes to NX Newcastle. Sign up for ticket access." }],
    destinationUrl: !composite
      ? "https://crqln.com/l/glitterbox-newcastle"
      : i < pvdAds.length
        ? "https://www.paulvandyk-newcastle.com"
        : "https://skiddle.com/e/41877",
  }));
  return {
    ...base,
    settings: {
      ...base.settings,
      clientId: ELECTRIC_CLIENT_ID,
      eventId: NX27_GLITTERBOX.id,
      campaignCode: "NX27-GLITTERBOX",
      campaignName: composite ? "[EBR27-GLITTERBOX] SIGNUP" : "[NX27-GLITTERBOX] SIGNUP",
      metaAdAccountId: composite ? "act_2011069725849568" : "act_606252931141334",
      adAccountId: composite ? "act_2011069725849568" : "act_606252931141334",
      metaPixelId: composite ? "800268622344093" : "645185673672763",
      wizardMode: "new",
    },
    creatives,
    adSetSuggestions: adSets(18),
  };
}

/** An invented Brixton show: the venue is in the map with nothing stored (Task 5). */
const BRIXTON_SHOW = event({
  id: "frame-brixton-show",
  code: "EBX27-FIXTURE",
  name: "Fixture Night",
  venueName: "Electric Brixton",
  venueKey: "electric brixton",
  signupUrl: "https://crqln.com/l/fixture-brixton",
  cirqlinPageSlug: "fixture-brixton",
});

function brixtonDraft(): CampaignDraft {
  const base = draft(false);
  return {
    ...base,
    settings: {
      ...base.settings,
      eventId: BRIXTON_SHOW.id,
      campaignCode: "EBX27-FIXTURE",
      campaignName: "[EBX27-FIXTURE] SIGNUP",
    },
    creatives: base.creatives.slice(0, 6).map((creative, i) => ({
      ...creative,
      headline: "Fixture Night · Electric Brixton",
      captions: [{ id: `cap-b-${i}`, text: "Fixture Night comes to Electric Brixton. Sign up for ticket access." }],
      destinationUrl: i === 0 ? "https://skiddle.com/e/41877" : "https://crqln.com/l/fixture-brixton",
    })),
  };
}

export function launchChecksFrame(id: LaunchChecksFrameId): LaunchGuardResult {
  if (id === "RC-C-venue") {
    return checkLaunchReferences(brixtonDraft(), BRIXTON_SHOW, venueDefaultsFromMap(BRIXTON_SHOW), OTHERS);
  }
  const composite = id === "RC-C";
  const result = checkLaunchReferences(draft(composite), NX27_GLITTERBOX, venueDefaultsFromMap(NX27_GLITTERBOX), OTHERS);
  if (!composite) return result;
  const caption = renderArtistCaptionCheck({
    artist: "Glitterbox",
    adNames: ["Static 3", "Static 4", "Static 5", "Static 6"],
    captionLabels: "Artist · teaser 1–4",
  });
  const blockers = result.checks.filter((check) => check.severity === "blocker");
  const warnings = result.checks.filter((check) => check.severity === "warning");
  const checks = [...blockers, caption, ...warnings];
  return { ...result, checks, blockers: blockers.length + 1 };
}
