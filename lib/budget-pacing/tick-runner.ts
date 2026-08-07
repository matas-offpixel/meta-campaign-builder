/**
 * lib/budget-pacing/tick-runner.ts
 *
 * Pure orchestration for task #121 Phase 2
 * (`app/api/cron/budget-pacing-check/route.ts`). Same runner-vs-route split
 * as `lib/optimisation/tick-runner.ts`'s `runOptimisationTick` — every
 * Meta/Supabase/Slack call is injected, so `runBudgetPacingTick` is
 * exercisable end to end with plain fixtures. No `@/` imports.
 *
 * Per-campaign flow:
 *   1. Compute the campaign's budget plan (`computeCampaignBudgetPlan`) —
 *      skip (no notify calls at all) if there's no valid plan (e.g. every
 *      ad set disabled, or a malformed/missing schedule).
 *   2. Read the campaign's lifetime spend from the batched fetch result —
 *      skip 0-spend campaigns (nothing to alert on yet).
 *   3. `percentSpent = spendPence / plannedTotalPence * 100`, filter
 *      `BUDGET_PACING_THRESHOLDS` down to the ones already crossed.
 *   4. For each crossed threshold, call `deps.notify` with
 *      `dedupeKey: "budget_threshold:<campaignId>:<threshold>"` and
 *      `dedupeWindowMs: Number.MAX_SAFE_INTEGER` — a threshold, once fired
 *      for a campaign, never re-fires (see the brief's "paused-then-resumed
 *      campaign dipping back over the same threshold" scenario).
 *
 * One campaign throwing (e.g. a malformed draft) is caught and recorded in
 * `campaignsErrored` rather than aborting the whole tick.
 */

import { computeCampaignBudgetPlan } from "./plan.ts";
import { budgetThresholdReached } from "../notify/templates.ts";
import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";

/** 25 → 100 inclusive, per the task #121 brief. Not deduplicated against a real Meta-side lifetime_budget — see `plan.ts`'s doc comment for why the denominator is the ad-set daily-budget sum instead. */
export const BUDGET_PACING_THRESHOLDS = [25, 50, 60, 70, 80, 90, 100] as const;

export interface BudgetPacingCampaignInput {
  /** Meta campaign id — `CampaignDraft.metaCampaignId`. */
  campaignId: string;
  campaignName: string;
  currency: string;
  /** `CampaignDraft.adSetSuggestions.filter(s => s.enabled).map(s => s.budgetPerDay)`. */
  enabledDailyBudgetsMajor: number[];
  startDate: string;
  endDate: string;
  adsManagerUrl: string;
}

export interface BudgetPacingTickDeps {
  loadPublishedCampaigns: () => Promise<BudgetPacingCampaignInput[]>;
  /** Keyed by `campaignId`, pence. */
  fetchSpendPence: (campaignIds: string[]) => Promise<Record<string, number>>;
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  now?: Date;
}

export interface BudgetPacingTickSummary {
  ok: boolean;
  skippedReason?: "killswitch";
  campaignsConsidered: number;
  campaignsSkippedNoPlan: number;
  campaignsSkippedZeroSpend: number;
  campaignsErrored: { campaignId: string; error: string }[];
  thresholdsCrossed: number;
  notificationsSent: number;
  notificationsSkipped: number;
}

function emptySummary(skippedReason?: BudgetPacingTickSummary["skippedReason"]): BudgetPacingTickSummary {
  return {
    ok: true,
    skippedReason,
    campaignsConsidered: 0,
    campaignsSkippedNoPlan: 0,
    campaignsSkippedZeroSpend: 0,
    campaignsErrored: [],
    thresholdsCrossed: 0,
    notificationsSent: 0,
    notificationsSkipped: 0,
  };
}

export async function runBudgetPacingTick(
  enabled: boolean,
  deps: BudgetPacingTickDeps,
): Promise<BudgetPacingTickSummary> {
  if (!enabled) {
    console.log('[budget-pacing-check] killswitch off (ENABLE_BUDGET_PACING_ALERTS != "1") — skipping');
    return emptySummary("killswitch");
  }

  const now = deps.now ?? new Date();
  const summary = emptySummary();

  let campaigns: BudgetPacingCampaignInput[];
  try {
    campaigns = await deps.loadPublishedCampaigns();
  } catch (err) {
    console.error("[budget-pacing-check] loadPublishedCampaigns failed", err);
    return { ...summary, ok: false };
  }
  summary.campaignsConsidered = campaigns.length;
  if (campaigns.length === 0) return summary;

  let spendByCampaign: Record<string, number>;
  try {
    spendByCampaign = await deps.fetchSpendPence(campaigns.map((c) => c.campaignId));
  } catch (err) {
    console.error("[budget-pacing-check] fetchSpendPence failed", err);
    return {
      ...summary,
      ok: false,
      campaignsErrored: campaigns.map((c) => ({
        campaignId: c.campaignId,
        error: err instanceof Error ? err.message : String(err),
      })),
    };
  }

  for (const campaign of campaigns) {
    try {
      const plan = computeCampaignBudgetPlan({
        enabledDailyBudgetsMajor: campaign.enabledDailyBudgetsMajor,
        startDate: campaign.startDate,
        endDate: campaign.endDate,
        now,
      });
      if (!plan) {
        summary.campaignsSkippedNoPlan += 1;
        continue;
      }

      const spentPence = spendByCampaign[campaign.campaignId] ?? 0;
      if (spentPence <= 0) {
        summary.campaignsSkippedZeroSpend += 1;
        continue;
      }

      const percentSpent = (spentPence / plan.plannedTotalPence) * 100;
      const crossed = BUDGET_PACING_THRESHOLDS.filter((t) => percentSpent >= t);
      summary.thresholdsCrossed += crossed.length;

      for (const threshold of crossed) {
        const { text, blocks } = budgetThresholdReached({
          campaignName: campaign.campaignName,
          campaignId: campaign.campaignId,
          threshold,
          spentPence,
          totalPence: plan.plannedTotalPence,
          daysRemaining: plan.daysRemaining,
          currency: campaign.currency,
          adsManagerUrl: campaign.adsManagerUrl,
        });

        const result = await deps.notify({
          channel: "ads_ops",
          text,
          blocks,
          dedupeKey: `budget_threshold:${campaign.campaignId}:${threshold}`,
          dedupeWindowMs: Number.MAX_SAFE_INTEGER,
        });

        if (result.sent) summary.notificationsSent += 1;
        else summary.notificationsSkipped += 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[budget-pacing-check] campaign=${campaign.campaignId} threw: ${message}`);
      summary.campaignsErrored.push({ campaignId: campaign.campaignId, error: message });
    }
  }

  summary.ok = summary.campaignsErrored.length === 0;
  console.log(
    `[budget-pacing-check] done campaigns=${summary.campaignsConsidered} skipped_no_plan=${summary.campaignsSkippedNoPlan} skipped_zero_spend=${summary.campaignsSkippedZeroSpend} errored=${summary.campaignsErrored.length} thresholds_crossed=${summary.thresholdsCrossed} sent=${summary.notificationsSent} skipped_notify=${summary.notificationsSkipped}`,
  );
  return summary;
}
