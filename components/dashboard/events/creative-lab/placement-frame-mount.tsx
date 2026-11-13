"use client";

import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { RenderRows } from "@/components/dashboard/events/creative-lab/render-rows";
import { LabRound } from "@/components/dashboard/events/creative-lab/round";
import { FACE_CHECK_FAILED, FACE_CHECKING, PLACE_REFUSAL, PLACEMENT_HOME, PLACEMENT_STEP } from "@/lib/creative-lab/caption-placement";
import type { CreativeLabCardData } from "@/lib/db/creative-lab";

const LINES = ["pov: the drop", "you waited all", "night for", "finally lands"];

const STATES = {
  CLP1: { step: 0, scale: 1, note: null as string | null },
  CLP2: { step: -3, scale: 1, note: "Moved up to keep off the face" },
  CLP3: { step: 1, scale: 1, note: "Moved down to keep off the face" },
  CLP4: { step: -6, scale: 0.85, note: "Moved up and smaller to keep off the face — 85 %" },
  CLP5: { step: 0, scale: 1, note: PLACE_REFUSAL.caption },
} as const;

/**
 * CLP1–CLP5. The preview's block is the place the render stores.
 * CLP5 is the refusal, with no type.
 */
const NOW = "2026-11-13T12:00:00.000Z";

function faceCard(failed: boolean): CreativeLabCardData {
  const note = failed ? FACE_CHECK_FAILED : FACE_CHECKING;
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
    longApproved: true,
    paydayLabel: "",
    daysToEvent: 40,
    now: NOW,
    facts: null,
    artists: [],
    clips: [{
      id: "enzo-1",
      artistId: "enzo",
      clipNo: 1,
      source: "instagram",
      rightsRef: "frame",
      filmedEventId: null,
      durationSeconds: 18,
      inS: 0,
      outS: 18,
      sourceWidth: 1080,
      sourceHeight: 1920,
      billingOrder: 1,
      isHeadliner: true,
      thumbnailUrl: null,
      storagePath: null,
      previewUrl: null,
      hasFile: true,
      artistName: "Enzo",
      cleared: true,
      renderError: null,
      judged: null,
      audioMatch: null,
      cropFocusX: 0.5,
      cropOpen: false,
      faceCheck: failed ? "failed" : "checking",
    }],
    renders: [{
      id: "render-1",
      clipId: "enzo-1",
      captionId: "cap",
      label: "Enzo #1 × lineup",
      status: "queued",
      error: null,
      renderMs: null,
      updatedAt: NOW,
      previewUrl: null,
      posterUrl: null,
      clipPreviewUrl: null,
      lines: [],
      playing: false,
      roundOpen: true,
      placementNote: note,
      faceFailed: failed,
    }],
    assets: [],
    clientEvents: [],
    captions: [{
      id: "cap",
      style: "lineup",
      status: "approved",
      lines: ["pov: the drop"],
      primaryText: "",
      sizeVariant: "default",
      validatorOk: true,
      validatorDetail: "",
      awaitingLong: false,
      mode: "caption",
      clipId: null,
    }],
    adSets: [{ metaAdSetId: "set-1", adAccountId: "act", name: "Ad set", status: "recorded", adCount: 0, cap: 50 }],
    adAccountId: null,
    rounds: [],
    lineupRows: [],
    working: null,
  } as CreativeLabCardData;
}

function FaceStateFrame({ id, failed }: { id: string; failed: boolean }) {
  const card = faceCard(failed);
  const quiet = async () => ({ ok: true, json: {} });
  return (
    <div data-frame-ready={id} className="space-y-4 bg-background p-3 text-foreground sm:p-4">
      <RenderRows rows={card.renders} now={card.now} clips={card.clips} />
      <LabRound lab={card} busy={false} onSave={quiet} onLaunch={async () => undefined} />
    </div>
  );
}

export function PlacementFrameMount({ id }: { id: string }) {
  if (id === "CLP6" || id === "CLP7") return <FaceStateFrame id={id} failed={id === "CLP7"} />;
  const state = STATES[id as keyof typeof STATES];
  if (!state) return null;
  const refused = id === "CLP5";
  const centre = (PLACEMENT_HOME + state.step * PLACEMENT_STEP) / 1920;
  return (
    <div data-frame-ready={id} className="bg-background p-3 text-foreground sm:p-4">
      <div className="w-[180px]">
        <CaptionOverlay
          lines={refused ? [] : LINES}
          placementCenter={centre}
          placementScale={state.scale}
        />
      </div>
      {state.note ? (
        <p className={`mt-2 font-mono text-[11px] ${refused ? "text-destructive" : "text-muted-foreground"}`}>{state.note}</p>
      ) : null}
    </div>
  );
}
