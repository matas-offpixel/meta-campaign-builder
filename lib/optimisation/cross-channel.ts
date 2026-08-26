/**
 * M.4 — cross-channel Optimisation Strategy shadow.
 *
 * The plan's rule set IS the linked Meta draft's Optimisation Strategy.
 * This module evaluates TikTok / Google against that same rule set using
 * event_daily_rollups spend + result columns. When spend exists but no
 * trustworthy result count does, the decision is `metric_unavailable` —
 * never a rate from a guessed denominator.
 *
 * Cross-channel rows are SHADOW ONLY in this PR: dry_run=true,
 * applied=false, always. No TikTok/Google write paths.
 *
 * Pure — no `@/` imports, no env reads — so node --test can load it.
 */

import type {
  CampaignObjective,
  OptimisationStrategySettings,
  RuleMetric,
  RuleTimeWindow,
} from "../types.ts";
import { OBJECTIVE_METRIC_PRIORITY } from "../optimisation-rules.ts";
import {
  evaluateAdSet,
  type AutomationAction,
  type GuardrailNote,
} from "./evaluate.ts";
import type { OptimisationDryRunGates } from "./gates.ts";

export const AUTOMATION_CHANNELS = ["meta", "tiktok", "google"] as const;
export type AutomationChannel = (typeof AUTOMATION_CHANNELS)[number];

export const CROSS_CHANNEL_CHANNELS = ["tiktok", "google"] as const;
export type CrossChannelName = (typeof CROSS_CHANNEL_CHANNELS)[number];

export const METRIC_UNAVAILABLE: AutomationAction = "metric_unavailable";

/**
 * Forced shadow gates for TikTok/Google in this PR. Independent of the
 * Meta draft's Live flag and of ENABLE_OPTIMISATION_WRITES. Per-channel
 * Live arming is a named follow-up.
 */
export const CROSS_CHANNEL_SHADOW_GATES: OptimisationDryRunGates = {
  dryRun: true,
  reason: "not_live",
};

export interface ChannelMetricAvailability {
  channel: AutomationChannel;
  spendColumn: string;
  resultColumn: string;
  impressionsColumn: string;
  grain: "adset_insights" | "event_daily_rollups";
  cprTrustworthyWhen: string;
  notes: string;
}

/**
 * Honest inventory of what the evaluator can actually read. Meta stays
 * on ad-set insights (existing tick). TikTok / Google are event-day
 * rollups — not per-ad-set.
 */
export const CHANNEL_METRIC_AVAILABILITY: ChannelMetricAvailability[] = [
  {
    channel: "meta",
    spendColumn: "insights spend (via cost_per_action_type)",
    resultColumn: "cost_per_action_type",
    impressionsColumn: "insights impressions",
    grain: "adset_insights",
    cprTrustworthyWhen: "cost_per_action_type has a value for the objective's primary action",
    notes: "Existing evaluator. Unchanged by M.4.",
  },
  {
    channel: "tiktok",
    spendColumn: "tiktok_spend",
    resultColumn: "tiktok_results",
    impressionsColumn: "tiktok_impressions",
    grain: "event_daily_rollups",
    cprTrustworthyWhen: "tiktok_results is present and > 0",
    notes:
      "tiktok_results is conversion-style after the VIEW_CONTENT split. Spend with null/0 results → metric_unavailable, never spend/0. Grain is event-day, not ad-set.",
  },
  {
    channel: "google",
    spendColumn: "google_ads_spend",
    resultColumn: "google_ads_conversions",
    impressionsColumn: "google_ads_impressions",
    grain: "event_daily_rollups",
    cprTrustworthyWhen: "google_ads_conversions is present and > 0",
    notes:
      "Conversions exist at event-day grain. Spend with null/0 conversions → metric_unavailable. Grain is event-day, not ad-set.",
  },
];

export interface CrossChannelSubject {
  planId: string;
  eventId: string;
  metaDraftId: string;
  channel: CrossChannelName;
  campaignId: string;
  adAccountId: string;
  /** Plan per-channel daily split, major currency units. */
  dailyBudgetMajor: number;
  optimisationStrategy: OptimisationStrategySettings;
  objective: CampaignObjective;
  campaignName: string;
}

export interface ChannelRollupWindow {
  spend: number | null;
  results: number | null;
  impressions: number;
  spendColumnPresent: boolean;
  resultColumnPresent: boolean;
}

const TIKTOK_COLS = {
  spend: "tiktok_spend",
  results: "tiktok_results",
  impressions: "tiktok_impressions",
} as const;

const GOOGLE_COLS = {
  spend: "google_ads_spend",
  results: "google_ads_conversions",
  impressions: "google_ads_impressions",
} as const;

export function channelRollupColumns(channel: CrossChannelName): {
  spend: string;
  results: string;
  impressions: string;
} {
  return channel === "tiktok" ? TIKTOK_COLS : GOOGLE_COLS;
}

export function windowDayCount(window: RuleTimeWindow): number {
  if (window === "7d") return 7;
  if (window === "3d") return 3;
  return 1;
}

export function rollupWindowStartDate(now: Date, window: RuleTimeWindow): string {
  const days = windowDayCount(window);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString().slice(0, 10);
}

export function rollupWindowEndDate(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Sum event-day rollup rows for one channel. A missing key on the fixture
 * (or row) means that column is not present — never treated as 0.
 */
export function aggregateChannelRollup(
  rows: Array<Record<string, unknown>>,
  channel: CrossChannelName,
): ChannelRollupWindow {
  const cols = channelRollupColumns(channel);
  let spendColumnPresent = false;
  let resultColumnPresent = false;
  let spend = 0;
  let results = 0;
  let impressions = 0;
  let spendSeen = false;
  let resultsSeen = false;

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(row, cols.spend)) {
      spendColumnPresent = true;
      const n = asFiniteNumber(row[cols.spend]);
      if (n != null) {
        spend += n;
        spendSeen = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(row, cols.results)) {
      resultColumnPresent = true;
      const n = asFiniteNumber(row[cols.results]);
      if (n != null) {
        results += n;
        resultsSeen = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(row, cols.impressions)) {
      const n = asFiniteNumber(row[cols.impressions]);
      if (n != null) impressions += n;
    }
  }

  return {
    spend: spendColumnPresent && spendSeen ? spend : spendColumnPresent ? 0 : null,
    results: resultColumnPresent && resultsSeen ? results : resultColumnPresent ? 0 : null,
    impressions,
    spendColumnPresent,
    resultColumnPresent,
  };
}

export function crossChannelAdsetId(planId: string, channel: CrossChannelName): string {
  return `plan:${planId}:${channel}`;
}

export function crossChannelCampaignId(
  planId: string,
  channel: CrossChannelName,
  platformCampaignId: string | null | undefined,
): string {
  const id = platformCampaignId?.trim();
  return id || `plan:${planId}:${channel}`;
}

export interface CrossChannelDecision {
  campaignId: string;
  adsetId: string;
  adAccountId: string;
  draftId: string;
  channel: AutomationChannel;
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
  dryRun: true;
  applied: false;
}

function metricUnavailableDecision(
  subject: CrossChannelSubject,
  window: RuleTimeWindow,
  primaryMetric: RuleMetric,
  dailyBudgetPence: number,
  reasonText: string,
): CrossChannelDecision {
  return {
    campaignId: subject.campaignId,
    adsetId: crossChannelAdsetId(subject.planId, subject.channel),
    adAccountId: subject.adAccountId,
    draftId: subject.metaDraftId,
    channel: subject.channel,
    metric: primaryMetric,
    metricValue: null,
    metricWindow: window,
    ruleMatched: null,
    actionRecommended: METRIC_UNAVAILABLE,
    actionDelta: null,
    budgetBeforePence: dailyBudgetPence,
    budgetAfterPence: dailyBudgetPence,
    guardrailNote: null,
    reasonText,
    dryRun: true,
    applied: false,
  };
}

/**
 * Evaluate one plan-linked TikTok/Google subject against the Meta draft's
 * rule set. Always returns a decision that is dry_run / not applied.
 */
export function evaluateCrossChannelSubject(
  subject: CrossChannelSubject,
  rollup: ChannelRollupWindow,
  window: RuleTimeWindow,
  now: Date,
  lastTouchedAt: Date | null,
  appliedIncreasePercentLast24h: number,
): CrossChannelDecision {
  const primaryMetric = OBJECTIVE_METRIC_PRIORITY[subject.objective].primary;
  const dailyBudgetPence = Math.round(subject.dailyBudgetMajor * 100);
  const cols = channelRollupColumns(subject.channel);
  const base = {
    campaignId: subject.campaignId,
    adsetId: crossChannelAdsetId(subject.planId, subject.channel),
    adAccountId: subject.adAccountId,
    draftId: subject.metaDraftId,
    channel: subject.channel as AutomationChannel,
    metric: primaryMetric,
    metricWindow: window,
  };

  const spend = rollup.spend;
  const results = rollup.results;
  const hasSpend = rollup.spendColumnPresent && spend != null && spend > 0;
  const hasTrustworthyResults =
    rollup.resultColumnPresent && results != null && results > 0;

  if (hasSpend && !hasTrustworthyResults) {
    const why = !rollup.resultColumnPresent
      ? `${cols.results} is absent on the rollup fixture`
      : `${cols.results} is ${results == null ? "null" : results}`;
    return metricUnavailableDecision(
      subject,
      window,
      primaryMetric,
      dailyBudgetPence,
      `${subject.channel} has spend (${spend}) but no trustworthy result count (${why}) — metric_unavailable, not a guessed ${primaryMetric}.`,
    );
  }

  if (!rollup.spendColumnPresent) {
    return metricUnavailableDecision(
      subject,
      window,
      primaryMetric,
      dailyBudgetPence,
      `${subject.channel} spend column ${cols.spend} is absent — metric_unavailable.`,
    );
  }

  if (!hasSpend) {
    return {
      ...base,
      metricValue: null,
      ruleMatched: null,
      actionRecommended: "skip_dormant",
      actionDelta: null,
      budgetBeforePence: dailyBudgetPence,
      budgetAfterPence: dailyBudgetPence,
      guardrailNote: null as GuardrailNote,
      reasonText: `No ${subject.channel} spend in the ${window} window — dormant, no metric signal to act on.`,
      dryRun: true,
      applied: false,
    };
  }

  const cpr = spend! / results!;
  const result = evaluateAdSet({
    rules: subject.optimisationStrategy.rules,
    guardrails: subject.optimisationStrategy.guardrails,
    currentBudgetPence: dailyBudgetPence,
    liveMetric: { name: primaryMetric, value: cpr, window },
    lastTouchedAt,
    appliedIncreasePercentLast24h,
    // CPR is already trustworthy; don't hide it behind a 0-impression skip.
    impressions: rollup.impressions > 0 ? rollup.impressions : 1,
    now,
  });

  return {
    ...base,
    metricValue: cpr,
    ruleMatched: result.ruleMatched,
    actionRecommended: result.action,
    actionDelta: result.deltaPercent,
    budgetBeforePence: dailyBudgetPence,
    budgetAfterPence: result.budgetAfterPence,
    guardrailNote: result.guardrailNote,
    reasonText: result.reason,
    dryRun: true,
    applied: false,
  };
}
