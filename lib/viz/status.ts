import type { CampaignPlanLaunchRecord, CampaignPlanLaunches } from "../plan/types.ts";
import type { VizStatus } from "./tokens.ts";

/** Launch child → semantic dot. A prepared draft that is still idle is Ready. */
export function statusFromLaunchRecord(
  record: Pick<CampaignPlanLaunchRecord, "status" | "draftId">,
): VizStatus {
  if (record.status === "live") return "live";
  if (record.status === "failed") return "failed";
  if (record.status === "launching") return "in-progress";
  if (record.status === "skipped") return "paused";
  if (record.draftId) return "ready";
  return "idle";
}

/**
 * Same mapping, plus the state a launch record cannot know about: a
 * prepared draft with unresolved preflight blockers is `blocked`, not
 * `ready`. A record that already reached the platform outranks blockers —
 * once it is live or paused on Meta, a stale blocker must not recolour it.
 */
export function statusFromLaunchAndBlockers(
  record: Pick<CampaignPlanLaunchRecord, "status" | "draftId">,
  blockerCount: number,
): VizStatus {
  const base = statusFromLaunchRecord(record);
  if (blockerCount <= 0) return base;
  return base === "ready" || base === "idle" ? "blocked" : base;
}

export function statusStripFromLaunches(launches: CampaignPlanLaunches): {
  meta: VizStatus;
  tiktok: VizStatus;
  google: VizStatus;
} {
  return {
    meta: statusFromLaunchRecord(launches.meta),
    tiktok: statusFromLaunchRecord(launches.tiktok),
    google: statusFromLaunchRecord(launches.google),
  };
}