import type { MetaCampaignSummary } from "@/lib/types";

/**
 * True when a campaign is runtime-active on Meta.
 *
 * Prefers `effective_status` (what Meta actually serves). Falls back to
 * `status` only when effective_status is absent — e.g. older API payloads.
 */
export function isCampaignRuntimeActive(
  campaign: Pick<MetaCampaignSummary, "effectiveStatus" | "status">,
): boolean {
  const effective = campaign.effectiveStatus?.trim();
  if (effective) {
    return effective.toUpperCase() === "ACTIVE";
  }
  return (campaign.status ?? "").trim().toUpperCase() === "ACTIVE";
}
