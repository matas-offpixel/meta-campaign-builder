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

export type PipelineNodeId = "meta" | "derive" | "assets" | "launch";

export function pipelineNodeStatus(
  node: PipelineNodeId,
  launches: CampaignPlanLaunches,
): VizStatus {
  if (node === "meta") return statusFromLaunchRecord(launches.meta);
  if (node === "assets") {
    return launches.meta.draftId ? "ready" : "idle";
  }
  if (node === "derive") {
    if (!launches.meta.draftId) return "idle";
    const tiktok = statusFromLaunchRecord(launches.tiktok);
    const google = statusFromLaunchRecord(launches.google);
    if (tiktok === "failed" || google === "failed") return "failed";
    if (tiktok === "in-progress" || google === "in-progress") return "in-progress";
    if (tiktok !== "idle" || google !== "idle") return "ready";
    return "idle";
  }
  const records = [launches.meta, launches.tiktok, launches.google];
  if (records.some((r) => r.status === "launching")) return "in-progress";
  if (records.some((r) => r.status === "failed")) return "failed";
  if (records.some((r) => r.status === "live")) return "live";
  return "idle";
}
