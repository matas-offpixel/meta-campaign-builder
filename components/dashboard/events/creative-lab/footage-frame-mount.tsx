"use client";

import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { wrapCaption } from "@/lib/creative-lab/caption-facts";
import { PUZZLE_SAMPLES, PUZZLE_VENUES } from "@/lib/creative-lab/voice-fixtures";
import { extractTraits } from "@/lib/creative-lab/voice-traits";
import type { CardVoice } from "@/lib/creative-lab/voice-store";
import { profile } from "../../../../src/remotion/caption-style/profile";

import { labStripProps } from "@/components/dashboard/events/creative-lab-card";
import { LabCaptions } from "./captions";
import { LabClips } from "./clips";
import { LabStrip } from "./strip";

const NOW = "2026-11-10T09:12:00.000Z";
const ENZO = "enzo";
const LUKE = "luke";
const POSTER_916 = "/frames/fixtures/clip-916.webm";
const POSTER_169 = "/frames/fixtures/clip-169.webm";

function promoterCandidate(n: number): NonNullable<CreativeLabCardData["promoterCandidates"]>[number] {
  return {
    id: `puzzle-reel-${n}`,
    igMediaId: `puzzle-media-${n}`,
    permalink: null,
    postedAt: `2026-11-${String(10 - (n % 8)).padStart(2, "0")}`,
    likes: 1400 - n * 120,
    comments: 48 - n * 4,
    score: 9 - n,
    aspect: "9:16",
    hasFile: true,
    audioMatch: true,
    status: "candidate",
    reason: null,
    thumbnailUrl: n % 2 === 0 ? POSTER_169 : POSTER_916,
    lengthSeconds: 12 + n,
    overlayOpen: false,
    overlay: null,
  };
}

const PUZZLE_CANDIDATES = [1, 2, 3, 4, 5, 6, 7, 8].map(promoterCandidate);

function artist(id: string, name: string, handle: string) {
  return {
    id,
    name,
    rightsDocRef: null,
    startingCaption: null,
    metaPageId: null,
    instagramActorId: null,
    playedCities: [],
    clipFolderUrl: null,
    clipSource: "instagram",
    clipFolderLastError: null,
    igLastError: null,
    igUsername: handle,
    pronouns: id === LUKE ? "he/him" : null,
    igCandidates: [],
    rights: "approved" as const,
    rightsLabel: "✓ Cleared — artist channels too",
  };
}

function clip(id: string, artistId: string, name: string, clipNo: number, seconds: number, source: string): CreativeLabCardData["clips"][number] {
  return {
    id,
    artistId,
    clipNo,
    source,
    rightsRef: "frame",
    filmedEventId: null,
    durationSeconds: seconds,
    inS: 0,
    outS: seconds,
    sourceWidth: 1080,
    sourceHeight: 1920,
    billingOrder: clipNo,
    isHeadliner: true,
    thumbnailUrl: null,
    storagePath: null,
    previewUrl: null,
    hasFile: false,
    artistName: name,
    owner: "artist",
    featuredArtistIds: [],
    cleared: true,
    renderError: null,
    judged: null,
    audioMatch: null,
    hasAudio: true,
    cropFocusX: 0.5,
    cropOpen: false,
  };
}

const enzoClips = [14, 22, 18, 16, 20].map((seconds, index) => clip(`enzo-${index + 1}`, ENZO, "Enzo Siragusa", index + 1, seconds, "instagram"));
const lukeClips = Array.from({ length: 21 }, (_, index) => {
  const clipNo = index + 1;
  const seconds = clipNo === 1 ? 11 : clipNo === 2 ? 9 : clipNo === 21 ? 16 : 12;
  const source = clipNo === 21 ? "instagram" : "presskit";
  return clip(`luke-${clipNo}`, LUKE, "Luke Dean", clipNo, seconds, source);
});
const clips = [...enzoClips, ...lukeClips];
const unselected = new Set(["enzo-3", "enzo-4", "enzo-5", "luke-19", "luke-20"]);

function caption(id: string, style: string, lines: string[], extra: Partial<CreativeLabCardData["captions"][number]> = {}): CreativeLabCardData["captions"][number] {
  return {
    id,
    style,
    status: "proposed",
    lines,
    primaryText: "",
    sizeVariant: "short",
    validatorOk: true,
    validatorDetail: "",
    awaitingLong: false,
    ...extra,
  };
}

/** Same width choice as validateCaption: the style profile's line, then the long width when that does not fit. */
function writerCaptionLines(text: string, names: readonly string[]): string[] {
  const width = profile.charsPerLine;
  const wrapped = wrapCaption(text, width, names);
  const useLong =
    text.trim().length >= profile.long.minChars
    || wrapped.length > profile.maxLines
    || wrapped.some((line) => line.length > width && line.includes(" "));
  return useLong ? wrapCaption(text, profile.long.charsPerLine, names) : wrapped;
}

const ARTIST_CAPTION = "Luke Dean. Back at Circuit for Puzzle's 4th birthday.";
const ARTIST_NAMES = ["Enzo Siragusa", "Luke Dean", "Puzzle 4th Birthday", "Circuit", "Southampton"];

const lineup = Array.from({ length: 20 }, (_, index) => caption(
  `line-${index + 1}`,
  "lineup",
  index === 0 ? ["Luke Dean. At Circuit. 27 December."] : ["Puzzle turns 4. Lineup drops Monday."],
));

const voice: CardVoice = {
  clientId: "frame-client",
  hashtagsEnabled: false,
  promoter: {
    handle: "puzzle",
    sampleN: PUZZLE_SAMPLES.length,
    fetchedAt: NOW,
    error: null,
    traits: extractTraits(PUZZLE_SAMPLES, PUZZLE_VENUES),
    exemplars: PUZZLE_SAMPLES,
  },
  artists: [],
};

function puzzle(): CreativeLabCardData {
  return {
    eventId: "frame-event",
    clientId: "frame-client",
    eventName: "Puzzle 4th Birthday",
    eventDate: "2026-12-27",
    venueName: "Circuit",
    eventStatus: "on_sale",
    clientName: "Puzzle",
    clientHandle: "puzzle",
    voice,
    launchesEnabled: false,
    saleDatesMissing: false,
    longApproved: false,
    paydayLabel: "",
    daysToEvent: 47,
    now: NOW,
    facts: { lineup: ["Enzo Siragusa", "Luke Dean"], headliners: ["Luke Dean"], allowedDates: [] },
    artists: [artist(ENZO, "Enzo Siragusa", "enzosiragusa"), artist(LUKE, "Luke Dean", "lukedean")],
    clips,
    renders: [],
    assets: [],
    clientEvents: [],
    captions: [
      caption("about-luke", "artist", writerCaptionLines(ARTIST_CAPTION, ARTIST_NAMES), { clipId: "luke-1", artistId: LUKE, sizeVariant: "default" }),
      lineup[0]!,
      caption("luke-quote", "quote", ["Back in Southampton for this one. The room, the people, the night. That's Puzzle."], {
        mode: "quote",
        artistId: LUKE,
        quoteSource: "typed",
        quoteSourceNote: "typed verbatim",
        quoteWeight: 700,
      }),
      ...lineup.slice(1),
    ],
    adSets: [],
    adAccountId: null,
    rounds: [],
    lineupRows: [
      { artistId: "lib-enzo", name: "Enzo Siragusa", isHeadliner: false, imageUrl: null, instagramHandle: "enzosiragusa", tiktokHandle: null, spotifyId: null, metaPageId: null, genres: [], enrichedAt: null, playedBefore: [], labArtistId: ENZO, clearedAt: "2026-11-09", clearedBy: null, rightsNote: null, clipCount: 5, spotifyCandidates: [] },
      { artistId: "lib-luke", name: "Luke Dean", isHeadliner: true, imageUrl: null, instagramHandle: "lukedean", tiktokHandle: null, spotifyId: null, metaPageId: null, genres: [], enrichedAt: null, playedBefore: [], labArtistId: LUKE, clearedAt: "2026-11-09", clearedBy: null, rightsNote: null, clipCount: 21, spotifyCandidates: [] },
    ],
    working: null,
    clipSelection: {
      mode: "chosen",
      rows: clips.map((item) => ({ clipId: item.id, selected: !unselected.has(item.id) })),
    },
  };
}

function noop() {
  return Promise.resolve({ ok: true, json: {} });
}

export function FootageFrameMount({ id }: { id: string }) {
  const lab = puzzle();
  if (id === "CLW1" || id === "CLW1b") {
    const shown = id === "CLW1b" ? { ...lab, promoterCandidates: PUZZLE_CANDIDATES } : lab;
    return (
      <div data-frame-ready={id} className="bg-background p-4 text-sm max-[700px]:p-3">
        <LabClips lab={shown} busy={false} onSave={noop} onError={() => undefined} intake={false} layout="owner" />
      </div>
    );
  }
  if (id === "CLW2") {
    const shown = {
      ...lab,
      clips: lab.clips.map((item) => (item.id === "luke-1" ? { ...item, previewUrl: POSTER_916 } : item)),
    };
    return (
      <div data-frame-ready={id} className="bg-background p-4 text-sm max-[700px]:p-3">
        <LabCaptions lab={shown} busy={false} onSave={noop} quoteMode ownerAngles initialAngle="artist" initialArtistId={LUKE} />
      </div>
    );
  }
  return (
    <div data-frame-ready={id} className="bg-background p-4 text-sm max-[700px]:p-3">
      <LabStrip {...labStripProps(lab, true)} />
    </div>
  );
}
