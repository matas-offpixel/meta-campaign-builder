"use client";

import { EditWindowPicker, RefusalBlock } from "@/components/dashboard/events/creative-lab/edit-window";
import { windowState } from "@/lib/creative-lab/edit-window";
import { VW_B_CLIPS, XMPL_CLIP_07 } from "@/scripts/plan-frames/video-window-fixtures";

/**
 * VW-A (the window picker on XMPL clip 07, detected window) and VW-B (one
 * clip per VW3 refusal) from fixtures, at the width the runner opens.
 * Nothing is saved. data-frame-ready carries the shot's frame, which
 * scripts/plan-frames/run.mjs waits for.
 */
export function VideoWindowFrameMount({ id }: { id: string }) {
  if (id === "VW-A") {
    return (
      <main data-frame-ready="video-window/VW-A" className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <EditWindowPicker clipName={XMPL_CLIP_07.name} drops={XMPL_CLIP_07.drops} choice={XMPL_CLIP_07.choice} />
      </main>
    );
  }
  return (
    <main data-frame-ready="video-window/VW-B" className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="max-w-[640px] divide-y divide-border rounded border border-border bg-card px-3 text-sm">
        {VW_B_CLIPS.map((clip) => {
          const state = windowState(clip.drops, clip.choice);
          if (state.kind !== "refused") return null;
          return (
            <div key={clip.name} className="py-3">
              <RefusalBlock chip={state.chip} sentence={state.sentence} useDropS={state.useDrop?.tS ?? null} />
            </div>
          );
        })}
      </div>
    </main>
  );
}
