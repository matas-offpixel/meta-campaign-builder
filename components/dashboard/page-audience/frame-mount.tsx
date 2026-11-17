import { locklead } from "@/lib/dashboard/audience-panels-fixture";
import { PANEL_FRAME_NOW_MS } from "@/lib/dashboard/page-audience-panel/dates";
import { electricInput, electricViews } from "@/lib/dashboard/page-audience-panel/fixture";
import { buildGeography, buildSignupsPanels } from "@/lib/dashboard/page-audience-panel/model";
import { PAGE_AUDIENCE_FRAMES, type PageAudienceFrameId } from "@/scripts/plan-frames/page-audience-ids";

import { WhoWeReachedPanel } from "../audience-panels/who-we-reached-panel";
import { SignupGeography } from "./signup-geography";
import { SignupsPanel } from "./signups-panel";

/** SC1 / SC2 / WR2 frames (HE2): one panel, in a flex column as both sales pages put it. Fixtures and a fixed "today" only. */
export function PageAudienceFrameMount({ id }: { id: string }) {
  const frame = PAGE_AUDIENCE_FRAMES[id as PageAudienceFrameId];
  if (!frame) return null;
  const input = electricInput();
  const views = electricViews();
  let body: React.ReactNode = null;
  if (frame.panel === "signups") {
    const model = buildSignupsPanels(input, views, frame.surface, PANEL_FRAME_NOW_MS)[frame.view]?.launch;
    body = model ? <SignupsPanel model={model} /> : null;
  } else {
    const geo = buildGeography(input, views, frame.surface, PANEL_FRAME_NOW_MS)[frame.view];
    body = <WhoWeReachedPanel model={locklead()} aside={geo ? <SignupGeography model={geo} /> : undefined} />;
  }
  return (
    <div data-frame-ready={`page-audience/${id}`} className="relative flex flex-col bg-background">
      {body}
    </div>
  );
}
