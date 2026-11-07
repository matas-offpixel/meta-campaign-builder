import { CreativeLabCard } from "@/components/dashboard/events/creative-lab-card";
import type { LabFrameFixture } from "@/scripts/plan-frames/lab-fixtures";

/**
 * A CL frame: the real Creative Lab card on a fixture, with the event
 * page's gutter (`px-6 py-6`). Nothing here fetches until clicked.
 */
export function CreativeLabFrameMount({ fixture }: { fixture: LabFrameFixture }) {
  return (
    <div data-frame-ready={fixture.id} className="bg-background px-6 py-6 text-foreground">
      <CreativeLabCard lab={fixture.lab} />
    </div>
  );
}
