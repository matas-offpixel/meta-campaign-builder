import { statusStripFromLaunches } from "@/lib/viz/status";
import { VIZ_PLATFORMS, type VizStatus } from "@/lib/viz/tokens";
import type { CampaignPlanLaunches } from "@/lib/plan/types";

import { PlatformGlyph } from "./platform-glyph";
import { StatusDot } from "./status-dot";

export function StatusStrip({
  launches,
  statuses,
}: {
  launches?: CampaignPlanLaunches;
  statuses?: { meta: VizStatus; tiktok: VizStatus; google: VizStatus };
}) {
  const resolved = statuses ?? (launches ? statusStripFromLaunches(launches) : null);
  if (!resolved) return null;
  return (
    <span className="inline-flex items-center gap-2" aria-label="Platform status">
      {VIZ_PLATFORMS.map((platform) => (
        <span key={platform} className="inline-flex items-center gap-1">
          <PlatformGlyph platform={platform} size="sm" />
          <StatusDot status={resolved[platform]} />
        </span>
      ))}
    </span>
  );
}
