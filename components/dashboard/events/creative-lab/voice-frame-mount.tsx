"use client";

import type { CreativeLabCardData } from "@/lib/db/creative-lab";
import { extractTraits, type VoiceSample } from "@/lib/creative-lab/voice-traits";
import { PUZZLE_SAMPLES, PUZZLE_VENUES } from "@/lib/creative-lab/voice-fixtures";
import type { CardVoice, CardVoicePage } from "@/lib/creative-lab/voice-store";
import { LabCaptions } from "./captions";

const NOW = "2026-11-10T09:12:00.000Z";
const READ_TODAY = NOW;
const ENZO_READ = "2026-11-06T12:00:00.000Z";
/** 10 Oct is a Saturday. The frame clock is 10 Nov so this read is past 30 days. */
const STALE_READ = "2026-10-10T12:00:00.000Z";

function page(args: {
  handle: string | null;
  samples: VoiceSample[];
  error: string | null;
  fetchedAt: string | null;
}): CardVoicePage {
  const ready = args.samples.length >= 8 && !args.error;
  return {
    handle: args.handle,
    sampleN: args.samples.length,
    fetchedAt: args.fetchedAt,
    error: args.error,
    traits: ready ? extractTraits(args.samples, PUZZLE_VENUES) : null,
    exemplars: args.samples,
  };
}

function artist(args: { id: string; name: string; handle: string | null; rights?: "missing" | "approved" }) {
  return {
    id: args.id,
    name: args.name,
    rightsDocRef: null,
    startingCaption: null,
    metaPageId: null,
    instagramActorId: null,
    playedCities: [],
    clipFolderUrl: null,
    clipSource: "manual",
    clipFolderLastError: null,
    igLastError: null,
    igUsername: args.handle,
    pronouns: null,
    igCandidates: [],
    rights: args.rights ?? "approved",
    rightsLabel: args.rights === "missing" ? "Promoter page only" : "Cleared — artist channels too",
  };
}

function lab(args: { voice: CardVoice; artists: ReturnType<typeof artist>[] }): CreativeLabCardData {
  return {
    eventId: "frame-event",
    eventName: "Frame",
    eventDate: "2026-11-20",
    venueName: "The Cause",
    eventStatus: "on_sale",
    clientName: "Puzzle",
    clientId: "frame-client",
    voice: args.voice,
    launchesEnabled: false,
    saleDatesMissing: false,
    longApproved: false,
    paydayLabel: "",
    daysToEvent: 12,
    now: NOW,
    facts: { lineup: ["Enzo Siragusa"], headliners: [], allowedDates: [] },
    artists: args.artists,
    clips: [],
    captions: [],
    rounds: [],
    captionStyles: [],
  } as unknown as CreativeLabCardData;
}

const puzzle = page({ handle: "puzzle", samples: PUZZLE_SAMPLES, error: null, fetchedAt: READ_TODAY });
const enzoSamples: VoiceSample[] = Array.from({ length: 30 }, (_, index) => ({
  igMediaId: `enzo-${index}`,
  caption: `Set ${index + 1}.`,
  postedAt: ENZO_READ,
  likes: 10,
  comments: 0,
  permalink: `https://www.instagram.com/p/enzo-${index}/`,
}));
const enzo = page({ handle: "enzosiragusa", samples: enzoSamples, error: null, fetchedAt: ENZO_READ });
const reeshy = page({
  handle: "reeshy",
  samples: PUZZLE_SAMPLES.slice(0, 2),
  error: null,
  fetchedAt: READ_TODAY,
});
const phill = page({ handle: "philldejaneiro", samples: enzoSamples, error: null, fetchedAt: STALE_READ });

const puzzleLab = lab({
  artists: [artist({ id: "enzo", name: "Enzo Siragusa", handle: "enzosiragusa" })],
  voice: { clientId: "frame-client", hashtagsEnabled: false, promoter: puzzle, artists: [{ id: "enzo", ...enzo }] },
});
const enzoLab = lab({
  artists: [artist({ id: "enzo", name: "Enzo Siragusa", handle: "enzosiragusa" })],
  voice: { clientId: "frame-client", hashtagsEnabled: false, promoter: puzzle, artists: [{ id: "enzo", ...enzo }] },
});
const emptyLab = lab({
  artists: [artist({ id: "enzo", name: "Enzo Siragusa", handle: "puzzle" })],
  voice: { clientId: "frame-client", hashtagsEnabled: false, promoter: page({ handle: "puzzle", samples: [], error: null, fetchedAt: null }), artists: [] },
});
const lukeLab = lab({
  artists: [artist({ id: "luke", name: "Luke Dean", handle: "lukedean", rights: "missing" })],
  voice: {
    clientId: "frame-client",
    hashtagsEnabled: false,
    promoter: puzzle,
    artists: [{ id: "luke", ...page({ handle: "lukedean", samples: [], error: "not a business or creator account", fetchedAt: null }) }],
  },
});
const reeshyLab = lab({
  artists: [artist({ id: "reeshy", name: "Reeshy", handle: "reeshy" })],
  voice: { clientId: "frame-client", hashtagsEnabled: false, promoter: puzzle, artists: [{ id: "reeshy", ...reeshy }] },
});
const benjiLab = lab({
  artists: [artist({ id: "benji", name: "Benji King", handle: null })],
  voice: { clientId: "frame-client", hashtagsEnabled: false, promoter: puzzle, artists: [{ id: "benji", ...page({ handle: null, samples: [], error: null, fetchedAt: null }) }] },
});
const phillLab = lab({
  artists: [artist({ id: "phill", name: "Phill De Janeiro", handle: "philldejaneiro" })],
  voice: { clientId: "frame-client", hashtagsEnabled: false, promoter: puzzle, artists: [{ id: "phill", ...phill }] },
});

function noop() {
  return Promise.resolve({ ok: true, json: {} });
}

function Strip({
  data,
  angle,
  artistId,
  open = false,
  ownerAngles = false,
}: {
  data: CreativeLabCardData;
  angle: "lineup" | "artist_first_person" | "artist";
  artistId: string;
  open?: boolean;
  ownerAngles?: boolean;
}) {
  return (
    <LabCaptions
      lab={data}
      busy={false}
      onSave={noop}
      quoteMode
      initialAngle={angle}
      initialArtistId={artistId}
      initialVoiceOpen={open}
      voiceContained
      ownerAngles={ownerAngles}
    />
  );
}

export function VoiceFrameMount({ id }: { id: string }) {
  if (id === "CLV1") {
    return (
      <div data-frame-ready={id} className="relative bg-background p-4 max-[700px]:p-3">
        <div className="space-y-3 max-[700px]:hidden">
          <Strip data={puzzleLab} angle="lineup" artistId="enzo" />
          <Strip data={enzoLab} angle="artist" artistId="enzo" ownerAngles />
        </div>
        <div className="hidden max-[700px]:block">
          <Strip data={puzzleLab} angle="lineup" artistId="enzo" />
        </div>
      </div>
    );
  }
  if (id === "CLV2") {
    return (
      <div data-frame-ready={id} className="relative h-[1046px] overflow-hidden bg-background max-[700px]:h-[852px]">
        <div className="p-4 max-[700px]:p-3 min-[701px]:pr-[440px]">
          <Strip data={puzzleLab} angle="lineup" artistId="enzo" open />
        </div>
      </div>
    );
  }
  if (id === "CLV3") {
    return (
      <div data-frame-ready={id} className="relative bg-background min-[701px]:h-[523px] max-[700px]:min-h-0">
        <div className="p-4 max-[700px]:hidden min-[701px]:pr-[440px]">
          <Strip data={emptyLab} angle="lineup" artistId="enzo" open />
        </div>
        <div className="hidden p-3 max-[700px]:block">
          <Strip data={emptyLab} angle="lineup" artistId="enzo" />
        </div>
      </div>
    );
  }
  return (
    <div data-frame-ready={id} className="relative bg-background p-4 max-[700px]:p-3">
      <div className="max-[700px]:hidden">
        <Strip data={lukeLab} angle="artist" artistId="luke" ownerAngles />
        <p className="mt-4 font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">Empty feed</p>
        <Strip data={reeshyLab} angle="artist" artistId="reeshy" ownerAngles />
        <p className="mt-4 font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">No handle</p>
        <Strip data={benjiLab} angle="artist" artistId="benji" ownerAngles />
        <p className="mt-4 font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">Read, but stale</p>
        <Strip data={phillLab} angle="artist" artistId="phill" ownerAngles />
      </div>
      <div className="hidden max-[700px]:block">
        <Strip data={lukeLab} angle="artist" artistId="luke" ownerAngles />
      </div>
    </div>
  );
}
