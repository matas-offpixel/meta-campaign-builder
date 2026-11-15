import { electric, locklead } from "@/lib/dashboard/audience-panels-fixture";
import { AUDIENCE_PANEL_FRAMES, type AudiencePanelFrameId } from "@/scripts/plan-frames/audience-panels-ids";

import { DirectToFanPanel } from "./direct-to-fan-panel";
import { WhoWeReachedPanel } from "./who-we-reached-panel";

/** WR1 / DF1 frames (HE1, HE3): one panel, in a flex column as both sales pages put it. Fixtures only. */
export function AudiencePanelFrameMount({ id }: { id: string }) {
  const frame = AUDIENCE_PANEL_FRAMES[id as AudiencePanelFrameId];
  if (!frame) return null;
  return (
    <div data-frame-ready={`audience/${id}`} className="relative flex flex-col bg-background">
      {frame.panel === "reach" ? <WhoWeReachedPanel model={locklead()} /> : <DirectToFanPanel model={electric(frame.surface)} />}
    </div>
  );
}
