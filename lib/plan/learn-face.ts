/**
 * LEARN face copy — canon §2.4 + amendments; frames E1–E6.
 * Built against the `campaign_plan_predictions` type from PR 3 (#896).
 * This branch does not add the write path or the migration.
 */

import { formatVizDay } from "../viz/format-moment.ts";
import { VIZ_CLIENT_SAFE, VIZ_LOCKED_CLIENT_CREATIVE } from "../viz/tokens.ts";

/** Same shape as #896 `CampaignPlanPrediction`. */
export type PredictionMetric =
  | "cost_per_unit"
  | "split_meta"
  | "split_tiktok"
  | "split_google"
  | "pace_daily";

export type PredictionUnit = "reg" | "click" | "lpv" | "purchase" | "view";

export type CampaignPlanPrediction = {
  planId: string;
  metric: PredictionMetric;
  unit: PredictionUnit | null;
  value: number;
  n: number;
  runsUsed: string[];
  actual?: number | null;
};

export const LEARN_INFO_VARIANT = "card" as const;
export const LEARN_PHASE_LABEL = "before general sale" as const;
export const LEARN_NO_PREDICTION =
  "no prediction was stored for this plan — it launched before predictions were kept";
export const LEARN_PACE_KEPT = "£35 per day, kept";
export const LEARN_PACE_KEPT_TIP =
  "pace is a setting, not a prediction — the daily amount is kept";
export const LEARN_CREATIVE_LOCK = VIZ_LOCKED_CLIENT_CREATIVE;
export const LEARN_COLUMN_HEADS = {
  assumed: "we assumed",
  cameIn: "came in at",
  next: "next time we will assume",
} as const;
export const LEARN_PACE_HEADS = {
  plan: "the plan said",
  spent: "spent",
  next: "next time",
} as const;

export function formatGbp(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded) || rounded >= 10) {
    return `£${Math.round(rounded).toLocaleString("en-GB")}`;
  }
  return `£${rounded.toFixed(2)}`;
}

export function formatColumnHeads(eventName: string): {
  assumed: string;
  cameIn: string;
  next: string;
} {
  return {
    assumed: LEARN_COLUMN_HEADS.assumed,
    cameIn: `${eventName} ${LEARN_COLUMN_HEADS.cameIn}`,
    next: LEARN_COLUMN_HEADS.next,
  };
}

export function formatPaceHeads(eventName: string): {
  plan: string;
  spent: string;
  next: string;
} {
  return {
    plan: LEARN_PACE_HEADS.plan,
    spent: `${eventName} ${LEARN_PACE_HEADS.spent}`,
    next: LEARN_PACE_HEADS.next,
  };
}

export function formatLearnSentence(input: {
  predicted: number;
  unitWord: string;
  n: number;
  venueLabel: string;
  eventName: string;
  actual: number;
  phaseLabel?: string;
  nextTime: number;
  nextN: number;
}): string {
  const phase = input.phaseLabel ?? LEARN_PHASE_LABEL;
  const shows = input.n === 1 ? "other show" : "other shows";
  return `We assumed ${formatGbp(input.predicted)} per ${input.unitWord} from ${input.n} ${shows} at ${input.venueLabel}; ${input.eventName} came in at ${formatGbp(input.actual)} ${phase}; the next ${input.venueLabel} plan will assume ${formatGbp(input.nextTime)} (${input.nextN} other shows)`;
}

export function formatArchiveHeader(archivedAt: Date | string): string {
  return `closed when you archived it, ${formatVizDay(archivedAt)}`;
}

export function formatPastIdentity(input: {
  metaName: string | null;
  tiktokRan: boolean;
  googleRan: boolean;
}): string {
  const meta = input.metaName
    ? `Ran as ${input.metaName} on Meta`
    : "Ran on Meta";
  if (!input.tiktokRan && !input.googleRan) {
    return `${meta} · TikTok and Google did not run`;
  }
  const extras = [
    input.tiktokRan ? "TikTok" : null,
    input.googleRan ? "Google" : null,
  ].filter(Boolean);
  return extras.length ? `${meta} · ${extras.join(" · ")}` : meta;
}

export function formatDateLock(eventName: string, days: number): string {
  return `opens when ${eventName} closes (${days} days)`;
}

export function formatCountLock(venueLabel: string, n: number, of: number): string {
  return `opens after your ${ordinal(of)} ${venueLabel} show (${n} so far)`;
}

export function learnControlsVisible(role: "operator" | "client"): {
  nextTimeColumn: boolean;
} {
  return { nextTimeColumn: role !== "client" };
}

export function learnCreativeLock(role: "operator" | "client"): string {
  return role === "client" ? VIZ_CLIENT_SAFE(LEARN_CREATIVE_LOCK) : LEARN_CREATIVE_LOCK;
}

/**
 * Postgres `percentile_cont` — linear interpolation on the sorted sample.
 * Six NX signup costs with D.O.D added: 0.51 · 0.90 · 1.46 · 2.03 · 2.12 · 5.63
 * → median £1.75, band £1.04–£2.10 (canon §2.4 amendment).
 */
export function percentileCont(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const index = p * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo]!;
  const weight = index - lo;
  return sorted[lo]! + weight * (sorted[hi]! - sorted[lo]!);
}

export function nextTimeFromRuns(costs: readonly number[]): {
  value: number;
  band: [number, number];
  n: number;
} {
  const sorted = [...costs].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return {
    value: round2(percentileCont(sorted, 0.5)),
    band: [round2(percentileCont(sorted, 0.25)), round2(percentileCont(sorted, 0.75))],
    n: sorted.length,
  };
}

export const E1_PRIOR_RUNS = [0.9, 1.46, 2.03, 2.12, 5.63] as const;
export const E1_CLOSED_RUNS = [0.51, 0.9, 1.46, 2.03, 2.12, 5.63] as const;

export type LearnEState = "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7";

export function learnFaceSentences(state: LearnEState): string[] {
  const next = nextTimeFromRuns(E1_CLOSED_RUNS);
  switch (state) {
    case "E1":
      return [
        formatLearnSentence({
          predicted: 2.03,
          unitWord: "signup",
          n: 5,
          venueLabel: "NX",
          eventName: "D.O.D",
          actual: 0.51,
          nextTime: next.value,
          nextN: next.n,
        }),
      ];
    case "E2":
      return [LEARN_NO_PREDICTION];
    case "E3":
      return [formatDateLock("D.O.D", 89), formatCountLock("NX", 1, 3)];
    case "E4":
      return [formatCountLock("NX", 1, 3)];
    case "E5":
      return [LEARN_CREATIVE_LOCK];
    case "E6":
      return [learnCreativeLock("client")];
    case "E7":
      return [formatArchiveHeader("2026-09-06T12:00:00.000Z")];
    default:
      return [];
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function planIsClosed(input: {
  status: string;
  eventDate?: string | null;
  now?: Date;
}): boolean {
  if (input.status === "archived") return true;
  if (!input.eventDate) return false;
  const day = input.eventDate.slice(0, 10);
  const today = (input.now ?? new Date()).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  return Boolean(day && today && day < today);
}

function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
