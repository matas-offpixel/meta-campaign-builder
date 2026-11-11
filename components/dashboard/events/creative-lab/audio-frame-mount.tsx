"use client";

import type { CreativeLabCardData } from "@/lib/db/creative-lab";

const CLIP = "/frames/fixtures/clip-916.webm";

import { FeedPost } from "./captions";
import { LabClips } from "./clips";
import { RenderRows } from "./render-rows";

const NOW = "2026-11-09T12:00:00.000Z";

function tile(id: string, name: string, clipNo: number): CreativeLabCardData["clips"][number] {
  return {
    id,
    artistId: "enzo",
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
    storagePath: "frames/clip-916.webm",
    previewUrl: CLIP,
    hasFile: true,
    artistName: name,
    cleared: true,
    renderError: null,
    judged: null,
    audioMatch: null,
    cropFocusX: 0.5,
    cropOpen: false,
  };
}

const clips = [1, 2, 3, 4].map((n) => tile(`enzo-${n}`, "Enzo Siragusa", n));

function lab(): CreativeLabCardData {
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
    renders: [{
      id: "render-1",
      clipId: "enzo-1",
      captionId: "line",
      label: "Enzo Siragusa #1 × lineup",
      status: "done",
      error: null,
      renderMs: 180000,
      updatedAt: NOW,
      previewUrl: CLIP,
      posterUrl: null,
      clipPreviewUrl: null,
      lines: ["Enzo Siragusa", "at Circuit"],
      playing: true,
      roundOpen: true,
    }],
    assets: [],
    clientEvents: [],
    captions: [{
      id: "line",
      style: "lineup",
      status: "proposed",
      lines: ["Enzo Siragusa", "at Circuit"],
      primaryText: "Who's coming?",
      sizeVariant: "short",
      validatorOk: true,
      validatorDetail: "",
      awaitingLong: false,
      clipId: "enzo-1",
    }],
    adSets: [],
    adAccountId: null,
    rounds: [],
    lineupRows: [],
    working: null,
    clipSelection: { mode: "chosen", rows: clips.map((clip) => ({ clipId: clip.id, selected: true })) },
  };
}

export function AudioFrameMount({ id }: { id: string }) {
  const quiet = async () => ({ ok: true, json: {} });
  const card = lab();
  if (id === "CLA1") {
    return (
      <div data-frame-ready={id} className="bg-background p-4 text-foreground">
        <LabClips lab={card} busy={false} intake={false} audibleClipId="enzo-1" onSave={quiet} onError={() => undefined} />
      </div>
    );
  }
  const caption = card.captions[0]!;
  return (
    <div data-frame-ready={id} className="flex flex-col items-start gap-6 bg-background p-4 text-foreground sm:flex-row">
      <FeedPost lab={card} caption={caption} page="Puzzle" stage="on_sale" busy={false} onSave={quiet} />
      <div className="w-full sm:w-80">
        <RenderRows rows={card.renders} now={card.now} clips={card.clips} />
      </div>
    </div>
  );
}
