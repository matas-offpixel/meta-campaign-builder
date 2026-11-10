import { REESHY_NO_PHOTO } from "@/lib/creative-lab/artist-card-gate-copy";

import { PhotoGate } from "./photo-gate";

export function ArtistCardFrameMount({ id }: { id: string }) {
  return (
    <div data-frame-ready={id} className="bg-background p-4 text-foreground">
      <PhotoGate artist="Reeshy" plan={REESHY_NO_PHOTO} />
    </div>
  );
}
