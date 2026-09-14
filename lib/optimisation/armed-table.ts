/**
 * Scan columns for the Armed tab. Two divisions: metric / target,
 * daily budget / binding cap. A ratio is a ratio.
 */

import { readBaseAdSetBudget } from "./campaign-ceiling.ts";
import type {
  ArmedBudgetBase,
  ArmedCampaignControls,
  ArmedCampaignRow,
  ArmedLastDecision,
} from "./armed-read-model.ts";

export const ARMED_TABLE_SORT_KEY = "armed-table-sort";

export const ENDED_DECISION_ACTIONS = [
  "skip_event_passed",
  "skip_campaign_ended",
] as const;

export type ArmedSortKey =
  | "campaign"
  | "arm"
  | "event"
  | "acting"
  | "dailyBudget"
  | "netChange"
  | "metric"
  | "vsTarget"
  | "vsCap"
  | "results";

export type ArmedSortDir = "asc" | "desc";

export type ArmedSortState = {
  key: ArmedSortKey;
  dir: ArmedSortDir;
};

export const DEFAULT_ARMED_SORT: ArmedSortState = { key: "arm", dir: "asc" };

const SORT_KEYS: readonly ArmedSortKey[] = [
  "campaign",
  "arm",
  "event",
  "acting",
  "dailyBudget",
  "netChange",
  "metric",
  "vsTarget",
  "vsCap",
  "results",
];

const TEXT_FIRST_ASC: ReadonlySet<ArmedSortKey> = new Set([
  "campaign",
  "arm",
  "event",
  "acting",
]);

export type AbsentReason =
  | "no target set"
  | "no cap"
  | "no tick yet"
  | "no writes yet"
  | "derived cap not on this view";

export type AbsentCell = {
  kind: "absent";
  reason: AbsentReason;
};

export type VsTargetPresent = {
  kind: "present";
  metric: string;
  metricLatest: number;
  target: number;
  ratio: number;
  percent: number;
  detail: string;
};

export type VsCapPresent = {
  kind: "present";
  budgetPence: number;
  capPence: number;
  ratio: number;
  percent: number;
  detail: string;
};

export type VsTargetCell = VsTargetPresent | AbsentCell;
export type VsCapCell = VsCapPresent | AbsentCell;

export function isEndedArmedRow(row: Pick<ArmedCampaignRow, "lastDecision">): boolean {
  const action = row.lastDecision?.action;
  return action === "skip_event_passed" || action === "skip_campaign_ended";
}

export function partitionArmedRows(rows: readonly ArmedCampaignRow[]): {
  active: ArmedCampaignRow[];
  ended: ArmedCampaignRow[];
} {
  const active: ArmedCampaignRow[] = [];
  const ended: ArmedCampaignRow[] = [];
  for (const row of rows) {
    if (isEndedArmedRow(row)) ended.push(row);
    else active.push(row);
  }
  return { active, ended };
}

export function effectiveTarget(controls: ArmedCampaignControls): number | null {
  const value =
    (controls.useOverride ? controls.campaignTargetValue : null) ??
    controls.accountBenchmarkValue;
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function higherIsBetter(metric: string): boolean {
  return metric === "roas" || metric === "ctr";
}

export function vsTarget(row: ArmedCampaignRow): VsTargetCell {
  const latest = row.impact.metricLatest;
  const metric = row.impact.metric ?? row.controls.primaryMetric;
  const target = effectiveTarget(row.controls);
  if (latest == null || !Number.isFinite(latest) || !metric) {
    return { kind: "absent", reason: "no tick yet" };
  }
  if (target == null) {
    return { kind: "absent", reason: "no target set" };
  }
  const ratio = higherIsBetter(metric)
    ? latest > 0
      ? target / latest
      : Number.POSITIVE_INFINITY
    : latest / target;
  const percent = Number.isFinite(ratio) ? Math.round(ratio * 100) : Number.MAX_SAFE_INTEGER;
  return {
    kind: "present",
    metric,
    metricLatest: latest,
    target,
    ratio,
    percent,
    detail: `${metric} ${formatPoint(latest)} / target ${formatPoint(target)} · ${percent}%`,
  };
}

export function budgetBaseFromDraft(input: {
  budgetLevel?: "ad_set" | "campaign";
  budgetAmount?: number | null;
  adSets?: Array<{ id: string; enabled?: boolean; budgetPerDay?: number }>;
}): ArmedBudgetBase {
  const level = input.budgetLevel ?? "ad_set";
  if (level === "campaign") {
    const amount = input.budgetAmount;
    const dailyPence =
      amount != null && Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
    const enabled = (input.adSets ?? []).filter((row) => row.enabled !== false);
    return {
      kind: "campaign",
      source: "draft",
      dailyPence,
      adSetCount: enabled.length > 0 ? enabled.length : dailyPence != null ? 1 : 0,
      byAdSet: {},
    };
  }
  const byAdSet: Record<string, number> = {};
  for (const row of input.adSets ?? []) {
    if (row.enabled === false) continue;
    if (row.budgetPerDay != null && Number.isFinite(row.budgetPerDay) && row.budgetPerDay > 0) {
      byAdSet[row.id] = Math.round(row.budgetPerDay * 100);
    }
  }
  const keys = Object.keys(byAdSet);
  return {
    kind: "ad_set",
    source: "draft",
    dailyPence: keys.length === 0 ? null : sumPence(byAdSet, keys),
    adSetCount: keys.length,
    byAdSet,
  };
}

export function budgetBaseFromLaunched(
  rows: ReadonlyArray<{ metaAdsetId: string; initialDailyBudgetPence: number | null }>,
): ArmedBudgetBase | null {
  if (rows.length === 0) return null;
  const byAdSet: Record<string, number> = {};
  for (const row of rows) {
    if (row.initialDailyBudgetPence == null || !Number.isFinite(row.initialDailyBudgetPence)) {
      continue;
    }
    if (row.initialDailyBudgetPence > 0) {
      byAdSet[row.metaAdsetId] = Math.round(row.initialDailyBudgetPence);
    }
  }
  const keys = Object.keys(byAdSet);
  if (keys.length === 0) return null;
  return {
    kind: "ad_set",
    source: "launched",
    dailyPence: sumPence(byAdSet, keys),
    adSetCount: keys.length,
    byAdSet,
  };
}

export function pickBudgetBase(
  draft: ArmedBudgetBase,
  launched: ArmedBudgetBase | null,
): ArmedBudgetBase {
  if (launched && launched.dailyPence != null) return launched;
  return draft;
}

export function resolveDailyBudget(row: ArmedCampaignRow): {
  pence: number | null;
  adSetCount: number;
} {
  const base = row.budgetBase;
  const impact = row.impact;
  if (impact.writeCampaignPence != null) {
    return {
      pence: impact.writeCampaignPence,
      adSetCount: Math.max(base.adSetCount, 1),
    };
  }
  const launchedOrDraftIds = base.source === "launched" || impact.adSetCount === 0;
  if (launchedOrDraftIds) {
    const map = { ...base.byAdSet, ...impact.writeByAdSetPence };
    const keys = Object.keys(map);
    if (keys.length > 0) {
      return {
        pence: sumPence(map, keys),
        adSetCount: keys.length,
      };
    }
    if (base.dailyPence != null) {
      return { pence: base.dailyPence, adSetCount: base.adSetCount };
    }
  }
  if (impact.currentDailyBudgetPence != null) {
    return { pence: impact.currentDailyBudgetPence, adSetCount: impact.adSetCount };
  }
  if (base.dailyPence != null) {
    return { pence: base.dailyPence, adSetCount: base.adSetCount };
  }
  return { pence: null, adSetCount: 0 };
}

export function emptyBudgetBase(): ArmedBudgetBase {
  return {
    kind: "ad_set",
    source: "draft",
    dailyPence: null,
    adSetCount: 0,
    byAdSet: {},
  };
}

export function bindingCapPence(
  controls: ArmedCampaignControls,
  adSetCount: number,
): { pence: number } | { absent: true; reason: "no cap" | "derived cap not on this view" } {
  const scope = controls.guardrails.budgetCeilingScope ?? "ad_set";
  const source = controls.guardrails.campaignDailyCeilingSource ?? "derived";
  if ((scope === "campaign" || scope === "both") && source !== "typed") {
    return { absent: true, reason: "derived cap not on this view" };
  }

  const candidates: number[] = [];
  const hard = controls.hardBudgetCeiling;
  if (typeof hard === "number" && Number.isFinite(hard) && hard > 0) {
    candidates.push(Math.round(hard * 100));
  }

  const maxSingle = controls.guardrails.maxSingleAdSetBudget;
  if (
    maxSingle != null &&
    Number.isFinite(maxSingle) &&
    maxSingle > 0 &&
    scope !== "campaign" &&
    adSetCount > 0
  ) {
    const type = controls.guardrails.maxSingleAdSetBudgetType ?? "fixed";
    const perAdSetPence =
      type === "percent"
        ? Math.round((readBaseAdSetBudget(controls.guardrails) * 100 * maxSingle) / 100)
        : Math.round(maxSingle * 100);
    if (perAdSetPence > 0) {
      candidates.push(perAdSetPence * adSetCount);
    }
  }

  if (scope === "campaign" || scope === "both") {
    const typed = controls.guardrails.campaignDailyCeiling;
    if (typed != null && Number.isFinite(typed) && typed > 0) {
      candidates.push(Math.round(typed * 100));
    }
  }

  if (candidates.length === 0) return { absent: true, reason: "no cap" };
  return { pence: Math.min(...candidates) };
}

export function vsCap(row: ArmedCampaignRow): VsCapCell {
  const daily = resolveDailyBudget(row);
  if (daily.pence == null || !Number.isFinite(daily.pence)) {
    return { kind: "absent", reason: "no tick yet" };
  }
  const cap = bindingCapPence(row.controls, daily.adSetCount);
  if ("absent" in cap) {
    return { kind: "absent", reason: cap.reason };
  }
  const ratio = daily.pence / cap.pence;
  const percent = Math.round(ratio * 100);
  const currency = row.controls.currency || "GBP";
  return {
    kind: "present",
    budgetPence: daily.pence,
    capPence: cap.pence,
    ratio,
    percent,
    detail: `${formatMoney(daily.pence, currency)} / ${formatMoney(cap.pence, currency)} · ${percent}%`,
  };
}

export function formatActingCell(
  lastDecision: ArmedLastDecision | null,
  now: Date = new Date(),
): { text: string; title?: string } {
  if (!lastDecision) return { text: "—", title: "no tick yet" };
  return { text: `${lastDecision.action} · ${formatActingAge(lastDecision.at, now)}` };
}

export function formatDailyBudgetCell(
  row: ArmedCampaignRow,
): { text: string; title?: string } {
  const pence = resolveDailyBudget(row).pence;
  if (pence == null) return { text: "—", title: "no tick yet" };
  return { text: formatMoney(pence, row.controls.currency || "GBP") };
}

export function formatNetChangeCell(
  row: ArmedCampaignRow,
): { text: string; title?: string } {
  if (row.impact.writeCount === 0 || row.impact.netDailyBudgetPence == null) {
    return { text: "—", title: "no writes yet" };
  }
  const net = row.impact.netDailyBudgetPence;
  const currency = row.controls.currency || "GBP";
  const signed =
    net > 0
      ? `+${formatMoney(net, currency)}/day`
      : net < 0
        ? `−${formatMoney(Math.abs(net), currency)}/day`
        : `${formatMoney(0, currency)}/day`;
  return { text: `${signed} · ${row.impact.writeCount}` };
}

export function formatMetricCell(
  row: ArmedCampaignRow,
): { text: string; title?: string } {
  const latest = row.impact.metricLatest;
  const metric = row.impact.metric ?? row.controls.primaryMetric;
  if (latest == null || !metric) return { text: "—", title: "no tick yet" };
  return { text: `${metric} ${formatPoint(latest)}` };
}

export function formatResultsCell(
  row: ArmedCampaignRow,
): { text: string; title?: string } {
  if (row.impact.resultLatest == null) return { text: "—", title: "no tick yet" };
  return { text: formatPoint(row.impact.resultLatest) };
}

export function formatPercentCell(
  cell: VsTargetCell | VsCapCell,
): { text: string; title: string } {
  if (cell.kind === "absent") return { text: "—", title: cell.reason };
  return { text: `${cell.percent}%`, title: cell.detail };
}

export function armRank(arm: ArmedCampaignRow["arm"]): number {
  if (arm === "live") return 0;
  if (arm === "shadow") return 1;
  return 2;
}

export function armLabel(arm: ArmedCampaignRow["arm"]): string {
  if (arm === "live") return "Live";
  if (arm === "shadow") return "Shadow";
  return "Off";
}

export function readArmedTableSort(
  read: () => string | null = () => window.localStorage.getItem(ARMED_TABLE_SORT_KEY),
): ArmedSortState {
  try {
    return parseArmedTableSort(read());
  } catch {
    return DEFAULT_ARMED_SORT;
  }
}

export function writeArmedTableSort(sort: ArmedSortState): void {
  try {
    window.localStorage.setItem(ARMED_TABLE_SORT_KEY, JSON.stringify(sort));
  } catch {
    /* quota or private mode */
  }
}

export function parseArmedTableSort(raw: string | null): ArmedSortState {
  if (!raw) return DEFAULT_ARMED_SORT;
  try {
    const parsed = JSON.parse(raw) as { key?: unknown; dir?: unknown };
    const key = SORT_KEYS.includes(parsed.key as ArmedSortKey)
      ? (parsed.key as ArmedSortKey)
      : DEFAULT_ARMED_SORT.key;
    const dir = parsed.dir === "asc" || parsed.dir === "desc" ? parsed.dir : DEFAULT_ARMED_SORT.dir;
    return { key, dir };
  } catch {
    return DEFAULT_ARMED_SORT;
  }
}

export function nextArmedSort(current: ArmedSortState, clicked: ArmedSortKey): ArmedSortState {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, dir: TEXT_FIRST_ASC.has(clicked) ? "asc" : "desc" };
}

export function sortArmedRows(
  rows: readonly ArmedCampaignRow[],
  sort: ArmedSortState,
  now: Date = new Date(),
): ArmedCampaignRow[] {
  const copy = [...rows];
  copy.sort((a, b) => compareArmedRows(a, b, sort, now));
  return copy;
}

export function compareArmedRows(
  a: ArmedCampaignRow,
  b: ArmedCampaignRow,
  sort: ArmedSortState,
  now: Date = new Date(),
): number {
  if (sort.key === "arm") {
    const primary = compareNullable(armRank(a.arm), armRank(b.arm), sort.dir);
    if (primary !== 0) return primary;
    return compareNullable(vsTargetPercent(a), vsTargetPercent(b), "desc");
  }
  const av = sortValue(a, sort.key, now);
  const bv = sortValue(b, sort.key, now);
  if (sort.key === "acting") {
    const actionCmp = compareNullable(actingAction(a), actingAction(b), sort.dir);
    if (actionCmp !== 0) return actionCmp;
    return compareNullable(actingAt(a), actingAt(b), sort.dir);
  }
  return compareNullable(av, bv, sort.dir);
}

function sortValue(
  row: ArmedCampaignRow,
  key: ArmedSortKey,
  now: Date,
): string | number | null {
  switch (key) {
    case "campaign":
      return row.name.toLowerCase();
    case "arm":
      return armRank(row.arm);
    case "event":
      return row.eventLabel?.toLowerCase() ?? null;
    case "acting":
      return actingAction(row);
    case "dailyBudget":
      return resolveDailyBudget(row).pence;
    case "netChange":
      return row.impact.netDailyBudgetPence;
    case "metric":
      return row.impact.metricLatest;
    case "vsTarget":
      return vsTargetPercent(row);
    case "vsCap":
      return vsCapPercent(row);
    case "results":
      return row.impact.resultLatest;
    default:
      void now;
      return null;
  }
}

function actingAction(row: ArmedCampaignRow): string | null {
  return row.lastDecision?.action ?? null;
}

function actingAt(row: ArmedCampaignRow): number | null {
  if (!row.lastDecision) return null;
  const t = new Date(row.lastDecision.at).getTime();
  return Number.isNaN(t) ? null : t;
}

function vsTargetPercent(row: ArmedCampaignRow): number | null {
  const cell = vsTarget(row);
  return cell.kind === "present" ? cell.percent : null;
}

function vsCapPercent(row: ArmedCampaignRow): number | null {
  const cell = vsCap(row);
  return cell.kind === "present" ? cell.percent : null;
}

function compareNullable(
  a: string | number | null,
  b: string | number | null,
  dir: ArmedSortDir,
): number {
  const sign = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * sign;
  }
  return String(a).localeCompare(String(b)) * sign;
}

function formatActingAge(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const mins = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (Math.abs(mins) < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatPoint(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function sumPence(map: Record<string, number>, keys: string[]): number {
  let total = 0;
  for (const key of keys) total += map[key] ?? 0;
  return total;
}

function formatMoney(pence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);
}
