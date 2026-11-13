"use client";

import { CaptionOverlay } from "@/components/dashboard/events/creative-lab/caption-overlay";
import { PLACE_REFUSAL, PLACEMENT_HOME, PLACEMENT_STEP } from "@/lib/creative-lab/caption-placement";

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
export function PlacementFrameMount({ id }: { id: string }) {
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
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">Placed at today's spot</p>
      )}
    </div>
  );
}
