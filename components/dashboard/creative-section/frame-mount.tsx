import { cdwCreative, jamieJonesCreative } from "@/lib/dashboard/creative-section-fixture";
import { CREATIVE_FRAMES, type CreativeFrameId } from "@/scripts/plan-frames/creative-section-ids";

import { CreativePanel } from "./creative-panel";

/** CR1 / CR1S: Charlotte de Witte. CR2: Jamie Jones, with the TikTok snapshot. */
export function CreativeFrameMount({ id }: { id: string }) {
  const frame = CREATIVE_FRAMES[id as CreativeFrameId];
  if (!frame) return null;
  const model = id === "CR2" ? jamieJonesCreative("internal") : cdwCreative(frame.surface);
  return (
    <div data-frame-ready={`creative/${id}`} className="relative flex min-w-0 flex-col bg-background">
      <CreativePanel model={model} />
    </div>
  );
}
