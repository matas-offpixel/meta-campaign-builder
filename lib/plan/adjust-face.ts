/**
 * ADJUST face copy — canon §2.3 + amendments; frames J1–J22.
 * Read only. Does not import evaluate.ts / apply.ts / crons.
 */

import { formatPaceSentence } from "../viz/pace.ts";
import { formatVizDay } from "../viz/format-moment.ts";
import {
  VIZ_ACTION_WORD,
  VIZ_CLIENT_SAFE,
  VIZ_LOCKED_CLIENT_CREATIVE,
  VIZ_TICKET_LINE_WORD,
  type VizAction,
} from "../viz/tokens.ts";
import type { MetricChipBenchmark } from "../viz/metric-chip.ts";

export const ADJUST_INFO_VARIANT = "card" as const;
export const ADJUST_PHASE_LABEL = "before general sale" as const;
export const ADJUST_LOG_TITLE = "changes · last 7 days" as const;

/** J1 — Meta's first rollup is 08:00 London the next morning (vercel.json rollup-sync). */
export const ADJUST_NO_READS = "no reads yet — Meta's first day arrives at 08:00 tomorrow";

/** J7 — brief §4 (Modern Funktion). n = 0 is undefined from planBenchmark. */
export const ADJUST_NO_USUAL = "no usual yet — opens after your first finished NX show";

/** J19 — last snapshot Tue 26 Aug (G32). */
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
  usual: number;
  results: number;
  windowWord: string;
}): string {
  const verb = VIZ_ACTION_WORD[input.action].suggest;
  const name = `"${input.adSetName}"`;
  return `${capitalize(verb)} ${name} by ${input.deltaPercent}% — ${formatCostPerUnit(input.cost, input.unitWord)}, ${input.cost < input.usual ? "under" : "above"} your usual ${formatGbp(input.usual)}, ${input.results} ${input.unitWord}s ${input.windowWord}.`;
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

export function formatPurchaseDisagreement(input: {
  metaPurchases: number;
  tickets: number;
}): string {
  const gap = Math.abs(input.metaPurchases - input.tickets);
  return `Meta says ${input.metaPurchases.toLocaleString("en-GB")} purchases · tickets ${input.tickets.toLocaleString("en-GB")} · Meta counts ${gap.toLocaleString("en-GB")} ${input.metaPurchases < input.tickets ? "fewer" : "more"}`;
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

export function formatCreativeLocked(role: "operator" | "client"): string {
  return role === "client" ? VIZ_CLIENT_SAFE(ADJUST_CREATIVE_STALE) : ADJUST_CREATIVE_STALE;
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

export function writeGatesOpen(input: {
  writesEnabled: boolean;
  enabled: boolean;
  live: boolean;
}): boolean {
  return input.writesEnabled && input.enabled && input.live;
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
        const name = adSetNameFromReason(row.reasonText);
        if (name) {
          visible.push({
            kind: "refusal",
            adSetName: name,
            needed,
            have: row.resultCount ?? 0,
            unitWord,
          });
        }
        continue;
      }
      if (row.action === "maintain" || row.action.startsWith("skip_")) {
        leftAlone += 1;
        continue;
      }
      if (row.action === "scale_up" || row.action === "scale_down" || row.action === "pause") {
        const name = adSetNameFromReason(row.reasonText);
        if (!name) {
          leftAlone += 1;
          continue;
        }
        visible.push({
          kind: "did",
          action: row.action,
          adSetName: name,
          undo: row.applied && !row.dryRun,
        });
      }
    }
    if (leftAlone > 0) visible.push({ kind: "collapse", count: leftAlone });
    if (visible.length > 0) days.push({ at, rows: visible });
  }
  return days;
}

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}
