import { createDefaultCreative, createDefaultDraft } from "../../lib/campaign-defaults.ts";
import {
  checkLaunchReferences,
  draftIdentities,
  keepIdentity,
  keepLink,
  keptIdentityLines,
  keptLinkLines,
  renderArtistCaptionCheck,
} from "../../lib/launch-guard/check.ts";
import { identityOwnershipFrom } from "../../lib/launch-guard/load.ts";
import type { GuardEvent, LaunchGuardResult, LiveIdentity } from "../../lib/launch-guard/types.ts";
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
 * - RC-C2: page_other_client on the NX26-DOD On sale draft (20909b86): its
 *   settings hold Ironworks London (IRONWORKS' page, LWE's BM) and
 *   @puzzleofficialuk (Puzzle's). Ownership rows are production's (24 Nov);
 *   the nine ads are the record's invented count.
 * - RC-C-venue: ops' rulings 3 and 4 (24 Nov): a show at Electric Brixton,
 *   which has no account or pixel stored (a warning, Launch stays on), one
 *   ad whose link isn't the event's page (the one-ad row), and one kept
 *   link (the muted line under the list).
 *
 * #1362 (RC8, RC8a), the live ads' page, read at 15:02 on Tue 24 Nov:
 * - RC-H: NX26-DOD On sale, published, its 9 ads on Ironworks London +
 *   @puzzleofficialuk, the live ads on NX LOVES + @nxloves (the Graph read of
 *   24 Nov, record #1362): the two page_other_client blockers with the live answer.
 * - RC-I: the draft on NX Newcastle + @nxnewcastle (invented, as the
 *   record has it): two identity_not_live warnings, Launch on.
 * - RC-I-kept: the same after Keep on both (15:06): the two kept lines.
 */
export const LAUNCH_CHECKS_FRAME_IDS = ["RC-C", "RC-C-clean", "RC-C2", "RC-C-venue", "RC-H", "RC-I", "RC-I-kept"] as const;
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
      destinationUrl:
        i === 0 ? "https://skiddle.com/e/41877" : i === 1 ? "https://ra.co/events/2210442" : "https://crqln.com/l/fixture-brixton",
    })),
  };
}

const ELECTRIC_NAME = "Electric Brixton";

const NX26_DOD = event({
  id: "f0b5636b-0000-4000-8000-000000000000",
  code: "NX26-DOD",
  name: "DOD",
  venueName: "NX Newcastle",
  venueKey: "nx newcastle",
  signupUrl: "https://dod-newcastle.com",
  metaAdAccountId: "606252931141334",
});

function dodDraft(): CampaignDraft {
  const base = draft(false);
  return {
    ...base,
    settings: {
      ...base.settings,
      eventId: NX26_DOD.id,
      campaignCode: "NX26-DOD",
      campaignName: "[NX26-DOD] DOD - On sale",
      metaPageId: "1157874844068425",
      metaIGAccountId: "17841456620568454",
    },
    creatives: base.creatives.slice(0, 9).map((creative, i) => ({
      ...creative,
      name: `On sale ${i + 1}`,
      headline: "DOD · NX Newcastle",
      captions: [{ id: `cap-d-${i}`, text: "DOD at NX Newcastle. Tickets on sale now." }],
      destinationUrl: "https://dod-newcastle.com?ref=meta",
      identity: { pageId: "1157874844068425", instagramAccountId: "17841456620568454", instagramActorId: "17841456620568454" },
    })),
  };
}

/** Production's ownership rows for the NX26-DOD ids (clients defaults, BM scan), 24 Nov. */
function dodOwnership(d: CampaignDraft) {
  const ids = draftIdentities(d);
  return identityOwnershipFrom({
    event: NX26_DOD,
    pageIds: [...ids.pages.keys()],
    igIds: [...ids.instagram.keys()],
    clients: [
      { id: ELECTRIC_CLIENT_ID, name: ELECTRIC_NAME, default_page_ids: [], default_instagram_actor_id: null, meta_business_id: "1927009767586803" },
      { id: "92f7334b-ef76-4095-88d6-f422ba1ff3f2", name: "Puzzle", default_page_ids: ["103824529223927"], default_instagram_actor_id: "17841456620568454", meta_business_id: "1297062077498960" },
      { id: "f7ed8aef-8527-4c3e-a16a-a05fc38861f5", name: "IRONWORKS", default_page_ids: ["1157874844068425"], default_instagram_actor_id: "17841446090086018", meta_business_id: "741799859254067" },
    ],
    bmPages: [{ id: "p", business_id: "741799859254067", page_id: "1157874844068425", page_name: "Ironworks London", is_owned_by_bm: true }],
    bmIgs: [{ id: "i", business_id: "1297062077498960", ig_asset_id: "", ig_user_id: "17841456620568454", ig_username: "puzzleofficialuk", is_owned_by_bm: true }],
    bms: [],
    artistRows: [],
  });
}

const LIVE_DOD: LiveIdentity = {
  campaignId: "120251748789350755",
  readAt: "2026-11-24T15:02:00.000Z",
  page: { id: "259905047197071", name: "NX LOVES", count: 9, otherClient: false },
  instagram: { id: "17841460869627228", name: "nxloves", count: 9, otherClient: false },
  draftNames: {
    "1157874844068425": "Ironworks London",
    "17841456620568454": "puzzleofficialuk",
    "900000000000001": "NX Newcastle",
    "17840000000000001": "nxnewcastle",
  },
};

function publishedDod(page: string, ig: string): CampaignDraft {
  const d = dodDraft();
  return {
    ...d,
    status: "published",
    metaCampaignId: LIVE_DOD.campaignId,
    settings: { ...d.settings, metaPageId: page, metaIGAccountId: ig },
    creatives: d.creatives.map((creative) => ({
      ...creative,
      identity: { pageId: page, instagramAccountId: ig, instagramActorId: ig },
    })),
  };
}

function rcI(kept: boolean): LaunchChecksFrameView {
  let d = publishedDod("900000000000001", "17840000000000001");
  if (kept) {
    const at = new Date("2026-11-24T15:06:00Z");
    d = keepIdentity(d, "page", "900000000000001", "NX Newcastle", "Matas", at);
    d = keepIdentity(d, "instagram", "17840000000000001", "nxnewcastle", "Matas", at);
  }
  return {
    result: checkLaunchReferences(d, NX26_DOD, venueDefaultsFromMap(NX26_DOD), [], dodOwnership(d), LIVE_DOD),
    keptLines: keptIdentityLines(d),
  };
}

export interface LaunchChecksFrameView {
  result: LaunchGuardResult;
  /** "Link kept by …" lines under the list. */
  keptLines: string[];
}

export function launchChecksFrameView(id: LaunchChecksFrameId): LaunchChecksFrameView {
  if (id === "RC-C-venue") {
    const d = keepLink(brixtonDraft(), "https://ra.co/events/2210442", "Matas", new Date("2026-11-24T16:40:00Z"));
    return { result: checkLaunchReferences(d, BRIXTON_SHOW, venueDefaultsFromMap(BRIXTON_SHOW), OTHERS), keptLines: keptLinkLines(d) };
  }
  if (id === "RC-H") {
    const d = publishedDod("1157874844068425", "17841456620568454");
    return {
      result: checkLaunchReferences(d, NX26_DOD, venueDefaultsFromMap(NX26_DOD), [], dodOwnership(d), LIVE_DOD),
      keptLines: [],
    };
  }
  if (id === "RC-I") return rcI(false);
  if (id === "RC-I-kept") return rcI(true);
  if (id === "RC-C2") {
    const d = dodDraft();
    return {
      result: checkLaunchReferences(d, NX26_DOD, venueDefaultsFromMap(NX26_DOD), [], dodOwnership(d)),
      keptLines: [],
    };
  }
  return { result: launchChecksFrame(id), keptLines: [] };
}

export function launchChecksFrame(id: LaunchChecksFrameId): LaunchGuardResult {
  if (id !== "RC-C" && id !== "RC-C-clean") return launchChecksFrameView(id).result;
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
