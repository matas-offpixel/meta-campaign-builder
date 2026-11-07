/**
 * Creative Lab card fixtures for the CL frame series. Every value is a
 * literal: no Supabase, no Meta / TikTok / Google, `launchesEnabled`
 * false (CREATIVE_LAB_LAUNCH_ENABLED unset). The expected figures are
 * listed in scripts/plan-frames/README.md so a PASS covers the maths.
 */

import type { CreativeLabCardData, LabLineupRow } from "../../lib/db/creative-lab.ts";
import { whatsWorking, type WorkingAd } from "../../lib/creative-lab/surface.ts";
import type { LabFrameId } from "./lab-ids.ts";

export type LabFrameFixture = {
  kind: "lab";
  id: LabFrameId;
  title: string;
  now: string;
  lab: CreativeLabCardData;
};

export const LAB_NOW = "2026-11-06T12:00:00.000Z";

export const LAB_CLIP_916 = "/frames/fixtures/clip-916.webm";
export const LAB_CLIP_169 = "/frames/fixtures/clip-169.webm";

const EVENT_ID = "fixture-event-cl";
const CLIENT = "Off Pixel Fixtures";

type Artist = CreativeLabCardData["artists"][number];
type Clip = CreativeLabCardData["clips"][number];
type Caption = CreativeLabCardData["captions"][number];
type Round = CreativeLabCardData["rounds"][number];
type RoundAd = Round["ads"][number];

function lineupRow(row: Partial<LabLineupRow> & Pick<LabLineupRow, "artistId" | "name">): LabLineupRow {
  return {
    isHeadliner: false,
    imageUrl: null,
    instagramHandle: null,
    tiktokHandle: null,
    spotifyId: null,
    metaPageId: null,
    genres: [],
    enrichedAt: null,
    playedBefore: [],
    labArtistId: null,
    clearedAt: null,
    clearedBy: null,
    rightsNote: null,
    clipCount: 0,
    spotifyCandidates: [],
    ...row,
  };
}

function artist(row: Partial<Artist> & Pick<Artist, "id" | "name">): Artist {
  return {
    rightsDocRef: null,
    startingCaption: null,
    metaPageId: null,
    instagramActorId: null,
    playedCities: [],
    clipFolderUrl: null,
    clipSource: "file",
    clipFolderLastError: null,
    igLastError: null,
    igCandidates: [],
    rights: "missing",
    rightsLabel: "Promoter page only",
    ...row,
  };
}

function clip(row: Partial<Clip> & Pick<Clip, "id" | "artistId" | "artistName" | "clipNo">): Clip {
  return {
    source: "file",
    rightsRef: "fixture",
    filmedEventId: null,
    durationSeconds: 18,
    inS: 0,
    outS: null,
    sourceWidth: 1080,
    sourceHeight: 1920,
    billingOrder: 0,
    isHeadliner: false,
    thumbnailUrl: null,
    storagePath: null,
    previewUrl: LAB_CLIP_916,
    hasFile: true,
    cleared: false,
    renderError: null,
    judged: null,
    ...row,
  };
}

function caption(row: Partial<Caption> & Pick<Caption, "id" | "style" | "lines">): Caption {
  return {
    status: "proposed",
    primaryText: "",
    sizeVariant: "default",
    validatorOk: true,
    validatorDetail: "",
    awaitingLong: false,
    ...row,
  };
}

function roundAd(row: Partial<RoundAd> & Pick<RoundAd, "id" | "clipId" | "captionId">): RoundAd {
  return {
    adName: row.id,
    role: "test",
    launchState: "ready",
    thumbnailUrl: null,
    metaAdId: null,
    adsManagerUrl: null,
    verdict: null,
    cost: null,
    results: null,
    metric: null,
    ...row,
  };
}

// ── The bill ────────────────────────────────────────────────────────────

const ADA = "lab-ada";
const BEA = "lab-bea";

/** 5 artists, 3 starred. Ada is cleared for artist channels; the rest are promoter page only. */
const LINEUP: LabLineupRow[] = [
  lineupRow({ artistId: "lib-ada", name: "Ada North", isHeadliner: true, instagramHandle: "adanorth", labArtistId: ADA, clearedAt: "2026-11-02T10:00:00.000Z", clearedBy: "Matas" }),
  lineupRow({ artistId: "lib-bea", name: "Bea Lowe", isHeadliner: true, instagramHandle: "bealowe", tiktokHandle: "bealowe", labArtistId: BEA }),
  lineupRow({ artistId: "lib-cal", name: "Cal Reyes", isHeadliner: true, instagramHandle: "calreyes" }),
  lineupRow({ artistId: "lib-dee", name: "Dee Marsh" }),
  lineupRow({ artistId: "lib-eli", name: "Eli Stone", instagramHandle: "elistone" }),
];

/** The two Lab artists: Ada cleared, Bea promoter page only. */
const ARTISTS: Artist[] = [
  artist({ id: ADA, name: "Ada North", rightsDocRef: "fixture-rights-ada", rights: "approved", rightsLabel: "Cleared — artist channels too", clipSource: "instagram" }),
  artist({ id: BEA, name: "Bea Lowe" }),
];

// ── Clips ───────────────────────────────────────────────────────────────

/** Native 9:16, 18 s. */
const C1 = clip({ id: "clip-ada-1", artistId: ADA, artistName: "Ada North", clipNo: 1, source: "instagram", durationSeconds: 18, isHeadliner: true, billingOrder: 0 });
/** Landscape 16:9, 24 s. Its 9:16 crop is 1080 × 9/16 = 607.5 px wide. */
const C2 = clip({ id: "clip-bea-1", artistId: BEA, artistName: "Bea Lowe", clipNo: 1, source: "file", durationSeconds: 24, sourceWidth: 1920, sourceHeight: 1080, previewUrl: LAB_CLIP_169, isHeadliner: true, billingOrder: 1 });
/** Native 9:16, 12 s. */
const C3 = clip({ id: "clip-ada-2", artistId: ADA, artistName: "Ada North", clipNo: 2, source: "tiktok", durationSeconds: 12, isHeadliner: true, billingOrder: 0 });

// ── Captions ────────────────────────────────────────────────────────────

/**
 * Lines are what validateCaption wraps the overlay into, which is what the
 * live card shows. No price in primary text: the live loader passes no
 * ticket tiers, so a price can never pass there.
 */
const LINEUP_LINES = ["Ada North Bea Lowe", "12 December", "Fixture Hall"];
const LINEUP_PRIMARY = "Ada North and Bea Lowe play Fixture Hall on 12 December.";
const POV_LINES = ["POV: lights drop", "and Ada North", "walks on"];

const CAP_LINEUP = caption({ id: "cap-lineup", style: "lineup", lines: LINEUP_LINES, primaryText: LINEUP_PRIMARY });
const CAP_POV = caption({ id: "cap-pov", style: "pov", lines: POV_LINES, primaryText: "12 December at Fixture Hall." });

// ── Ad set ──────────────────────────────────────────────────────────────

const AD_SET = { metaAdSetId: "fixture-adset-1", adAccountId: "act_fixture", name: "Fixture Night — signups", status: "ACTIVE", adCount: 0, cap: 50 as const };

/** Each artist row's clip count is that fixture's own clips for its Lab artist, never typed. */
function base(overrides: Partial<CreativeLabCardData>): CreativeLabCardData {
  const lab = baseFields(overrides);
  return {
    ...lab,
    lineupRows: lab.lineupRows.map((row) => ({
      ...row,
      clipCount: row.labArtistId ? lab.clips.filter((c) => c.artistId === row.labArtistId).length : 0,
    })),
  };
}

function baseFields(overrides: Partial<CreativeLabCardData>): CreativeLabCardData {
  return {
    eventId: EVENT_ID,
    eventName: "Fixture Night",
    eventDate: "2026-12-12",
    venueName: "Fixture Hall",
    eventStatus: "on_sale",
    clientName: CLIENT,
    launchesEnabled: false,
    saleDatesMissing: false,
    longApproved: false,
    paydayLabel: "Fri 27 Nov",
    daysToEvent: 36,
    now: LAB_NOW,
    facts: { lineup: [], headliners: [], allowedDates: ["2026-12-12"] },
    artists: [],
    clips: [],
    assets: [],
    clientEvents: [],
    captions: [],
    adSets: [AD_SET],
    adAccountId: "act_fixture",
    rounds: [],
    lineupRows: [],
    working: null,
    ...overrides,
  };
}

const FACTS = { lineup: LINEUP.map((row) => row.name), headliners: ["Ada North", "Bea Lowe", "Cal Reyes"], allowedDates: ["2026-12-12"] };

// ── CL5: round 1 proposed. 2 captions × 3 clips = 6 pairings; the harness
// turns Ada North #1 × POV off, so 5 are on and the draft holds those 5.

const ON_PAIRS: [Clip, Caption][] = [
  [C1, CAP_LINEUP],
  [C2, CAP_LINEUP],
  [C2, CAP_POV],
  [C3, CAP_LINEUP],
  [C3, CAP_POV],
];

const ROUND_1_DRAFT: Round = {
  id: "round-1",
  roundNo: 1,
  artistId: ADA,
  artistName: "Ada North",
  status: "draft",
  artistApproved: true,
  rendersPending: false,
  ads: ON_PAIRS.map(([c, cap], index) => roundAd({ id: `r1-ad-${index + 1}`, clipId: c.id, captionId: cap.id })),
};

// ── CL6: round 1 judged on signups.
//   Ada North #1 × Lineup  winner   £0.50 / signup × 40 = £20.00
//   Bea Lowe #1  × POV     flagged  £0.75 / signup × 20 = £15.00  (0.75 / 0.50 = 1.5×)
//   Ada North #2 × Lineup  untested
// Lineup pools to £20 / 40 = £0.50, POV to £15 / 20 = £0.75:
// (0.75 − 0.50) / 0.75 = 33.3% → "beat POV by 33%".

const SIGNUP = "complete_registration";

const JUDGED_ADS: RoundAd[] = [
  roundAd({ id: "r1-win", clipId: C1.id, captionId: CAP_LINEUP.id, launchState: "launched", metaAdId: "fixture-ad-1", verdict: "winner", cost: 0.5, results: 40, metric: SIGNUP }),
  roundAd({ id: "r1-flag", clipId: C2.id, captionId: CAP_POV.id, launchState: "launched", metaAdId: "fixture-ad-2", verdict: "flagged", cost: 0.75, results: 20, metric: SIGNUP }),
  roundAd({ id: "r1-untested", clipId: C3.id, captionId: CAP_LINEUP.id, launchState: "launched", metaAdId: "fixture-ad-3", verdict: "untested", cost: null, results: null, metric: SIGNUP }),
];

const ROUND_1_JUDGED: Round = { ...ROUND_1_DRAFT, status: "judged", ads: JUDGED_ADS };

const WORKING_ADS: WorkingAd[] = JUDGED_ADS.map((ad) => {
  const c = [C1, C2, C3].find((row) => row.id === ad.clipId)!;
  const cap = [CAP_LINEUP, CAP_POV].find((row) => row.id === ad.captionId)!;
  return { style: cap.style, roundId: ROUND_1_JUDGED.id, eventId: EVENT_ID, verdict: ad.verdict, cost: ad.cost, results: ad.results, clipNo: c.clipNo, artistName: c.artistName, roundNo: 1 };
});

// ── CL7: Ada North's Instagram, ranked by score.

const IG_CANDIDATES: Artist["igCandidates"] = [
  { igMediaId: "ig-1", permalink: null, postedAt: "2026-10-29", likes: 1200, comments: 40, score: 0.9, aspect: "9:16", hasFile: false, audioMatch: true, status: "candidate", reason: null },
  { igMediaId: "ig-2", permalink: null, postedAt: "2026-10-21", likes: 800, comments: 20, score: 0.6, aspect: "4:5", hasFile: false, audioMatch: null, status: "skipped", reason: "text overlay" },
  { igMediaId: "ig-3", permalink: null, postedAt: "2026-10-12", likes: 400, comments: 10, score: 0.3, aspect: "landscape", hasFile: false, audioMatch: false, status: "requested", reason: null },
  { igMediaId: "ig-4", permalink: null, postedAt: "2026-11-05", likes: 300, comments: 5, score: 0.2, aspect: "9:16", hasFile: true, audioMatch: true, status: "candidate", reason: null },
];

export const LAB_FRAME_FIXTURES: Record<LabFrameId, LabFrameFixture> = {
  CL1: {
    kind: "lab",
    id: "CL1",
    title: "Creative Lab — empty event",
    now: LAB_NOW,
    lab: base({ facts: null, adSets: [] }),
  },
  CL2: {
    kind: "lab",
    id: "CL2",
    title: "Creative Lab — lineup only",
    now: LAB_NOW,
    lab: base({ facts: FACTS, lineupRows: LINEUP, artists: ARTISTS }),
  },
  CL3: {
    kind: "lab",
    id: "CL3",
    title: "Creative Lab — clips and one proposed caption",
    now: LAB_NOW,
    lab: base({ facts: FACTS, lineupRows: LINEUP, artists: ARTISTS, clips: [C1, C2], captions: [CAP_LINEUP] }),
  },
  CL4: {
    kind: "lab",
    id: "CL4",
    title: "Creative Lab — caption with no primary text",
    now: LAB_NOW,
    lab: base({ facts: FACTS, lineupRows: LINEUP, artists: ARTISTS, clips: [C1, C2], captions: [{ ...CAP_LINEUP, primaryText: "" }] }),
  },
  CL5: {
    kind: "lab",
    id: "CL5",
    title: "Creative Lab — round 1 proposed, one pairing off",
    now: LAB_NOW,
    lab: base({
      facts: FACTS,
      lineupRows: LINEUP,
      artists: ARTISTS,
      clips: [C1, C2, C3],
      captions: [{ ...CAP_LINEUP, status: "approved" }, { ...CAP_POV, status: "approved" }],
      rounds: [ROUND_1_DRAFT],
    }),
  },
  CL6: {
    kind: "lab",
    id: "CL6",
    title: "Creative Lab — round 1 judged",
    now: LAB_NOW,
    lab: base({
      facts: FACTS,
      lineupRows: LINEUP,
      artists: ARTISTS,
      clips: [
        { ...C1, judged: { verdict: "winner", cost: 0.5, results: 40, metric: SIGNUP, roundNo: 1 } },
        { ...C2, judged: { verdict: "flagged", cost: 0.75, results: 20, metric: SIGNUP, roundNo: 1 } },
        { ...C3, judged: { verdict: "untested", cost: null, results: null, metric: SIGNUP, roundNo: 1 } },
      ],
      captions: [{ ...CAP_LINEUP, status: "approved" }, { ...CAP_POV, status: "approved" }],
      adSets: [{ ...AD_SET, adCount: 3 }],
      rounds: [ROUND_1_JUDGED],
      working: whatsWorking(WORKING_ADS, { clientName: CLIENT, eventId: EVENT_ID }),
    }),
  },
  CL7: {
    kind: "lab",
    id: "CL7",
    title: "Creative Lab — Instagram candidates",
    now: LAB_NOW,
    lab: base({
      facts: FACTS,
      lineupRows: LINEUP,
      artists: [{ ...ARTISTS[0]!, igCandidates: IG_CANDIDATES }, ARTISTS[1]!],
      clips: [C1],
    }),
  },
};

export function getLabFrame(id: string): LabFrameFixture | undefined {
  return LAB_FRAME_FIXTURES[id as LabFrameId];
}
