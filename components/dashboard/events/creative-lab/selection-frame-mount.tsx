"use client";

import type { CreativeLabCardData } from "@/lib/db/creative-lab";

import { LabCaptions } from "./captions";
import { LabClips } from "./clips";
import { LabRound } from "./round";

const NOW = "2026-11-09T12:00:00.000Z";

function tile(id: string, name: string, clipNo: number, cant = false): CreativeLabCardData["clips"][number] {
  return {
    id,
    artistId: name.startsWith("Enzo") ? "enzo" : id,
    clipNo,
    source: "instagram",
    rightsRef: "frame",
    filmedEventId: null,
    durationSeconds: 18,
    inS: 0,
    outS: 18,
    sourceWidth: 1080,
    sourceHeight: 1920,
    billingOrder: clipNo,
    isHeadliner: true,
    thumbnailUrl: null,
    storagePath: null,
    previewUrl: null,
    hasFile: false,
    artistName: name,
    cleared: true,
    renderError: cant ? "Too low after the crop — 540 px wide" : null,
    judged: null,
    audioMatch: null,
    cropFocusX: 0.5,
    cropOpen: false,
  };
}

const usable = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => tile(`enzo-${n}`, "Enzo Siragusa", n)),
  tile("luke-1", "Luke Dean", 1),
  tile("reeshy-1", "Reeshy", 1),
];
const clips = [...usable, tile("benji-1", "Benji King", 1, true)];
const selected = ["enzo-1", "enzo-2", "enzo-5", "enzo-7"];

function lab(extra: Partial<CreativeLabCardData> = {}): CreativeLabCardData {
  return {
    eventId: "frame-event",
    clientId: null,
    eventName: "Puzzle 4th Birthday",
    eventDate: "2026-12-27",
    venueName: "Circuit",
    eventStatus: "on_sale",
    clientName: "Puzzle",
    voice: null,
    launchesEnabled: false,
    saleDatesMissing: false,
    longApproved: false,
    paydayLabel: "",
    daysToEvent: 40,
    now: NOW,
    facts: null,
    artists: [{
      id: "enzo",
      name: "Enzo Siragusa",
      rightsDocRef: null,
      startingCaption: null,
      metaPageId: null,
      instagramActorId: null,
      playedCities: [],
      clipFolderUrl: null,
      clipSource: "instagram",
      clipFolderLastError: null,
      igLastError: null,
      igUsername: "enzosiragusa",
      pronouns: null,
      igCandidates: [],
      rights: "approved",
      rightsLabel: "Cleared — artist channels too",
    }],
    clips,
    renders: [],
    assets: [],
    clientEvents: [],
    captions: [],
    adSets: [{ metaAdSetId: "set-1", adAccountId: "act", name: "Ad set", status: "recorded", adCount: 0, cap: 50 }],
    adAccountId: null,
    rounds: [],
    lineupRows: [],
    working: null,
    clipSelection: {
      mode: "chosen",
      rows: usable.map((clip) => ({ clipId: clip.id, selected: selected.includes(clip.id) })),
    },
    ...extra,
  } as CreativeLabCardData;
}

const captions = [
  { id: "at", style: "lineup", status: "approved", lines: ["at Circuit"], primaryText: "Who's coming?", sizeVariant: "short", validatorOk: true, validatorDetail: "", awaitingLong: false, clipId: "enzo-1" },
  { id: "turns", style: "lineup", status: "approved", lines: ["turns 4"], primaryText: "Who's coming?", sizeVariant: "short", validatorOk: true, validatorDetail: "", awaitingLong: false, clipId: "enzo-1" },
  { id: "more", style: "lineup", status: "approved", lines: ["& more"], primaryText: "Who's coming?", sizeVariant: "short", validatorOk: true, validatorDetail: "", awaitingLong: false, clipId: "enzo-1" },
];

function candidate(id: string, likes: number): CreativeLabCardData["artists"][number]["igCandidates"][number] {
  return {
    id,
    igMediaId: id,
    permalink: null,
    postedAt: "2026-11-01",
    likes,
    comments: 100,
    score: likes,
    aspect: "9:16",
    hasFile: true,
    audioMatch: null,
    status: "new",
    reason: null,
    thumbnailUrl: null,
    lengthSeconds: 18,
    overlayOpen: false,
    overlay: null,
  };
}

export function SelectionFrameMount({ id }: { id: string }) {
  const quiet = async () => ({ ok: true, json: {} });
  if (id === "CLS1") {
    return (
      <div data-frame-ready={id} className="bg-background p-4 text-foreground">
        <LabClips lab={lab()} busy={false} intake={false} onSave={quiet} onError={() => undefined} />
      </div>
    );
  }
  if (id === "CLS2") {
    const card = lab({ captions: captions.slice(0, 1) });
    return (
      <div data-frame-ready={id} className="space-y-4 bg-background p-4 text-foreground">
        <LabCaptions lab={card} busy={false} onSave={quiet} />
        <div className="max-[700px]:hidden">
          <LabCaptions lab={card} busy={false} onSave={quiet} initialPair="each" />
        </div>
      </div>
    );
  }
  if (id === "CLS3") {
    return (
      <div data-frame-ready={id} className="bg-background p-4 text-foreground">
        <LabRound lab={lab({ captions })} busy={false} onSave={quiet} onLaunch={async () => undefined} initialOff={["enzo-2:more"]} />
      </div>
    );
  }
  const finding = lab({
    artists: [{
      ...lab().artists[0]!,
      igCandidates: [candidate("cand-1", 4210), candidate("cand-2", 3980)],
    }],
  });
  return (
    <div data-frame-ready={id} className="space-y-4 bg-background p-4 text-foreground">
      <LabClips lab={finding} busy={false} intake={false} showTiles={false} pendingFind pendingImportId="cand-1" onSave={quiet} onError={() => undefined} />
      <LabCaptions lab={lab()} busy={false} onSave={quiet} pendingWrite />
    </div>
  );
}
