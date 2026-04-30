export type CampaignDisplayStatus =
  | "ACTIVE"
  | "PAUSED"
  | "ARCHIVED"
  | "WITH_ISSUES"
  | "NOT_DELIVERING"
  | "UNKNOWN";

export type CampaignStatusReason = "no_delivery_24h";

export const STATUS_PRIORITY: Record<CampaignDisplayStatus, number> = {
  ACTIVE: 0,
  WITH_ISSUES: 1,
  NOT_DELIVERING: 2,
  PAUSED: 3,
  ARCHIVED: 4,
  UNKNOWN: 5,
};

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

export function applyCampaignDeliveryHeuristic(input: {
  status: CampaignDisplayStatus;
  lifetimeImpressions?: number | null;
  impressionsLast24h?: number | null;
}): { status: CampaignDisplayStatus; reason?: CampaignStatusReason } {
  if (
    input.lifetimeImpressions == null ||
    input.impressionsLast24h == null ||
    !Number.isFinite(input.lifetimeImpressions) ||
    !Number.isFinite(input.impressionsLast24h)
  ) {
    return { status: input.status };
  }
  if (
    input.status === "ACTIVE" &&
    input.lifetimeImpressions > 100 &&
    input.impressionsLast24h === 0
  ) {
    return { status: "NOT_DELIVERING", reason: "no_delivery_24h" };
  }
  return { status: input.status };
}

export function campaignStatusLabel(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}

export function campaignStatusReasonLabel(
  reason: CampaignStatusReason,
): string {
  switch (reason) {
    case "no_delivery_24h":
      return "(no delivery in 24h)";
  }
}

export function sortCampaignsByStatusThenSpend<
  T extends { status: string; spend: number },
>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const aPri = STATUS_PRIORITY[a.status as CampaignDisplayStatus] ?? 999;
    const bPri = STATUS_PRIORITY[b.status as CampaignDisplayStatus] ?? 999;
    if (aPri !== bPri) return aPri - bPri;
    return b.spend - a.spend;
  });
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
