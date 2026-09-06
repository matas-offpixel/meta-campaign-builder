/**
 * Plan list — canon §2.1 / frames L1–L6, L3-768.
 * Words and state set are fixed. Do not add a sixth state word.
 */

import { formatVizDay } from "../viz/format-moment.ts";
import { VIZ_PLATFORM_LABEL, VIZ_STATE_WORD, type VizPlatform } from "../viz/tokens.ts";
import { planWindowValidity } from "./canvas-inputs.ts";
import { collectPlanPreflightBlockers, type PlanPreflightIssue } from "./preflight.ts";
import type { CampaignPlanStatus } from "./types.ts";

export const PLAN_LIST_TABS = ["running", "drafts", "done", "templates"] as const;
export type PlanListChromeTab = (typeof PLAN_LIST_TABS)[number];
export type PlanListTab = Exclude<PlanListChromeTab, "templates">;

export const PLAN_LIST_TAB_WORD: Record<PlanListChromeTab, string> = {
  running: "running",
  drafts: "drafts",
  done: "done",
  templates: "templates",
};

export const PLAN_LIST_EMPTY = {
  sentence: "no plans yet",
  action: "new plan",
} as const;

export const PLAN_LIST_OPEN = "open ▸";
export const PLAN_LIST_CHOOSE_EVENT = "choose an event";
export const PLAN_LIST_JUNK = "set start and end";
export const PLAN_LIST_NO_MATCH = "no plans match";

export const PLAN_LIST_PACE_PLAN_LINE = 0.6;
export const PLAN_LIST_PACE_CAP = 1.5;

const DAY_MS = 86_400_000;
const LONDON = "Europe/London";

export type PlanListMomentKind = "presale" | "gen sale" | "show";

export type PlanListMoment = {
  kind: PlanListMomentKind;
  at: Date;
};

export type PlanListDrawerFix = {
  count: number;
  channel: string;
};

export type PlanListFoldKind =
  | "launch-blocked"
  | "over-pace"
  | "cost-above-band"
  | "moment-soon";

export type PlanListFold = {
  kind: PlanListFoldKind;
  planId: string;
  eventName: string;
  sentence: string;
};

export function toPlanListInput(plan: {
  id: string;
  status: CampaignPlanStatus;
  eventId?: string | null;
  eventName?: string | null;
  eventCode?: string | null;
  venueName?: string | null;
  eventDate?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  createdAt?: string | null;
  totalDaily?: number;
  spent?: number | null;
  drawerFix?: PlanListDrawerFix | null;
}): PlanListItemInput {
  return {
    id: plan.id,
    status: plan.status,
    eventId: plan.eventId ?? "",
    eventName: plan.eventName ?? null,
    eventCode: plan.eventCode ?? null,
    venueName: plan.venueName ?? null,
    eventDate: plan.eventDate ?? null,
    presaleAt: plan.presaleAt ?? null,
    generalSaleAt: plan.generalSaleAt ?? null,
    startDate: plan.startDate ?? null,
    endDate: plan.endDate ?? null,
    startTime: plan.startTime ?? null,
    endTime: plan.endTime ?? null,
    createdAt: plan.createdAt ?? null,
    totalDaily: plan.totalDaily ?? 0,
    spent: plan.spent ?? null,
    drawerFix: plan.drawerFix ?? null,
  };
}

export type PlanListItemInput = {
  id: string;
  status: CampaignPlanStatus;
  eventId: string | null;
  eventName: string | null;
  eventCode: string | null;
  venueName: string | null;
  eventDate: string | null;
  presaleAt: string | null;
  generalSaleAt: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  createdAt: string | null;
  totalDaily: number;
  spent: number | null;
  drawerFix: PlanListDrawerFix | null;
};

/** YYYY-MM-DD in Europe/London. */
export function londonDate(input: Date | string): string | null {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: LONDON });
}

export function londonCalendarDaysBetween(from: Date | string, to: Date | string): number | null {
  const a = londonDate(from);
  const b = londonDate(to);
  if (!a || !b) return null;
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

export function parseListMoment(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function listMoments(input: {
  presaleAt?: string | null;
  generalSaleAt?: string | null;
  eventDate?: string | null;
}): PlanListMoment[] {
  const moments: PlanListMoment[] = [];
  const presale = parseListMoment(input.presaleAt);
  const genSale = parseListMoment(input.generalSaleAt);
  const show = parseListMoment(input.eventDate);
  if (presale) moments.push({ kind: "presale", at: presale });
  if (genSale) moments.push({ kind: "gen sale", at: genSale });
  if (show) moments.push({ kind: "show", at: show });
  return moments.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Earliest of presale · gen sale · show still ahead. None → last. */
export function nextListMoment(
  input: {
    presaleAt?: string | null;
    generalSaleAt?: string | null;
    eventDate?: string | null;
  },
  now: Date,
): PlanListMoment | null {
  return listMoments(input).find((moment) => moment.at.getTime() > now.getTime()) ?? null;
}

export function sortPlansByNextMoment<T extends {
  id: string;
  eventName?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
  eventDate?: string | null;
}>(plans: T[], now: Date): T[] {
  return [...plans].sort((a, b) => {
    const nextA = nextListMoment(a, now);
    const nextB = nextListMoment(b, now);
    if (!nextA && !nextB) {
      const name = (a.eventName ?? "").localeCompare(b.eventName ?? "");
      return name !== 0 ? name : a.id.localeCompare(b.id);
    }
    if (!nextA) return 1;
    if (!nextB) return -1;
    const delta = nextA.at.getTime() - nextB.at.getTime();
    if (delta !== 0) return delta;
    const name = (a.eventName ?? "").localeCompare(b.eventName ?? "");
    return name !== 0 ? name : a.id.localeCompare(b.id);
  });
}

export function eventIsClosed(eventDate: string | null | undefined, now: Date): boolean {
  const show = parseListMoment(eventDate);
  if (!show) return false;
  return show.getTime() <= now.getTime();
}

export function planListTab(
  status: CampaignPlanStatus,
  eventDate?: string | null,
  now: Date = new Date(),
): PlanListTab {
  if (status === "archived") return "done";
  if (status === "live" || status === "live_partial") {
    return eventIsClosed(eventDate, now) ? "done" : "running";
  }
  if (eventIsClosed(eventDate, now) && !nextListMoment({ eventDate }, now)) {
    return "done";
  }
  return "drafts";
}

export function filterPlanList<T extends {
  status: CampaignPlanStatus;
  eventDate?: string | null;
  eventName?: string | null;
  eventCode?: string | null;
  venueName?: string | null;
  name?: string | null;
}>(plans: T[], tab: PlanListTab, search: string, now: Date = new Date()): T[] {
  let items = plans.filter((plan) => planListTab(plan.status, plan.eventDate, now) === tab);
  if (search.trim()) {
    const q = search.toLowerCase();
    items = items.filter((plan) =>
      [plan.eventName, plan.eventCode, plan.venueName, plan.name]
        .some((value) => (value ?? "").toLowerCase().includes(q)),
    );
  }
  return items;
}

export function countPlanListTabs(
  plans: Array<{ status: CampaignPlanStatus; eventDate?: string | null }>,
  templateCount: number,
  now: Date = new Date(),
): Record<PlanListChromeTab, number> {
  return {
    running: plans.filter((plan) => planListTab(plan.status, plan.eventDate, now) === "running").length,
    drafts: plans.filter((plan) => planListTab(plan.status, plan.eventDate, now) === "drafts").length,
    done: plans.filter((plan) => planListTab(plan.status, plan.eventDate, now) === "done").length,
    templates: templateCount,
  };
}

export function formatPlanListTab(tab: PlanListChromeTab, count: number): string {
  const word = PLAN_LIST_TAB_WORD[tab];
  return count > 0 ? `${word} ${count}` : word;
}

export function formatListGbp(amount: number): string {
  return `£${Math.round(amount).toLocaleString("en-GB")}`;
}

export function formatDaysWord(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

export function formatNextMomentLine(
  input: {
    presaleAt?: string | null;
    generalSaleAt?: string | null;
    eventDate?: string | null;
  },
  now: Date,
): string | null {
  const next = nextListMoment(input, now);
  if (!next) return null;
  const days = londonCalendarDaysBetween(now, next.at);
  if (days == null) return null;
  if (days === 0) return `${next.kind} today · ${formatVizDay(next.at)}`;
  return `${next.kind} in ${formatDaysWord(days)} · ${formatVizDay(next.at)}`;
}

export function formatPassedMomentLine(
  input: {
    presaleAt?: string | null;
    generalSaleAt?: string | null;
    eventDate?: string | null;
  },
  now: Date,
): string | null {
  const passed = [...listMoments(input)]
    .reverse()
    .find((moment) => moment.at.getTime() <= now.getTime());
  if (!passed) return null;
  return `${passed.kind} passed ${formatVizDay(passed.at)}`;
}

export function formatRowSecondLine(eventCode: string | null, venueName: string | null): string {
  return [eventCode, venueName].filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

function hasStoredWindow(input: Pick<PlanListItemInput, "startDate" | "endDate">): boolean {
  return Boolean(input.startDate?.trim() || input.endDate?.trim());
}

/** Present and invalid. Missing dates on a draft are unset, not L5. */
export function listWindowIsJunk(input: PlanListItemInput, now: Date = new Date()): boolean {
  if (!hasStoredWindow(input)) return false;
  return !planWindowValidity(
    {
      startDate: input.startDate,
      endDate: input.endDate,
      startTime: input.startTime,
      endTime: input.endTime,
    },
    { eventDate: input.eventDate },
    { now, createdAt: input.createdAt },
  ).ok;
}

export function listHasEvent(input: Pick<PlanListItemInput, "eventId" | "eventName">): boolean {
  return Boolean(input.eventId && input.eventName?.trim());
}

/** Days from start to today, London calendar. Today is not counted. */
export function listDaysElapsed(startDate: string | null, now: Date): number | null {
  if (!startDate) return null;
  const days = londonCalendarDaysBetween(startDate, now);
  if (days == null || days < 0) return null;
  return days;
}

export function listPlannedByToday(totalDaily: number, startDate: string | null, now: Date): number | null {
  const days = listDaysElapsed(startDate, now);
  if (days == null || totalDaily <= 0) return null;
  return totalDaily * days;
}

/** fill = min(spent ÷ planned, 1.5) × 60 of the track. */
export function listPaceFillPercent(spent: number, planned: number): number {
  if (planned <= 0 || spent <= 0) return 0;
  return Math.round(
    Math.min(spent / planned, PLAN_LIST_PACE_CAP) * PLAN_LIST_PACE_PLAN_LINE * 100,
  );
}

export function listOverPaceByMoreThanADay(input: {
  spent: number | null;
  planned: number | null;
  daily: number;
}): boolean {
  if (input.spent == null || input.planned == null) return false;
  if (input.daily <= 0 || input.planned <= 0) return false;
  return input.spent - input.planned > input.daily;
}

export function formatPaceSums(spent: number, planned: number): string {
  return `${formatListGbp(spent)} spent · plan said ${formatListGbp(planned)} by today`;
}

export function formatOverPaceFold(eventName: string, spent: number, planned: number): string {
  return `${eventName}: ${formatListGbp(spent)} spent, plan said ${formatListGbp(planned)} — over by more than a day`;
}

export function formatLaunchBlockedFold(eventName: string, fix: PlanListDrawerFix): string {
  const things = fix.count === 1 ? "1 thing" : `${fix.count} things`;
  return `${eventName}: ${things} to fix before ${fix.channel} can run`;
}

export function formatMomentSoonFold(eventName: string, kind: PlanListMomentKind): string {
  return `${eventName}: ${kind} is tomorrow and nothing is running`;
}

/**
 * Rule 3 needs campaign_plan_benchmarks_v (PR 3). Do not fake a band.
 * TODO(plan-v2-benchmarks)
 */
export function foldCostAboveBand(_input: PlanListItemInput): PlanListFold | null {
  return null;
}

export function drawerFixFromPreflight(issues: PlanPreflightIssue[]): PlanListDrawerFix | null {
  const blocking = collectPlanPreflightBlockers(issues);
  const first = blocking[0];
  if (!first) return null;
  const platform = first.adapter as VizPlatform;
  return {
    count: blocking.length,
    channel: VIZ_PLATFORM_LABEL[platform] ?? first.adapter,
  };
}

export function isPlanRunning(status: CampaignPlanStatus): boolean {
  return status === "live" || status === "live_partial";
}

function foldEventName(input: PlanListItemInput): string {
  return input.eventName?.trim() || PLAN_LIST_CHOOSE_EVENT;
}

function ruleLaunchBlocked(plans: PlanListItemInput[]): PlanListFold | null {
  for (const plan of plans) {
    if (isPlanRunning(plan.status) || plan.status === "archived") continue;
    if (!plan.drawerFix || plan.drawerFix.count <= 0) continue;
    return {
      kind: "launch-blocked",
      planId: plan.id,
      eventName: foldEventName(plan),
      sentence: formatLaunchBlockedFold(foldEventName(plan), plan.drawerFix),
    };
  }
  return null;
}

function ruleOverPace(plans: PlanListItemInput[], now: Date): PlanListFold | null {
  for (const plan of plans) {
    if (!isPlanRunning(plan.status)) continue;
    const planned = listPlannedByToday(plan.totalDaily, plan.startDate, now);
    if (!listOverPaceByMoreThanADay({ spent: plan.spent, planned, daily: plan.totalDaily })) {
      continue;
    }
    return {
      kind: "over-pace",
      planId: plan.id,
      eventName: foldEventName(plan),
      sentence: formatOverPaceFold(foldEventName(plan), plan.spent!, planned!),
    };
  }
  return null;
}

/** Rule 4: a moment still ahead and within 24 hours — not calendar-tomorrow. */
export function momentIsWithin24h(at: Date, now: Date): boolean {
  const delta = at.getTime() - now.getTime();
  return delta > 0 && delta <= DAY_MS;
}

function eventHasLivePlan(plans: PlanListItemInput[], eventId: string | null): boolean {
  if (!eventId) return false;
  return plans.some((plan) => plan.eventId === eventId && isPlanRunning(plan.status));
}

function ruleMomentSoon(plans: PlanListItemInput[], now: Date): PlanListFold | null {
  for (const plan of plans) {
    if (isPlanRunning(plan.status) || plan.status === "archived") continue;
    if (eventHasLivePlan(plans, plan.eventId)) continue;
    const next = nextListMoment(plan, now);
    if (!next || !momentIsWithin24h(next.at, now)) continue;
    return {
      kind: "moment-soon",
      planId: plan.id,
      eventName: foldEventName(plan),
      sentence: formatMomentSoonFold(foldEventName(plan), next.kind),
    };
  }
  return null;
}

/** First match wins: launch blocked → over pace → band (PR 3) → moment soon. */
export function chooseFold(plans: PlanListItemInput[], now: Date): PlanListFold | null {
  if (plans.length === 0) return null;
  return (
    ruleLaunchBlocked(plans) ??
    ruleOverPace(plans, now) ??
    foldCostAboveBand(plans[0]!) ??
    ruleMomentSoon(plans, now)
  );
}

export type PlanListStateWord =
  (typeof VIZ_STATE_WORD)[keyof typeof VIZ_STATE_WORD];

export function planListStateWord(input: PlanListItemInput, now: Date = new Date()): PlanListStateWord {
  if (!listHasEvent(input)) return VIZ_STATE_WORD.needsYou;
  if (input.status === "archived") return VIZ_STATE_WORD.done;
  if (eventIsClosed(input.eventDate, now) && !nextListMoment(input, now)) {
    return VIZ_STATE_WORD.done;
  }
  if (isPlanRunning(input.status)) return VIZ_STATE_WORD.running;
  if (input.drawerFix && input.drawerFix.count > 0) return VIZ_STATE_WORD.needsYou;
  if (listWindowIsJunk(input, now)) return VIZ_STATE_WORD.needsYou;
  if (input.status === "failed") return VIZ_STATE_WORD.needsYou;
  return VIZ_STATE_WORD.ready;
}

export type PlanListRowView = {
  name: string;
  secondLine: string;
  momentLine: string | null;
  stateWord: PlanListStateWord;
  openLabel: typeof PLAN_LIST_OPEN;
  dashedTrack: boolean;
  junk: boolean;
  junkLabel: typeof PLAN_LIST_JUNK | null;
};

export function planListRowView(input: PlanListItemInput, now: Date): PlanListRowView {
  const junk = listWindowIsJunk(input, now);
  return {
    name: input.eventName?.trim() || PLAN_LIST_CHOOSE_EVENT,
    secondLine: formatRowSecondLine(input.eventCode, input.venueName),
    momentLine: formatNextMomentLine(input, now) ?? formatPassedMomentLine(input, now),
    stateWord: planListStateWord(input, now),
    openLabel: PLAN_LIST_OPEN,
    dashedTrack: planListTab(input.status, input.eventDate, now) === "drafts",
    junk,
    junkLabel: junk ? PLAN_LIST_JUNK : null,
  };
}

export function planListEmptySentence(input: { hasPlans: boolean; search: string }): string {
  if (input.hasPlans && input.search.trim()) return PLAN_LIST_NO_MATCH;
  return PLAN_LIST_EMPTY.sentence;
}

export type DailySpendRow = {
  event_id: string;
  date: string;
  ad_spend?: number | null;
  tiktok_spend?: number | null;
  google_ads_spend?: number | null;
};

/** All-channel spend on [from, to] inclusive, London dates. */
export function sumAllChannelSpend(
  rows: DailySpendRow[],
  eventId: string,
  fromDate: string | null,
  toDate: string,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.event_id !== eventId) continue;
    if (fromDate && row.date < fromDate) continue;
    if (row.date > toDate) continue;
    total += Number(row.ad_spend ?? 0) + Number(row.tiktok_spend ?? 0) + Number(row.google_ads_spend ?? 0);
  }
  return total;
}
