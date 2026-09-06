/**
 * ADJUST face copy — canon §2.3 + amendments; frames J1–J22.
 * Read only. Does not import evaluate.ts / apply.ts / crons.
 */

import { formatPaceSentence } from "../viz/pace.ts";
import { formatVizDay } from "../viz/format-moment.ts";
import {
  VIZ_ACTION_WORD,
  VIZ_LOCKED_CLIENT_CREATIVE,
  VIZ_TICKET_LINE_WORD,
  type VizAction,
  type VizDeltaTone,
  type VizLineKind,
} from "../viz/tokens.ts";
import type { MetricChipBenchmark } from "../viz/metric-chip.ts";
import type { CampaignPlanLaunches } from "./types.ts";

export const ADJUST_INFO_VARIANT = "card" as const;
export const ADJUST_PHASE_LABEL = "before general sale" as const;
export const ADJUST_LOG_TITLE = "changes · last 7 days" as const;
export const ADJUST_PAGE_VIEWS_EMPTY =
  "not measured — this show's page is not on our beacon";
export const ADJUST_CHANNEL_NO_READS = "no reads yet";
export const ADJUST_APPLY_NEXT_CHECK = "applied at the next check";
/** No operator apply route exists — `do it` must not call nothing. */
export const ADJUST_OPERATOR_APPLY_PATH = false;

/** J1 — Meta's first rollup is 08:00 London the next morning (vercel.json rollup-sync). */
export const ADJUST_NO_READS = "no reads yet — Meta's first day arrives at 08:00 tomorrow";

/** J7 — brief §4 (Modern Funktion). n = 0 is undefined from planBenchmark. */
export const ADJUST_NO_USUAL = "no usual yet — opens after your first finished NX show";

/** J19 — last snapshot day is substituted at the view; this is the NX example. */
export const ADJUST_CREATIVE_STALE = "by creative name · no reads since Tue 26 Aug";

export const ADJUST_PLACEMENT_EMPTY = "instagram · — · not read yet";

export const ADJUST_LOG_EMPTY = "nothing yet — the first check is at 13:00";

export const OPTIMISATION_TICK_UTC_HOURS = [0, 4, 8, 12, 16, 20] as const;

export function formatGbp(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  if (Number.isInteger(rounded) || rounded >= 10) {
    return `£${Math.round(rounded).toLocaleString("en-GB")}`;
  }
  return `£${rounded.toFixed(2)}`;
}

export function formatPaceSums(spent: number, planned: number): string {
  return formatPaceSentence(spent, planned);
}

export function formatCostPerUnit(value: number, unitWord: string): string {
  return `${formatGbp(value)} per ${unitWord}`;
}

export function formatAgainstUsual(
  value: number,
  unitWord: string,
  usual: number,
): string {
  const relation = value < usual ? "under" : value > usual ? "above" : "within";
  return `${formatCostPerUnit(value, unitWord)} · ${relation} your usual ${formatGbp(usual)}`;
}

export function formatNoUsual(venueLabel = "NX"): string {
  return venueLabel === "NX"
    ? ADJUST_NO_USUAL
    : `no usual yet — opens after your first finished ${venueLabel} show`;
}

export function formatSuggestion(input: {
  action: VizAction;
  adSetName: string;
  deltaPercent: number;
  cost: number;
  unitWord: string;
  usual?: number;
  results: number;
  windowWord: string;
}): string {
  const verb = VIZ_ACTION_WORD[input.action].suggest;
  const name = `"${input.adSetName}"`;
  const lead =
    input.action === "pause"
      ? `${capitalize(verb)} ${name}`
      : `${capitalize(verb)} ${name} by ${input.deltaPercent}%`;
  const usualBit =
    input.usual != null
      ? `, ${input.cost < input.usual ? "under" : input.cost > input.usual ? "above" : "within"} your usual ${formatGbp(input.usual)}`
      : "";
  return `${lead} — ${formatCostPerUnit(input.cost, input.unitWord)}${usualBit}, ${input.results} ${input.unitWord}s ${input.windowWord}.`;
}

export function formatChannelEarnedNothing(input: {
  channel: string;
  unitWord: string;
  spend: number;
  spendSharePct: number;
}): string {
  const verb = VIZ_ACTION_WORD.pause.suggest;
  return `${capitalize(verb)} ${input.channel} — 0 ${input.unitWord}s on ${formatGbp(input.spend)} (${input.spendSharePct}% of spend) since launch.`;
}

export function formatChannelReading(input: {
  name: string;
  resultShare: number | null;
  spendShare: number | null;
}): string {
  if (input.resultShare == null || input.spendShare == null) {
    return `${input.name} · ${ADJUST_CHANNEL_NO_READS}`;
  }
  return `${input.name} · ${input.resultShare}% of results · ${input.spendShare}% of spend`;
}

export function formatPurchaseDisagreement(input: {
  metaPurchases: number;
  tickets: number;
}): string {
  const gap = Math.abs(input.metaPurchases - input.tickets);
  const counts = `Meta says ${input.metaPurchases.toLocaleString("en-GB")} purchases · tickets ${input.tickets.toLocaleString("en-GB")}`;
  if (gap === 0) return counts;
  if (input.metaPurchases > input.tickets) {
    return `${counts} · ${gap.toLocaleString("en-GB")} unexplained`;
  }
  return `${counts} · Meta counts ${gap.toLocaleString("en-GB")} fewer`;
}

export function formatMetaSays(count: number, noun: string): string {
  return `Meta says ${count.toLocaleString("en-GB")} ${noun}`;
}

export function formatOurTagNotMeasured(domain: string): string {
  return `our tag: not measured for this show — signups are collected on ${domain} and are not synced here`;
}

export function formatTicketLine(
  source: keyof typeof VIZ_TICKET_LINE_WORD,
  count?: number,
): string {
  const word = VIZ_TICKET_LINE_WORD[source];
  if (source === "none") return `tickets: ${word} — enter ticket sales on the event`;
  if (count == null) return `tickets ${word}`;
  return `${count.toLocaleString("en-GB")} tickets · ${word}`;
}

export function formatCreativeStale(lastReadDay: string | null): string {
  return lastReadDay
    ? `by creative name · no reads since ${lastReadDay}`
    : "by creative name · no reads yet";
}

export function formatCreativeLocked(
  role: "operator" | "client",
  lastReadDay?: string | null,
): string {
  return role === "client" ? VIZ_LOCKED_CLIENT_CREATIVE : formatCreativeStale(lastReadDay ?? null);
}

export function formatClientCreativeLock(): string {
  return VIZ_LOCKED_CLIENT_CREATIVE;
}

export function formatLogDid(input: {
  action: VizAction;
  adSetName: string;
  extras?: string;
}): string {
  const did = VIZ_ACTION_WORD[input.action].did;
  const name = `"${input.adSetName}"`;
  return input.extras ? `${capitalize(did)} ${name} ${input.extras}` : `${capitalize(did)} ${name}`;
}

export function formatRefusal(adSetName: string, needed: number, have: number, unitWord: string): string {
  const template = VIZ_ACTION_WORD.insufficient_conversions.did
    .replace("{n}", String(have))
    .replace("{min}", String(needed))
    .replace("{unit}s", `${unitWord}s`);
  return `"${adSetName}" ${template}`;
}

export function formatLeftAlone(count: number): string {
  const noun = count === 1 ? "ad set" : "ad sets";
  return `${count} ${noun} left alone`;
}

export function formatUndoUntil(nextCheck: string): string {
  return `undo until the next check at ${nextCheck}`;
}

export function formatLogEmpty(now: Date = new Date()): string {
  return `nothing yet — the first check is at ${nextCheckClock(now)}`;
}

/**
 * Next optimisation-tick clock in London, from `0 *\/4 * * *` (UTC hours
 * 0/4/8/12/16/20). Never a constant 13:00.
 */
export function nextCheckClock(now: Date = new Date()): string {
  const utcHour = now.getUTCHours();
  let nextHour = OPTIMISATION_TICK_UTC_HOURS.find((hour) => hour > utcHour);
  const next = new Date(now);
  if (nextHour == null) {
    nextHour = OPTIMISATION_TICK_UTC_HOURS[0]!;
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(nextHour, 0, 0, 0);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(next);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export function logDayHeading(iso: string): string {
  return formatVizDay(iso);
}

export function adjustControlsVisible(role: "operator" | "client"): {
  suggestion: boolean;
  doIt: boolean;
  notNow: boolean;
  undo: boolean;
} {
  const operator = role !== "client";
  return { suggestion: operator, doIt: operator, notNow: operator, undo: operator };
}

/** PR 3 unmerged: the interface already returns undefined → J7. */
export function adjustBenchmarkOrUsual(
  benchmark: MetricChipBenchmark | undefined,
): { benchmark: MetricChipBenchmark | undefined; noUsual: string } {
  return { benchmark, noUsual: ADJUST_NO_USUAL };
}

export function adjustInfoHeader(unitWord: string): string {
  if (unitWord === "purchase") return "ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND";
  if (unitWord === "thousand reached" || unitWord === "view") {
    return "ESTIMATED · META'S REACH, YOUR SPEND";
  }
  return "ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND";
}

export function planLaunchedAt(launches: CampaignPlanLaunches): string | null {
  const stamps = (["meta", "tiktok", "google"] as const)
    .map((adapter) => launches[adapter].createdAt)
    .filter((value): value is string => Boolean(value?.trim()));
  return stamps.sort()[0] ?? null;
}

export function paceToneFor(spent: number, planned: number): VizDeltaTone {
  if (planned <= 0 || spent === planned) return "none";
  return spent > planned ? "below" : "above";
}

const DAY_MS = 86_400_000;

export function londonDayKey(input: Date | string): string {
  const at = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(at.getTime())) return "unknown";
  return at.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Whole London days from `since` to `now`, not inclusive of today as a started day-0. */
export function elapsedLondonDays(since: Date, now: Date): number {
  const start = Date.parse(`${londonDayKey(since)}T12:00:00Z`);
  const end = Date.parse(`${londonDayKey(now)}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / DAY_MS));
}

export function plannedSpendByToday(dailyGbp: number, since: Date, now: Date): number {
  if (!Number.isFinite(dailyGbp) || dailyGbp <= 0) return 0;
  return dailyGbp * elapsedLondonDays(since, now);
}

export function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function adSetNameFromReason(reasonText: string): string | null {
  const match = reasonText.match(/"([^"]+)"/);
  return match?.[1] ?? null;
}

export function decisionAdSetName(row: {
  adsetName?: string | null;
  reasonText: string;
}): string {
  const named = row.adsetName?.trim();
  if (named) return named;
  return "ad set";
}

export function writeGatesOpen(input: {
  writesEnabled: boolean;
  enabled: boolean;
  live: boolean;
}): boolean {
  return input.writesEnabled && input.enabled && input.live;
}

export function costPerCount(spend: number, count: number | null): number | null {
  if (count == null || count <= 0 || spend < 0) return null;
  return spend / count;
}

export function formatMetaSaysCost(value: number, unitWord: string): string {
  return `Meta says ${formatCostPerUnit(value, unitWord)}`;
}

export function windowWordFromMetric(window: string): string {
  if (window === "7d") return "this week";
  if (window === "24h") return "today";
  return window;
}

export function deltaPercentFromBudgets(
  beforePence: number | null,
  afterPence: number | null,
): number | null {
  if (beforePence == null || afterPence == null || beforePence <= 0) return null;
  return Math.round((Math.abs(afterPence - beforePence) / beforePence) * 100);
}

/** Visible strings for a J-state. A state without a test will drift. */
export type AdjustJState =
  | "J1"
  | "J2"
  | "J3"
  | "J5"
  | "J7"
  | "J8"
  | "J9"
  | "J12"
  | "J14"
  | "J16"
  | "J17"
  | "J18"
  | "J19"
  | "J22"
  | "J23"
  | "J24";

export function adjustFaceSentences(state: AdjustJState): string[] {
  switch (state) {
    case "J1":
      return [ADJUST_NO_READS, ADJUST_LOG_EMPTY];
    case "J2":
    case "J24":
      return [formatPaceSums(558, 350), ADJUST_PHASE_LABEL];
    case "J3":
      return [formatPaceSums(2588, 3300)];
    case "J5":
    case "J16":
      return [
        formatSuggestion({
          action: "scale_up",
          adSetName: "Tech House Pages",
          deltaPercent: 15,
          cost: 1.1,
          unitWord: "signup",
          usual: 2.03,
          results: 38,
          windowWord: "this week",
        }),
      ];
    case "J7":
      return [ADJUST_NO_USUAL];
    case "J8":
      return [formatPurchaseDisagreement({ metaPurchases: 74, tickets: 558 })];
    case "J9":
      return [
        formatMetaSays(1086, "signups"),
        formatOurTagNotMeasured("dod-newcastle.com"),
      ];
    case "J12":
      return [
        formatChannelEarnedNothing({
          channel: "Meta",
          unitWord: "signup",
          spend: 6657,
          spendSharePct: 99,
        }),
      ];
    case "J14":
      return [formatUndoUntil("13:00")];
    case "J17":
      return [ADJUST_LOG_TITLE];
    case "J18":
      return [formatRefusal("Disco Pages", 5, 3, "signup")];
    case "J19":
      return [ADJUST_CREATIVE_STALE];
    case "J22":
      return [VIZ_LOCKED_CLIENT_CREATIVE, formatCreativeLocked("client")];
    case "J23":
      return [ADJUST_PHASE_LABEL];
    default:
      return [];
  }
}

export type AdjustDecisionRow = {
  decidedAt: string;
  action: string;
  reasonText: string;
  resultCount: number | null;
  applied: boolean;
  dryRun: boolean;
  adsetId?: string | null;
  adsetName?: string | null;
  budgetBeforePence?: number | null;
  budgetAfterPence?: number | null;
  metricValue?: number | null;
  metricWindow?: string | null;
};

export type AdjustLogRow =
  | { kind: "did"; action: "scale_up" | "scale_down" | "maintain" | "pause"; adSetName: string; extras?: string; undo?: boolean }
  | { kind: "refusal"; adSetName: string; needed: number; have: number; unitWord: string }
  | { kind: "collapse"; count: number };

export type AdjustLogDay = { at: string; rows: AdjustLogRow[] };

export function adjustLogFromDecisions(
  rows: readonly AdjustDecisionRow[],
  unitWord: string,
  now: Date = new Date(),
  needed = 5,
): AdjustLogDay[] {
  const cutoff = now.getTime() - 7 * DAY_MS;
  const byDay = new Map<string, AdjustDecisionRow[]>();
  for (const row of rows) {
    const at = Date.parse(row.decidedAt);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const key = londonDayKey(row.decidedAt);
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }
  const days: AdjustLogDay[] = [];
  for (const [at, dayRows] of byDay) {
    let leftAlone = 0;
    const visible: AdjustLogRow[] = [];
    for (const row of dayRows) {
      if (row.action === "insufficient_conversions") {
        visible.push({
          kind: "refusal",
          adSetName: decisionAdSetName(row),
          needed,
          have: row.resultCount ?? 0,
          unitWord,
        });
        continue;
      }
      if (row.action === "maintain" || row.action.startsWith("skip_")) {
        leftAlone += 1;
        continue;
      }
      if (row.action === "scale_up" || row.action === "scale_down" || row.action === "pause") {
        visible.push({
          kind: "did",
          action: row.action,
          adSetName: decisionAdSetName(row),
          undo: row.applied && !row.dryRun,
        });
      }
    }
    if (leftAlone > 0) visible.push({ kind: "collapse", count: leftAlone });
    if (visible.length > 0) days.push({ at, rows: visible });
  }
  return days;
}

export type AdjustChannelRead = {
  name: string;
  spend: number;
  results: number | null;
};

export type AdjustWindowReads = {
  spend: number;
  metaRegs: number;
  metaPurchases: number;
  tickets: number;
  reach: number;
  clicks: number;
  landingPageViews: number;
  firstPartyLpv: number | null;
  dailyCostPerSignup: number[];
  channels: AdjustChannelRead[];
  lastCreativeSnapshotAt: string | null;
};

export type AdjustFaceInput = {
  role?: "operator" | "client";
  spent: number;
  planned: number;
  metaSignups: number | null;
  metaPurchases: number | null;
  tickets: number | null;
  ticketSource: keyof typeof VIZ_TICKET_LINE_WORD;
  venueName?: string | null;
  launchedAt?: string | null;
  now?: Date;
  generalSaleAt?: string | Date | null;
  benchmark?: MetricChipBenchmark;
  decisions?: readonly AdjustDecisionRow[];
  writeGates?: { writesEnabled: boolean; enabled: boolean; live: boolean };
  operatorApplyPath?: boolean;
  channels?: readonly AdjustChannelRead[];
  reach?: number | null;
  clicks?: number | null;
  pageViews?: number | null;
  tagDomain?: string | null;
  lastCreativeSnapshotAt?: string | null;
  trend?: number[] | null;
  endSet?: boolean;
  windowStart?: Date;
  unitWord?: string;
};

export type AdjustFaceView = {
  paceSentence: string;
  paceTone: VizDeltaTone;
  windowEmpty: false;
  endLabel: string | undefined;
  windowStart: Date | null;
  noReads: boolean;
  signupCost: number | null;
  signupLine: string | null;
  signupPhaseLabel: string | undefined;
  purchaseCost: number | null;
  purchaseLine: string | null;
  noUsual: string | null;
  infoHeader: string;
  purchaseInfoHeader: string;
  suggestionSentence: string | null;
  notNow: boolean;
  doIt: boolean;
  applyTip: string | null;
  channelLines: string[];
  earnedNothingSentence: string | null;
  creativeSentence: string;
  stageLines: string[];
  ticketLine: string;
  purchaseDisagreement: string | null;
  logDays: AdjustLogDay[];
  logEmpty: string;
  trend: number[] | undefined;
  lineKind: VizLineKind;
};

export function suggestionFromDecisions(
  rows: readonly AdjustDecisionRow[],
  input: { unitWord: string; cost: number | null; usual?: number | null },
): {
  action: "scale_up" | "scale_down" | "pause";
  adSetName: string;
  deltaPercent: number;
  cost: number;
  usual?: number;
  results: number;
  windowWord: string;
} | null {
  const actionable = rows
    .filter(
      (row) =>
        (row.action === "scale_up" || row.action === "scale_down" || row.action === "pause") &&
        (row.resultCount != null || row.metricValue != null),
    )
    .slice()
    .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt));
  const row = actionable[0];
  if (!row || input.cost == null) return null;
  const action = row.action as "scale_up" | "scale_down" | "pause";
  const delta =
    action === "pause"
      ? 0
      : (deltaPercentFromBudgets(row.budgetBeforePence ?? null, row.budgetAfterPence ?? null) ?? 0);
  return {
    action,
    adSetName: decisionAdSetName(row),
    deltaPercent: delta,
    cost: input.cost,
    usual: input.usual ?? undefined,
    results: row.resultCount ?? 0,
    windowWord: windowWordFromMetric(row.metricWindow ?? "24h"),
  };
}

export function channelShareLines(
  channels: readonly AdjustChannelRead[],
): string[] {
  const totalSpend = channels.reduce((sum, row) => sum + Math.max(0, row.spend), 0);
  const totalResults = channels.reduce(
    (sum, row) => sum + (row.results != null && row.results > 0 ? row.results : 0),
    0,
  );
  return channels.map((row) => {
    const hasReads = row.spend > 0 || (row.results != null && row.results > 0);
    if (!hasReads || totalSpend <= 0) {
      return formatChannelReading({ name: row.name, resultShare: null, spendShare: null });
    }
    const spendShare = Math.round((row.spend / totalSpend) * 100);
    const resultShare = totalResults > 0 && row.results != null
      ? Math.round((row.results / totalResults) * 100)
      : 0;
    return formatChannelReading({ name: row.name, resultShare, spendShare });
  });
}

export function formatStageLines(input: {
  reach: number | null;
  clicks: number | null;
  pageViews: number | null;
  metaSignups: number | null;
  tickets: number | null;
  ticketSource: keyof typeof VIZ_TICKET_LINE_WORD;
  tagDomain?: string | null;
}): string[] {
  const lines: string[] = [];
  lines.push(
    input.reach != null && input.reach > 0
      ? `reach · ${input.reach.toLocaleString("en-GB")}`
      : "reach · no reads yet",
  );
  lines.push(
    input.clicks != null && input.clicks > 0
      ? `clicks · ${input.clicks.toLocaleString("en-GB")}`
      : "clicks · no reads yet",
  );
  lines.push(
    input.pageViews != null && input.pageViews > 0
      ? `page views · ${input.pageViews.toLocaleString("en-GB")}`
      : `page views · ${ADJUST_PAGE_VIEWS_EMPTY}`,
  );
  if (input.metaSignups != null) {
    lines.push(formatMetaSays(input.metaSignups, "signups"));
  } else {
    lines.push("signups · no reads yet");
  }
  if (input.tagDomain) lines.push(formatOurTagNotMeasured(input.tagDomain));
  lines.push(formatTicketLine(input.ticketSource, input.tickets ?? undefined));
  return lines;
}

/** The view the ADJUST surface renders. Tests assert these strings. */
export function adjustFaceView(input: AdjustFaceInput): AdjustFaceView {
  const now = input.now ?? new Date();
  const role = input.role ?? "operator";
  const unitWord = input.unitWord ?? "signup";
  const controls = adjustControlsVisible(role);
  const noReads = input.spent <= 0 && input.metaSignups == null;
  const paceSentence = noReads ? ADJUST_NO_READS : formatPaceSums(input.spent, input.planned);
  const signupCost = costPerCount(input.spent, input.metaSignups);
  const purchaseCost = costPerCount(input.spent, input.metaPurchases);
  const genSale = input.generalSaleAt
    ? input.generalSaleAt instanceof Date
      ? input.generalSaleAt
      : new Date(input.generalSaleAt)
    : null;
  const launchedAt = input.launchedAt ? new Date(input.launchedAt) : null;
  const salePassed = Boolean(
    genSale && !Number.isNaN(genSale.getTime()) && now.getTime() >= genSale.getTime(),
  );
  const launchedBeforeSale = Boolean(
    launchedAt &&
      genSale &&
      !Number.isNaN(launchedAt.getTime()) &&
      !Number.isNaN(genSale.getTime()) &&
      launchedAt.getTime() < genSale.getTime(),
  );
  const showKeptSignup = salePassed && launchedBeforeSale;
  const noUsual = input.benchmark ? null : formatNoUsual(input.venueName?.trim() || "NX");
  const suggestion = suggestionFromDecisions(input.decisions ?? [], {
    unitWord,
    cost: signupCost ?? purchaseCost,
    usual: input.benchmark?.value ?? null,
  });
  const gatesOpen = writeGatesOpen(
    input.writeGates ?? { writesEnabled: false, enabled: false, live: false },
  );
  const applyPath = input.operatorApplyPath === true && ADJUST_OPERATOR_APPLY_PATH;
  const suggestionSentence =
    controls.suggestion && suggestion ? formatSuggestion({ ...suggestion, unitWord }) : null;
  const windowStart = input.launchedAt
    ? new Date(input.launchedAt)
    : (input.windowStart ?? null);
  const lastCreativeDay = input.lastCreativeSnapshotAt
    ? formatVizDay(input.lastCreativeSnapshotAt)
    : null;
  const earned = (input.channels ?? []).find((row) => row.spend > 0 && (row.results ?? 0) === 0);
  const totalSpend = (input.channels ?? []).reduce((sum, row) => sum + row.spend, 0);
  const earnedNothingSentence = earned
    ? formatChannelEarnedNothing({
        channel: earned.name,
        unitWord,
        spend: earned.spend,
        spendSharePct: totalSpend > 0 ? Math.round((earned.spend / totalSpend) * 100) : 0,
      })
    : null;

  return {
    paceSentence,
    paceTone: paceToneFor(input.spent, input.planned),
    windowEmpty: false,
    endLabel: input.endSet === false ? "end not set" : undefined,
    windowStart,
    noReads,
    signupCost,
    signupLine:
      signupCost != null
        ? input.benchmark
          ? formatAgainstUsual(signupCost, "signup", input.benchmark.value)
          : formatCostPerUnit(signupCost, "signup")
        : null,
    signupPhaseLabel: showKeptSignup ? ADJUST_PHASE_LABEL : undefined,
    purchaseCost,
    purchaseLine: purchaseCost != null ? formatMetaSaysCost(purchaseCost, "purchase") : null,
    noUsual,
    infoHeader: adjustInfoHeader("signup"),
    purchaseInfoHeader: adjustInfoHeader("purchase"),
    suggestionSentence,
    notNow: Boolean(suggestionSentence && controls.notNow),
    doIt: Boolean(suggestionSentence && controls.doIt && gatesOpen && applyPath),
    applyTip: suggestionSentence ? ADJUST_APPLY_NEXT_CHECK : null,
    channelLines: channelShareLines(input.channels ?? []),
    earnedNothingSentence,
    creativeSentence: formatCreativeLocked(role, lastCreativeDay),
    stageLines: formatStageLines({
      reach: input.reach ?? null,
      clicks: input.clicks ?? null,
      pageViews: input.pageViews ?? null,
      metaSignups: input.metaSignups,
      tickets: input.tickets,
      ticketSource: input.ticketSource,
      tagDomain: input.tagDomain,
    }),
    ticketLine: formatTicketLine(input.ticketSource, input.tickets ?? undefined),
    purchaseDisagreement:
      input.metaPurchases != null && input.tickets != null
        ? formatPurchaseDisagreement({
            metaPurchases: input.metaPurchases,
            tickets: input.tickets,
          })
        : null,
    logDays: adjustLogFromDecisions(input.decisions ?? [], unitWord, now),
    logEmpty: formatLogEmpty(now),
    trend: input.trend && input.trend.length > 0 ? [...input.trend] : undefined,
    lineKind: input.benchmark?.lineKind ?? (signupCost != null ? "measured" : "not-yet"),
  };
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
