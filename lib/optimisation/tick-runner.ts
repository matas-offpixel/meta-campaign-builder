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
 *   1. Loop-prevention / cooldown: skip (no DB write) if `lastTouchedAt`
 *      is inside `cooldownHours`. For shadow mode that is
 *      `applied_at ?? decided_at`. For live writes it is `applied_at` only
 *      — a shadow recommendation must not start the write cooldown.
 *   2. CBO ad sets (`dailyBudgetPence === null`, no per-adset daily budget)
 *      can't have a budget proposed — insert a `maintain` decision saying so
 *      rather than silently dropping the ad set from the audit trail.
 *   3. Metric resolution failure (e.g. no conversions yet this window) —
 *      same treatment: a `maintain` decision with an honest reason, not a
 *      silent skip.
 *   4. Otherwise, call `evaluateAdSet` (single source of decision logic)
 *      and hand the result to `applyOptimisationDecision`, which either
 *      writes Meta or records a shadow / pause-recommend / underfoot abort.
 */

import type {
  CampaignObjective,
  OptimisationStrategySettings,
  RuleMetric,
  RuleTimeWindow,
} from "../types.ts";
import { OBJECTIVE_METRIC_PRIORITY } from "../optimisation-rules.ts";
import { DEFAULT_DEDUPE_WINDOW_MS, type NotifyOptions, type NotifyResult } from "../notify/slack.ts";
import { evaluateAdSet, resolveLastTouchedAt, type AutomationAction, type GuardrailNote } from "./evaluate.ts";
import { resolvePrimaryLiveMetric } from "./live-metric.ts";
import type { AdSetInsightRow } from "./insights-fetch.ts";
import { applyOptimisationDecision, MAX_WRITES_PER_RUN } from "./apply.ts";
import { optimisationDryRunGates } from "./gates.ts";
import {
  CROSS_CHANNEL_SHADOW_GATES,
  crossChannelAdsetId,
  evaluateCrossChannelSubject,
  type AutomationChannel,
  type ChannelRollupWindow,
  type CrossChannelSubject,
} from "./cross-channel.ts";

export interface CampaignAutomationInput {
  draftId: string;
  /** Meta campaign id — `CampaignDraft.metaCampaignId`. */
  campaignId: string;
  /** act_-prefixed ad account id. */
  adAccountId: string;
  objective: CampaignObjective;
  optimisationStrategy: OptimisationStrategySettings;
  /** `campaign_drafts.optimisation_automation_live` — PR B gate (c). */
  optimisationAutomationLive: boolean;
  /** Display name for Slack (draft.settings.campaignName). */
  campaignName: string;
}

export interface DecisionToInsert {
  campaignId: string;
  adsetId: string;
  adAccountId: string;
  draftId: string;
  /** Ledger channel. Default meta for the existing evaluator path. */
  channel?: AutomationChannel;
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
  /** Persist flags — apply.ts always sets these before insert. */
  dryRun?: boolean;
  applied?: boolean;
  appliedAt?: string | null;
  metaResponseJson?: unknown;
}

export interface AdSetAutomationState {
  lastAppliedAt: Date | null;
  lastDecidedAt: Date | null;
  appliedIncreasePercentLast24h: number;
}

export interface OptimisationTickDeps {
  loadOptedInCampaigns: () => Promise<CampaignAutomationInput[]>;
  getAdSetState: (adsetId: string, sinceISO: string) => Promise<AdSetAutomationState>;
  insertDecision: (row: DecisionToInsert) => Promise<void>;
  fetchInsights: (campaignId: string, window: RuleTimeWindow) => Promise<AdSetInsightRow[]>;
  readAdSetDailyBudget: (adsetId: string) => Promise<number | null>;
  updateAdSetDailyBudget: (adsetId: string, dailyBudgetPence: number) => Promise<unknown>;
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
  /** `ENABLE_OPTIMISATION_WRITES === "1"` — gate (a). */
  writesEnabled: boolean;
  maxWritesPerRun?: number;
  /**
   * Plan-linked TikTok/Google subjects for opted-in Meta drafts.
   * Optional — existing tests omit this and the Meta path is unchanged.
   */
  loadCrossChannelSubjects?: (
    metaCampaigns: CampaignAutomationInput[],
  ) => Promise<CrossChannelSubject[]>;
  fetchChannelRollup?: (
    subject: CrossChannelSubject,
    window: RuleTimeWindow,
  ) => Promise<ChannelRollupWindow>;
}

export interface AppliedWriteDetail {
  campaignName: string;
  adsetName: string;
  budgetBeforePence: number;
  budgetAfterPence: number;
  ruleMatched: string | null;
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
  writesApplied: number;
  writesFailed: number;
  writesAbortedUnderfoot: number;
  pausesRecommended: number;
  writesCapReached: boolean;
  appliedWriteDetails: AppliedWriteDetail[];
  /** TikTok/Google shadow rows inserted this tick. Always dry_run. */
  crossChannelDecisionsInserted: number;
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
    writesApplied: 0,
    writesFailed: 0,
    writesAbortedUnderfoot: 0,
    pausesRecommended: 0,
    writesCapReached: false,
    appliedWriteDetails: [],
    crossChannelDecisionsInserted: 0,
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
  const maxWrites = deps.maxWritesPerRun ?? MAX_WRITES_PER_RUN;

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
      const gates = optimisationDryRunGates(
        deps.writesEnabled,
        true,
        campaign.optimisationAutomationLive,
      );

      for (const row of rows) {
        summary.adSetsConsidered += 1;

        try {
          const state = await deps.getAdSetState(row.adsetId, sinceISO);
          // Live writes: cooldown from last APPLIED write only, so a shadow
          // recommendation cannot start the clock. Shadow mode still falls
          // back to decided_at so we don't flood 6 rows/day.
          const lastTouchedAt = gates.dryRun
            ? resolveLastTouchedAt(state.lastAppliedAt, state.lastDecidedAt)
            : state.lastAppliedAt;
          const cooldownHours =
            campaign.optimisationStrategy.guardrails.cooldownHours ?? lookbackHours;
          if (
            lastTouchedAt &&
            Math.abs(now.getTime() - lastTouchedAt.getTime()) < cooldownHours * 60 * 60 * 1000
          ) {
            summary.adSetsSkippedRecentDecision += 1;
            continue;
          }

          const decision = buildDecision(
            campaign,
            row,
            window,
            now,
            lastTouchedAt,
            state.appliedIncreasePercentLast24h,
          );

          const writesRemaining = maxWrites - summary.writesApplied;
          const outcome = await applyOptimisationDecision(
            {
              decision,
              campaignName: campaign.campaignName,
              adsetName: row.adsetName,
              gates,
              writesRemaining,
            },
            {
              readAdSetDailyBudget: deps.readAdSetDailyBudget,
              updateAdSetDailyBudget: deps.updateAdSetDailyBudget,
              insertDecision: deps.insertDecision,
              notify: deps.notify,
              now,
            },
          );

          summary.decisionsInserted += 1;
          summary.decisionsByAction[outcome.decision.actionRecommended] =
            (summary.decisionsByAction[outcome.decision.actionRecommended] ?? 0) + 1;

          if (outcome.kind === "applied") {
            summary.writesApplied += 1;
            summary.appliedWriteDetails.push({
              campaignName: campaign.campaignName,
              adsetName: row.adsetName,
              budgetBeforePence: outcome.decision.budgetBeforePence,
              budgetAfterPence: outcome.decision.budgetAfterPence,
              ruleMatched: outcome.decision.ruleMatched,
            });
          } else if (outcome.kind === "write_failed") {
            summary.writesFailed += 1;
          } else if (outcome.kind === "aborted_underfoot") {
            summary.writesAbortedUnderfoot += 1;
          } else if (outcome.kind === "pause_recommended") {
            summary.pausesRecommended += 1;
          } else if (outcome.kind === "cap_reached") {
            summary.writesCapReached = true;
          }
        } catch (adsetErr) {
          // One ad set failing must never abort the rest of the run.
          const message = adsetErr instanceof Error ? adsetErr.message : String(adsetErr);
          console.error(
            `[optimisation-tick] campaign=${campaign.campaignId} adset=${row.adsetId} threw: ${message}`,
          );
          summary.writesFailed += 1;
        }
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

  if (deps.loadCrossChannelSubjects && deps.fetchChannelRollup) {
    try {
      const subjects = await deps.loadCrossChannelSubjects(campaigns);
      for (const subject of subjects) {
        try {
          const adsetId = crossChannelAdsetId(subject.planId, subject.channel);
          const state = await deps.getAdSetState(adsetId, sinceISO);
          const lastTouchedAt = resolveLastTouchedAt(state.lastAppliedAt, state.lastDecidedAt);
          const cooldownHours =
            subject.optimisationStrategy.guardrails.cooldownHours ?? lookbackHours;
          if (
            lastTouchedAt &&
            Math.abs(now.getTime() - lastTouchedAt.getTime()) < cooldownHours * 60 * 60 * 1000
          ) {
            summary.adSetsSkippedRecentDecision += 1;
            continue;
          }
          const window = primaryWindowFor(subject.objective, subject.optimisationStrategy);
          const rollup = await deps.fetchChannelRollup(subject, window);
          const decision = evaluateCrossChannelSubject(
            subject,
            rollup,
            window,
            now,
            lastTouchedAt,
            state.appliedIncreasePercentLast24h,
          );
          summary.adSetsConsidered += 1;
          const outcome = await applyOptimisationDecision(
            {
              decision: { ...decision, dryRun: true, applied: false },
              campaignName: subject.campaignName,
              adsetName: `${subject.channel} (${subject.planId})`,
              gates: CROSS_CHANNEL_SHADOW_GATES,
              writesRemaining: 0,
            },
            {
              readAdSetDailyBudget: deps.readAdSetDailyBudget,
              updateAdSetDailyBudget: deps.updateAdSetDailyBudget,
              insertDecision: deps.insertDecision,
              notify: deps.notify,
              now,
            },
          );
          summary.decisionsInserted += 1;
          summary.crossChannelDecisionsInserted += 1;
          summary.decisionsByAction[outcome.decision.actionRecommended] =
            (summary.decisionsByAction[outcome.decision.actionRecommended] ?? 0) + 1;
        } catch (subjectErr) {
          const message = subjectErr instanceof Error ? subjectErr.message : String(subjectErr);
          console.error(
            `[optimisation-tick] cross-channel plan=${subject.planId} channel=${subject.channel} threw: ${message}`,
          );
          summary.writesFailed += 1;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[optimisation-tick] loadCrossChannelSubjects failed: ${message}`);
    }
  }

  if (summary.writesCapReached) {
    console.log(
      `[optimisation-tick] MAX_WRITES_PER_RUN=${maxWrites} reached — remaining scale actions shadowed`,
    );
    await deps.notify({
      channel: "ads_automation",
      text: `optimisation-tick hit MAX_WRITES_PER_RUN=${maxWrites} — remaining scale actions were recorded as shadow decisions.`,
    });
  }

  if (summary.writesApplied > 0) {
    const lines = summary.appliedWriteDetails.map(
      (d) =>
        `• ${d.adsetName}: ${d.budgetBeforePence} → ${d.budgetAfterPence}` +
        (d.ruleMatched ? ` (${d.ruleMatched})` : ""),
    );
    await deps.notify({
      channel: "ads_automation",
      text: `optimisation-tick applied ${summary.writesApplied} budget write(s):\n${lines.join("\n")}`,
    });
  }

  summary.ok = summary.campaignsErrored.length === 0;
  console.log(
    `[optimisation-tick] done campaigns=${summary.campaignsConsidered} errored=${summary.campaignsErrored.length} adsets=${summary.adSetsConsidered} skipped_recent=${summary.adSetsSkippedRecentDecision} decisions=${summary.decisionsInserted} cross_channel=${summary.crossChannelDecisionsInserted} writes_applied=${summary.writesApplied} writes_failed=${summary.writesFailed} writes_aborted_underfoot=${summary.writesAbortedUnderfoot} pauses_recommended=${summary.pausesRecommended}`,
  );
  return summary;
}

function buildDecision(
  campaign: CampaignAutomationInput,
  row: AdSetInsightRow,
  window: RuleTimeWindow,
  now: Date,
  lastTouchedAt: Date | null,
  appliedIncreasePercentLast24h: number,
): DecisionToInsert {
  const primaryMetric = OBJECTIVE_METRIC_PRIORITY[campaign.objective].primary;
  const base = {
    campaignId: campaign.campaignId,
    adsetId: row.adsetId,
    adAccountId: campaign.adAccountId,
    draftId: campaign.draftId,
    channel: "meta" as const,
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
    lastTouchedAt,
    appliedIncreasePercentLast24h,
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
