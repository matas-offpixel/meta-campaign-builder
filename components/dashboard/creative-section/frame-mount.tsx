import { ironworksCreative } from "@/lib/dashboard/creative-section-fixture";
import { CREATIVE_FRAMES, type CreativeFrameId } from "@/scripts/plan-frames/creative-section-ids";

import { CreativePanel } from "./creative-panel";

/** CR1 frames (HE5): the IRW0001 fixture, internal and share. */
export function CreativeFrameMount({ id }: { id: string }) {
  const frame = CREATIVE_FRAMES[id as CreativeFrameId];
  if (!frame) return null;
  return (
    <div data-frame-ready={`creative/${id}`} className="relative flex min-w-0 flex-col bg-background">
      <CreativePanel model={ironworksCreative(frame.surface)} />
    </div>
  );
}
