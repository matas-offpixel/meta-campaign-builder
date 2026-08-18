/**
 * lib/optimisation/tick-runner.ts
 *
 * Pure orchestration for the task #120 PR A dry-run cron
 * (`app/api/cron/optimisation-tick/route.ts`). Everything Meta/Supabase is
 * injected as a function, so `runOptimisationTick` can be exercised end to
 * end with plain fixtures — no real network or DB calls, no `@/` imports
 * (the `node --test` runner can't resolve those). Mirrors the
 * runner-vs-route split already used by `refreshActiveCreativesForEvent`
 * (`lib/reporting/active-creatives-refresh-runner.ts`) and
 * `runCronHealthCheck` (`lib/reporting/cron-health-monitor.ts`).
 *
 * Per-ad-set flow (see also the module doc comments on `evaluate.ts` /
 * `insights-fetch.ts` / `live-metric.ts` for the reasoning behind each
 * design choice):
 *   1. Loop-prevention: skip (no DB write) if `hasRecentDecision` reports a
 *      decision row for this ad set within the lookback window (default
 *      24h). This is a HARD skip — no evaluation, no insert — so an ad set
 *      gets at most one decision row per lookback window even though the
 *      cron itself runs every 4h (6×/day). Matches the cadence PR B will
 *      actually run writes at, so the shadow log is a realistic preview.
 *   2. CBO ad sets (`dailyBudgetPence === null`, no per-adset daily budget)
 *      can't have a budget proposed — insert a `maintain` decision saying so
 *      rather than silently dropping the ad set from the audit trail.
 *   3. Metric resolution failure (e.g. no conversions yet this window) —
 *      same treatment: a `maintain` decision with an honest reason, not a
 *      silent skip.
 *   4. Otherwise, call `evaluateAdSet` (which independently re-derives
 *      skip_dormant from `impressions`, and would also skip_recent_touch if
 *      it were ever given a `lastTouchedAt` — always null here, since step 1
 *      already gates that) and insert its result verbatim.
 */

import type {
  CampaignObjective,
  OptimisationStrategySettings,
  RuleMetric,
  RuleTimeWindow,
} from "../types.ts";
import { OBJECTIVE_METRIC_PRIORITY } from "../optimisation-rules.ts";
import { DEFAULT_DEDUPE_WINDOW_MS, type NotifyOptions, type NotifyResult } from "../notify/slack.ts";
import { evaluateAdSet, type AutomationAction, type GuardrailNote } from "./evaluate.ts";
import { resolvePrimaryLiveMetric } from "./live-metric.ts";
import type { AdSetInsightRow } from "./insights-fetch.ts";

export interface CampaignAutomationInput {
  draftId: string;
  /** Meta campaign id — `CampaignDraft.metaCampaignId`. */
  campaignId: string;
  /** act_-prefixed ad account id. */
  adAccountId: string;
  objective: CampaignObjective;
  optimisationStrategy: OptimisationStrategySettings;
}

export interface DecisionToInsert {
  campaignId: string;
  adsetId: string;
  adAccountId: string;
  draftId: string;
  metric: RuleMetric;
  metricValue: number | null;
  metricWindow: RuleTimeWindow;
  ruleMatched: string | null;
  actionRecommended: AutomationAction;
  actionDelta: number | null;
  budgetBeforePence: number;
  budgetAfterPence: number;
  guardrailNote: GuardrailNote;
  reasonText: string;
}

export interface OptimisationTickDeps {
  loadOptedInCampaigns: () => Promise<CampaignAutomationInput[]>;
  /** True if `adsetId` has a decision row with `decided_at` newer than `sinceISO`. */
  hasRecentDecision: (adsetId: string, sinceISO: string) => Promise<boolean>;
  insertDecision: (row: DecisionToInsert) => Promise<void>;
  fetchInsights: (campaignId: string, window: RuleTimeWindow) => Promise<AdSetInsightRow[]>;
  /**
   * Slack notify seam — fired when a single campaign evaluation throws so
   * silent per-campaign failures (e.g. invalid Meta date_preset) surface in
   * `#ads_automation` within 24h instead of only in Vercel logs. Killswitches
   * inside `notify()` still gate delivery.
   */
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  now?: Date;
  /** Recent-decision lookback in hours. Defaults to 24 (loop-prevention window). */
  lookbackHours?: number;
}

export interface OptimisationTickSummary {
  ok: boolean;
  skippedReason?: "killswitch" | "quota_throttled";
  campaignsConsidered: number;
  campaignsErrored: { campaignId: string; error: string }[];
  adSetsConsidered: number;
  adSetsSkippedRecentDecision: number;
  decisionsInserted: number;
  decisionsByAction: Record<string, number>;
}

function emptySummary(skippedReason?: OptimisationTickSummary["skippedReason"]): OptimisationTickSummary {
  return {
    ok: true,
    skippedReason,
    campaignsConsidered: 0,
    campaignsErrored: [],
    adSetsConsidered: 0,
    adSetsSkippedRecentDecision: 0,
    decisionsInserted: 0,
    decisionsByAction: {},
  };
}

/** The enabled rule (if any) matching the objective's primary metric — used for its `timeWindow`. */
function primaryWindowFor(objective: CampaignObjective, strategy: OptimisationStrategySettings): RuleTimeWindow {
  const primaryMetric = OBJECTIVE_METRIC_PRIORITY[objective].primary;
  const rule = strategy.rules.find((r) => r.enabled && r.metric === primaryMetric);
  return rule?.timeWindow ?? "24h";
}

export async function runOptimisationTick(
  enabled: boolean,
  quotaThrottled: boolean,
  deps: OptimisationTickDeps,
): Promise<OptimisationTickSummary> {
  if (!enabled) {
    console.log("[optimisation-tick] killswitch off (ENABLE_OPTIMISATION_AUTOMATION != \"1\") — skipping");
    return emptySummary("killswitch");
  }
  if (quotaThrottled) {
    console.log("[optimisation-tick] quota-throttled tick skipped — X-App-Usage above threshold");
    return emptySummary("quota_throttled");
  }

  const now = deps.now ?? new Date();
  const lookbackHours = deps.lookbackHours ?? 24;
  const sinceISO = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000).toISOString();

  const summary = emptySummary();
  let campaigns: CampaignAutomationInput[];
  try {
    campaigns = await deps.loadOptedInCampaigns();
  } catch (err) {
    console.error("[optimisation-tick] loadOptedInCampaigns failed", err);
    return { ...summary, ok: false };
  }
  summary.campaignsConsidered = campaigns.length;

  for (const campaign of campaigns) {
    try {
      const window = primaryWindowFor(campaign.objective, campaign.optimisationStrategy);
      const rows = await deps.fetchInsights(campaign.campaignId, window);

      for (const row of rows) {
        summary.adSetsConsidered += 1;

        const recentlyDecided = await deps.hasRecentDecision(row.adsetId, sinceISO);
        if (recentlyDecided) {
          summary.adSetsSkippedRecentDecision += 1;
          continue;
        }

        const decision = buildDecision(campaign, row, window, now);
        await deps.insertDecision(decision);
        summary.decisionsInserted += 1;
        summary.decisionsByAction[decision.actionRecommended] =
          (summary.decisionsByAction[decision.actionRecommended] ?? 0) + 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[optimisation-tick] campaign=${campaign.campaignId} threw: ${message}`);
      summary.campaignsErrored.push({ campaignId: campaign.campaignId, error: message });
      // Visibility: don't let a repeating per-campaign throw run silent for
      // days (2026-08-07→18 last_1d / date_preset incident). notify() fails
      // open — a Slack/dedupe miss must never break the tick loop.
      await deps.notify({
        channel: "ads_automation",
        text: `optimisation-tick campaign=${campaign.campaignId} (draft=${campaign.draftId}) threw: ${message}`,
        dedupeKey: `optimisation_tick_error:${campaign.campaignId}`,
        dedupeWindowMs: DEFAULT_DEDUPE_WINDOW_MS,
      });
    }
  }

  summary.ok = summary.campaignsErrored.length === 0;
  console.log(
    `[optimisation-tick] done campaigns=${summary.campaignsConsidered} errored=${summary.campaignsErrored.length} adsets=${summary.adSetsConsidered} skipped_recent=${summary.adSetsSkippedRecentDecision} decisions=${summary.decisionsInserted}`,
  );
  return summary;
}

function buildDecision(
  campaign: CampaignAutomationInput,
  row: AdSetInsightRow,
  window: RuleTimeWindow,
  now: Date,
): DecisionToInsert {
  const primaryMetric = OBJECTIVE_METRIC_PRIORITY[campaign.objective].primary;
  const base = {
    campaignId: campaign.campaignId,
    adsetId: row.adsetId,
    adAccountId: campaign.adAccountId,
    draftId: campaign.draftId,
    metric: primaryMetric,
    metricWindow: window,
  };

  if (row.dailyBudgetPence === null) {
    return {
      ...base,
      metricValue: null,
      ruleMatched: null,
      actionRecommended: "maintain",
      actionDelta: null,
      budgetBeforePence: 0,
      budgetAfterPence: 0,
      guardrailNote: null,
      reasonText: `Ad set "${row.adsetName}" has no per-ad-set daily_budget (campaign budget optimisation) — PR A does not propose CBO changes.`,
    };
  }

  const liveMetric = resolvePrimaryLiveMetric(campaign.objective, row, window);
  if (!liveMetric) {
    return {
      ...base,
      metricValue: null,
      ruleMatched: null,
      actionRecommended: "maintain",
      actionDelta: null,
      budgetBeforePence: row.dailyBudgetPence,
      budgetAfterPence: row.dailyBudgetPence,
      guardrailNote: null,
      reasonText: `No ${primaryMetric} data in the ${window} window yet for "${row.adsetName}" (e.g. no conversions) — maintaining budget.`,
    };
  }

  const result = evaluateAdSet({
    rules: campaign.optimisationStrategy.rules,
    guardrails: campaign.optimisationStrategy.guardrails,
    currentBudgetPence: row.dailyBudgetPence,
    liveMetric,
    lastTouchedAt: null, // the caller's hasRecentDecision check already gates recency
    impressions: row.impressions,
    now,
  });

  return {
    ...base,
    metricValue: liveMetric.value,
    ruleMatched: result.ruleMatched,
    actionRecommended: result.action,
    actionDelta: result.deltaPercent,
    budgetBeforePence: row.dailyBudgetPence,
    budgetAfterPence: result.budgetAfterPence,
    guardrailNote: result.guardrailNote,
    reasonText: result.reason,
  };
}
