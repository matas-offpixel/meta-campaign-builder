export type CampaignDisplayStatus =
  | "ACTIVE"
  | "PAUSED"
  | "ARCHIVED"
  | "WITH_ISSUES"
  | "NOT_DELIVERING"
  | "UNKNOWN";

const DISPLAY_STATUS_BY_META_EFFECTIVE_STATUS: Record<
  string,
  CampaignDisplayStatus
> = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  CAMPAIGN_PAUSED: "PAUSED",
  DISAPPROVED: "ARCHIVED",
  ARCHIVED: "ARCHIVED",
  DELETED: "ARCHIVED",
  PENDING_REVIEW: "WITH_ISSUES",
  IN_PROCESS: "WITH_ISSUES",
  WITH_ISSUES: "WITH_ISSUES",
  ADSET_PAUSED: "NOT_DELIVERING",
  NOT_DELIVERING: "NOT_DELIVERING",
};

export function normaliseMetaCampaignStatus(input: {
  status?: string | null;
  effectiveStatus?: string | null;
}): CampaignDisplayStatus {
  const raw = (input.effectiveStatus ?? input.status ?? "UNKNOWN").toUpperCase();
  return DISPLAY_STATUS_BY_META_EFFECTIVE_STATUS[raw] ?? "UNKNOWN";
}

export function campaignStatusLabel(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}

export function campaignStatusTone(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "PAUSED":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "WITH_ISSUES":
      return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
    case "NOT_DELIVERING":
      return "bg-muted text-muted-foreground";
    case "ARCHIVED":
      return "bg-slate-500/15 text-slate-700 dark:text-slate-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}
