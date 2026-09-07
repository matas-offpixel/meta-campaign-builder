import type { PlanAdapterOutcome } from "./orchestrator.ts";
import type { CampaignPlanLaunchRecord } from "./types.ts";

/** Operator sentence when Meta built a campaign with no serving ads. */
export function formatMetaAdsCountSentence(created: number, total: number): string {
  return `campaign created, ${created} of ${total} ads — see the log`;
}

/** Face + Slack copy when Meta wrote and the ledger row did not. */
export const PLAN_LAUNCH_UNRECORDED_ADVISORY =
  "launched, but not recorded here — tell Matas";

export interface MetaLaunchSummaryCounts {
  metaCampaignId?: string | null;
  adsCreated?: number;
  adsFailed?: number;
}

export interface InterpretedMetaLaunch extends PlanAdapterOutcome {
  advisory?: string | null;
}

function asCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * HTTP 201 from `/api/meta/launch-campaign` is not "live". The summary
 * can be a paused empty shell. Zero ads created is failed; some ads is
 * live with the count sentence; all ads is live clean.
 */
export function interpretMetaLaunchSummary(
  summary: MetaLaunchSummaryCounts,
): InterpretedMetaLaunch {
  const created = asCount(summary.adsCreated);
  const failed = asCount(summary.adsFailed);
  const total = created + failed;
  const campaignId = summary.metaCampaignId ?? null;

  if (created === 0) {
    return {
      ok: false,
      campaignId,
      error: formatMetaAdsCountSentence(0, total),
    };
  }
  if (failed > 0) {
    return {
      ok: true,
      campaignId,
      advisory: formatMetaAdsCountSentence(created, total),
    };
  }
  return { ok: true, campaignId };
}

/** Persist failed after a platform write — never swallow that. */
export function persistLaunchFailureAdvisory(
  record: Pick<CampaignPlanLaunchRecord, "status" | "platformCampaignId">,
): string | null {
  if (record.status === "live" || record.platformCampaignId) {
    return PLAN_LAUNCH_UNRECORDED_ADVISORY;
  }
  return null;
}
