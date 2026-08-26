import type { CampaignPlanLaunches, CampaignPlanLaunchRecord } from "./types.ts";

/**
 * Hard-delete is allowed only while every launch child is idle or absent.
 * A missing child loads as idle. Prepared drafts (idle + draftId) are
 * still deletable — deleting the plan never touches campaign_drafts.
 * Once any child has been launched (or failed / skipped / is launching),
 * the operator archives instead.
 */
export function planChildRowsAllowHardDelete(launches: CampaignPlanLaunches): boolean {
  return (["meta", "tiktok", "google"] as const).every((adapter) =>
    launchChildIsIdleOrAbsent(launches[adapter]),
  );
}

export function launchChildIsIdleOrAbsent(
  record: CampaignPlanLaunchRecord | null | undefined,
): boolean {
  if (!record) return true;
  return record.status === "idle";
}

export function planDisposalAction(
  launches: CampaignPlanLaunches,
): "delete" | "archive" {
  return planChildRowsAllowHardDelete(launches) ? "delete" : "archive";
}

export const DELETE_PLAN_CONFIRM =
  "Delete this draft plan? Linked Meta, TikTok, and Google drafts and any launched campaigns are left untouched.";

export const ARCHIVE_PLAN_CONFIRM =
  "Archive this plan? Linked drafts and launched campaigns are left untouched.";
