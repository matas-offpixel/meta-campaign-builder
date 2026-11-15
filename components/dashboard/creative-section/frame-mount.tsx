import { cdwCreative } from "@/lib/dashboard/creative-section-fixture";
import { CREATIVE_FRAMES, type CreativeFrameId } from "@/scripts/plan-frames/creative-section-ids";

import { CreativePanel } from "./creative-panel";

/** CR1 frames (HE5): Charlotte de Witte (IRW0006), internal and share. */
export function CreativeFrameMount({ id }: { id: string }) {
  const frame = CREATIVE_FRAMES[id as CreativeFrameId];
  if (!frame) return null;
  return (
    <div data-frame-ready={`creative/${id}`} className="relative flex min-w-0 flex-col bg-background">
      <CreativePanel model={cdwCreative(frame.surface)} />
    </div>
  );
}
