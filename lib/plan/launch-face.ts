/**
 * LAUNCH face copy — canon §2.2 and frames A1–A15.
 * Structure stays seven zones; this file is what it says.
 */

import type { PlanTargetUnit } from "../types.ts";
import type { MetricChipBenchmark } from "../viz/metric-chip.ts";
import { formatVizDay, formatVizMoment } from "../viz/format-moment.ts";
import { VIZ_PLATFORM_LABEL, VIZ_STATE_WORD, VIZ_TICKET_LINE_WORD, type VizPlatform } from "../viz/tokens.ts";
import {
  planBenchmark,
  type BenchmarkRow,
  type BenchmarkUnit,
} from "./benchmarks.ts";
import type { IdentityNameMap } from "./identity-chips.ts";
import type { PlanPreflightIssue } from "./preflight.ts";
import type {
  CampaignPlan,
  CampaignPlanLaunchRecord,
  CampaignPlanLaunches,
  PlanAdapterName,
} from "./types.ts";
import { budgetedLaunchAdapters } from "./types.ts";

export const LAUNCH_STARTING_POINT: Record<PlanTargetUnit, number> = {
  reg: 1.6,
  purchase: 18,
  lpv: 0.35,
  view: 5.5,
  click: 0.45,
};

export const LAUNCH_NO_READS = "no reads yet";

export type LaunchReadingUnit = "reg" | "purchase" | "view";
export type LaunchResolvedUnit = PlanTargetUnit;

export function launchReadingUnit(input: {
  now: Date;
  generalSaleAt?: string | null;
  presaleAt?: string | null;
  kind?: string | null;
}): LaunchReadingUnit {
  if (input.kind && input.kind !== "event") return "view";
  const gen = input.generalSaleAt ? new Date(input.generalSaleAt) : null;
  const presale = input.presaleAt ? new Date(input.presaleAt) : null;
  const gate =
    gen && presale && !Number.isNaN(presale.getTime()) && presale.getTime() < gen.getTime()
      ? presale
      : gen;
  if (gate && !Number.isNaN(gate.getTime()) && input.now.getTime() >= gate.getTime()) {
    return "purchase";
  }
  return "reg";
}

export function launchUnitWord(unit: LaunchResolvedUnit): string {
  if (unit === "reg") return "signup";
  if (unit === "purchase") return "purchase";
  if (unit === "view") return "thousand reached";
  if (unit === "click") return "click";
  return "page view";
}

export function resolveLaunchUnit(input: {
  phase: LaunchReadingUnit;
  override?: PlanTargetUnit | null;
}): LaunchResolvedUnit {
  return input.override ?? input.phase;
}

export function toBenchmarkUnit(unit: LaunchResolvedUnit): BenchmarkUnit {
  return unit === "reg" ? "signup" : unit;
}

export function formatStartingPoint(unit: LaunchResolvedUnit): string {
  const value = LAUNCH_STARTING_POINT[unit];
  return `£${value.toFixed(2)} per ${launchUnitWord(unit)} · Off Pixel's starting point`;
}

export function formatTargetFromShows(n: number, venue: string): string {
  if (n <= 0) return formatStartingPoint("reg");
  const show = n === 1 ? "1 other show" : `${n} other shows`;
  return `from ${show} at ${venue}`;
}

export function formatGbp(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const text =
    Number.isInteger(rounded) || rounded >= 10
      ? Math.round(rounded).toLocaleString("en-GB")
      : rounded.toFixed(2);
  return `£${text}`;
}

function actForm(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function sameAdAccount(a: string, b: string): boolean {
  return a.replace(/^act_/, "") === b.replace(/^act_/, "");
}

export function identityAccountLabel(
  resolvedId: string | null,
  names: IdentityNameMap | undefined,
): string {
  if (!resolvedId) return "";
  const bare = resolvedId.replace(/^act_/, "");
  const act = actForm(resolvedId);
  const name =
    names?.metaAdAccount[resolvedId] ??
    names?.metaAdAccount[bare] ??
    names?.metaAdAccount[act];
  if (name?.trim()) return name.trim();
  return act;
}

/**
 * After launch: ledger account, then the linked draft's adAccountId.
 * The resolver is never a leg after launch. Draft plans use the resolver.
 */
export function planIdentityMetaId(input: {
  launchedMeta: CampaignPlanLaunchRecord;
  draftAdAccountId?: string | null;
  resolvedMetaId: string | null;
}): string | null {
  if (isLaunchedLedgerRow(input.launchedMeta)) {
    return (
      input.launchedMeta.platformAdAccountId?.trim() ||
      input.draftAdAccountId?.trim() ||
      input.launchedMeta.draftAdAccountId?.trim() ||
      null
    );
  }
  return input.resolvedMetaId;
}

export function formatIdentitySentence(input: {
  metaId: string | null;
  metaConnected: boolean;
  tiktokConnected: boolean;
  googleConnected: boolean;
  names?: IdentityNameMap;
}): string {
  const parts: string[] = [];
  if (input.metaConnected && input.metaId) {
    parts.push(`Running as ${identityAccountLabel(input.metaId, input.names)} on Meta`);
  } else {
    parts.push("Meta account not connected — connect");
  }
  if (!input.tiktokConnected) parts.push("TikTok account not connected — connect");
  if (!input.googleConnected) parts.push("Google account not connected — connect");
  return parts.join(" · ");
}

export function formatTicketsAt(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host ? `tickets at ${host}` : null;
  } catch {
    return null;
  }
}

export function formatIdentityTip(input: {
  metaId: string | null;
  clientDefaultMetaId?: string | null;
  destinationUrl?: string | null;
  clientName?: string | null;
  planTitle?: string | null;
}): string {
  const parts: string[] = [];
  if (input.clientName?.trim()) parts.push(input.clientName.trim());
  if (input.planTitle?.trim()) parts.push(input.planTitle.trim());
  const tickets = formatTicketsAt(input.destinationUrl);
  if (tickets) parts.push(tickets);
  if (input.metaId) parts.push(input.metaId);
  const clientDefault = input.clientDefaultMetaId?.trim();
  const printed = input.metaId?.trim();
  if (clientDefault && printed && !sameAdAccount(clientDefault, printed)) {
    parts.push(`client default ${actForm(clientDefault)}`);
  }
  return parts.join(" · ");
}

export function decisionsChangesLabel(count: number): string | null {
  return count > 0 ? `${count} changes ▸` : null;
}

export type PlanLaunchedWord = "live" | "paused";

export function formatLaunchedLine(launchedAt: string, word: PlanLaunchedWord): string {
  const day = formatVizDay(launchedAt);
  const moment = formatVizMoment(launchedAt);
  const time = moment.includes(" · ") ? moment.split(" · ")[1] : null;
  return time ? `${word} · launched ${day} · ${time}` : `${word} · launched ${day}`;
}

export function isLaunchedLedgerRow(record: CampaignPlanLaunchRecord): boolean {
  return record.status === "live" || Boolean(record.platformCampaignId);
}

export type PlanLaunchedAtSource = "ledger" | "plan_start";

export const LAUNCH_STAMP_PLAN_START_TIP = "launch time taken from the plan's start";

export function formatLaunchStampTip(
  source: PlanLaunchedAtSource | null | undefined,
): string | null {
  return source === "plan_start" ? LAUNCH_STAMP_PLAN_START_TIP : null;
}

export function planLaunchStamp(launches: CampaignPlanLaunches): {
  at: string | null;
  word: PlanLaunchedWord;
  source: PlanLaunchedAtSource | null;
} | null {
  const rows = (["meta", "tiktok", "google"] as const)
    .map((adapter) => launches[adapter])
    .filter(isLaunchedLedgerRow);
  if (rows.length === 0) return null;
  const stamped = rows
    .filter((row): row is CampaignPlanLaunchRecord & { launchedAt: string } =>
      Boolean(row.launchedAt?.trim()),
    )
    .sort((a, b) => (a.launchedAt < b.launchedAt ? -1 : 1));
  const first = stamped[0];
  return {
    at: first?.launchedAt ?? null,
    word: rows.some((row) => row.status === "live") ? "live" : "paused",
    source: first?.launchedAtSource === "plan_start" ? "plan_start" : first ? "ledger" : null,
  };
}

export function formatSkippedShare(pct: number, platform?: VizPlatform): string {
  const body = `${pct}% of the budget — skipped`;
  return platform ? `${VIZ_PLATFORM_LABEL[platform]} · ${body}` : body;
}

export function planLaunchedAt(launches: CampaignPlanLaunches): string | null {
  return planLaunchStamp(launches)?.at ?? null;
}

export function planStampLondonDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function launchBlockers<T extends { kind?: string }>(
  blockers: readonly T[],
): T[] {
  return blockers.filter((blocker) => blocker.kind === "blocker");
}

export function launchTargetInfoHeader(unit: LaunchResolvedUnit): string {
  if (unit === "purchase") return "ESTIMATED · META'S PURCHASE COUNT, YOUR SPEND";
  if (unit === "view") return "ESTIMATED · META'S REACH, YOUR SPEND";
  if (unit === "click") return "ESTIMATED · META'S CLICK COUNT, YOUR SPEND";
  if (unit === "lpv") return "ESTIMATED · META'S PAGE VIEW COUNT, YOUR SPEND";
  return "ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND";
}

export function formatRunningFact(input: {
  cost: number;
  unit: LaunchResolvedUnit;
  usual?: number | null;
}): string {
  const number = `${formatGbp(input.cost)} per ${launchUnitWord(input.unit)}`;
  if (input.usual == null) return number;
  const cmp = input.cost < input.usual ? "under" : input.cost > input.usual ? "above" : "at";
  return `${number} · ${cmp} your usual ${formatGbp(input.usual)}`;
}

export type LaunchRollupDay = {
  date: string;
  ad_spend: number;
  meta_regs: number;
  meta_purchases: number;
  meta_reach: number;
  tiktok_spend: number;
  tiktok_results: number;
  google_ads_spend: number;
  google_ads_conversions: number;
};

export type LaunchChannelCost = { cost: number; usual?: number | null };

export type LaunchChannelRunning = {
  empty: boolean;
  byAdapter: Partial<Record<PlanAdapterName, LaunchChannelCost | null>>;
};

export function launchChannelRunning(
  days: readonly LaunchRollupDay[],
  unit: LaunchReadingUnit,
  usual?: number | null,
): LaunchChannelRunning {
  if (days.length === 0) {
    return { empty: true, byAdapter: { meta: null, tiktok: null, google: null } };
  }
  const totals = days.reduce(
    (sum, day) => ({
      ad_spend: sum.ad_spend + day.ad_spend,
      meta_regs: sum.meta_regs + day.meta_regs,
      meta_purchases: sum.meta_purchases + day.meta_purchases,
      meta_reach: sum.meta_reach + day.meta_reach,
      tiktok_spend: sum.tiktok_spend + day.tiktok_spend,
      tiktok_results: sum.tiktok_results + day.tiktok_results,
      google_ads_spend: sum.google_ads_spend + day.google_ads_spend,
      google_ads_conversions: sum.google_ads_conversions + day.google_ads_conversions,
    }),
    {
      ad_spend: 0,
      meta_regs: 0,
      meta_purchases: 0,
      meta_reach: 0,
      tiktok_spend: 0,
      tiktok_results: 0,
      google_ads_spend: 0,
      google_ads_conversions: 0,
    },
  );
  const metaResults =
    unit === "purchase"
      ? totals.meta_purchases
      : unit === "view"
        ? totals.meta_reach
        : totals.meta_regs;
  const usualValue = usual ?? null;
  return {
    empty: false,
    byAdapter: {
      meta: costOrNull(totals.ad_spend, metaResults, unit, usualValue),
      tiktok: costOrNull(totals.tiktok_spend, totals.tiktok_results, unit, usualValue),
      google: costOrNull(totals.google_ads_spend, totals.google_ads_conversions, unit, usualValue),
    },
  };
}

function costOrNull(
  spend: number,
  results: number,
  unit: LaunchReadingUnit,
  usual: number | null,
): LaunchChannelCost | null {
  const cost = platformUnitCost({ spend, results, unit });
  return cost == null ? null : { cost, usual };
}

export function platformUnitCost(input: {
  spend: number;
  results: number | null;
  unit: LaunchReadingUnit;
}): number | null {
  if (input.results == null || input.results <= 0 || input.spend < 0) return null;
  const denom = input.unit === "view" ? input.results / 1000 : input.results;
  if (denom <= 0) return null;
  return input.spend / denom;
}

export function launchBlockedLine(input: {
  hasEvent: boolean;
  busy: boolean;
  windowOk: boolean;
  issues: PlanPreflightIssue[];
  blockerCount: number;
}): string | null {
  if (!input.hasEvent) return "choose an event";
  if (input.busy) return "launch in progress";
  return formatLaunchBlockerSentence({
    windowOk: input.windowOk,
    blockerCount: input.blockerCount,
    unconnected: unconnectedMessage(input.issues),
  });
}

export type LaunchTargetView = {
  unit: LaunchResolvedUnit;
  unitWord: string;
  chipValue: number;
  evidence: string;
  lineKind: MetricChipBenchmark["lineKind"];
  benchmark: MetricChipBenchmark | undefined;
  infoHeader: string;
  showComputedToday: boolean;
  purchaseLine: string | null;
};

export function launchTargetView(input: {
  now: Date;
  generalSaleAt?: string | null;
  presaleAt?: string | null;
  kind?: string | null;
  venueName?: string | null;
  venueKey?: string | null;
  clientId?: string | null;
  excludeEventId?: string | null;
  unit?: PlanTargetUnit | null;
  operatorTarget?: number | null;
  ticketSource?: keyof typeof VIZ_TICKET_LINE_WORD;
  benchmarkRows?: readonly BenchmarkRow[];
}): LaunchTargetView {
  const phase = launchReadingUnit({
    now: input.now,
    generalSaleAt: input.generalSaleAt,
    presaleAt: input.presaleAt,
    kind: input.kind,
  });
  const unit = resolveLaunchUnit({ phase, override: input.unit });
  const venue = input.venueName?.trim() || null;
  const venueKey = input.venueKey?.trim() || null;
  const benchmark =
    input.clientId && venueKey
      ? planBenchmark({
          rows: input.benchmarkRows ?? [],
          clientId: input.clientId,
          venueKey,
          venueLabel: venue ?? venueKey,
          unit: toBenchmarkUnit(unit),
          excludeEventId: input.excludeEventId,
        })
      : undefined;
  const n = benchmark?.n ?? 0;
  const evidence = n <= 0 ? formatStartingPoint(unit) : (benchmark?.sentence ?? formatStartingPoint(unit));
  const starting = LAUNCH_STARTING_POINT[unit];
  return {
    unit,
    unitWord: launchUnitWord(unit),
    chipValue: input.operatorTarget ?? benchmark?.value ?? starting,
    evidence,
    lineKind: benchmark?.lineKind ?? "estimated",
    benchmark,
    infoHeader: launchTargetInfoHeader(unit),
    showComputedToday: benchmark != null,
    purchaseLine: unit === "purchase" ? formatPurchaseTicketLine(input.ticketSource ?? "none") : null,
  };
}

export function formatHistoryEmpty(platform: VizPlatform, clientName: string): string {
  return `no ${VIZ_PLATFORM_LABEL[platform]} history yet for ${clientName} — opens after your first ${VIZ_PLATFORM_LABEL[platform]} run`;
}

export function formatYouSetThis(differs: boolean): string | null {
  return differs ? "you set this" : null;
}

export type LaunchChannelStateWord =
  | typeof VIZ_STATE_WORD.ready
  | typeof VIZ_STATE_WORD.needsYou
  | typeof VIZ_STATE_WORD.running
  | typeof VIZ_STATE_WORD.paused
  | "waiting for Meta";

export function launchChannelStateWord(input: {
  skipped: boolean;
  waiting: boolean;
  blockerCount: number;
  status: "idle" | "launching" | "live" | "failed" | "skipped" | "paused";
}): LaunchChannelStateWord {
  if (input.waiting) return "waiting for Meta";
  if (input.blockerCount > 0) return VIZ_STATE_WORD.needsYou;
  if (input.status === "live") return VIZ_STATE_WORD.running;
  if (input.status === "paused") return VIZ_STATE_WORD.paused;
  return VIZ_STATE_WORD.ready;
}

export type LaunchChannelRowView = {
  pending: boolean;
  stateWord: LaunchChannelStateWord | null;
  runningFact: string | null;
};

/**
 * Channel row face. `reads: undefined` (key present) is the not-yet
 * skeleton — no state word, no sentence.
 */
export function launchChannelRowView(input: {
  reads?: LaunchChannelRunning | null;
  skipped: boolean;
  waiting: boolean;
  blockerCount: number;
  status: "idle" | "launching" | "live" | "failed" | "skipped" | "paused";
  readingUnit?: LaunchReadingUnit;
  adapter: PlanAdapterName;
}): LaunchChannelRowView {
  if (Object.prototype.hasOwnProperty.call(input, "reads") && input.reads === undefined) {
    return { pending: true, stateWord: null, runningFact: null };
  }
  const stateWord = launchChannelStateWord({
    skipped: input.skipped,
    waiting: input.waiting,
    blockerCount: input.blockerCount,
    status: input.status,
  });
  const running = input.reads ?? undefined;
  const runningRead = running?.byAdapter[input.adapter];
  const runningFact = !running
    ? null
    : running.empty
      ? LAUNCH_NO_READS
      : input.readingUnit && runningRead
        ? `${stateWord} · ${formatRunningFact({
            cost: runningRead.cost,
            unit: input.readingUnit,
            usual: runningRead.usual,
          })}`
        : null;
  return {
    pending: false,
    stateWord: runningFact ? null : stateWord,
    runningFact,
  };
}

export function formatChannelNeedsYou(count: number, channel: string): string {
  const things = count === 1 ? "1 thing" : `${count} things`;
  return `${things} to fix before ${channel} can run →`;
}

export function formatResumeWord(adapter: PlanAdapterName): string {
  if (adapter === "meta") return "resume ▷";
  if (adapter === "tiktok") return "resume in TikTok Ads Manager ↗";
  return "resume in Google Ads ↗";
}

export function formatLaunchCreatesLine(adapters: PlanAdapterName[]): string {
  const names = adapters.map((adapter) => VIZ_PLATFORM_LABEL[adapter]);
  const n = names.length;
  const campaign = n === 1 ? "1 campaign" : `${n} campaigns`;
  return `creates ${campaign}, paused, on ${names.join(" · ")}`;
}

export function launchCreatesAdapters(plan: Pick<CampaignPlan, "intent">): PlanAdapterName[] {
  return budgetedLaunchAdapters(plan.intent.budget);
}

export function readyLaunchAdapters(
  rows: ReadonlyArray<{
    adapter: PlanAdapterName;
    skipped: boolean;
    waiting: boolean;
    blockers: ReadonlyArray<{ kind?: string }>;
    status: string;
  }>,
): PlanAdapterName[] {
  return rows
    .filter((row) => {
      if (row.skipped) return false;
      const word = launchChannelStateWord({
        skipped: false,
        waiting: row.waiting,
        blockerCount: launchBlockers(row.blockers).length,
        status:
          row.status === "paused"
            ? "paused"
            : row.status === "live"
              ? "live"
              : row.status === "launching"
                ? "launching"
                : row.status === "failed"
                  ? "failed"
                  : "idle",
      });
      return word === VIZ_STATE_WORD.ready;
    })
    .map((row) => row.adapter);
}

export function formatLaunchBlockerSentence(input: {
  unconnected?: string | null;
  windowOk: boolean;
  blockerCount: number;
}): string | null {
  if (!input.windowOk) return "set start and end";
  if (input.unconnected) return input.unconnected;
  if (input.blockerCount > 0) {
    const things = input.blockerCount === 1 ? "1 thing" : `${input.blockerCount} things`;
    return `${things} to fix before you can launch`;
  }
  return null;
}

export function formatPurchaseTicketLine(
  source: keyof typeof VIZ_TICKET_LINE_WORD = "none",
): string {
  if (source === "none") {
    return `tickets: ${VIZ_TICKET_LINE_WORD.none} — enter ticket sales on the event`;
  }
  return `tickets ${VIZ_TICKET_LINE_WORD[source]}`;
}

export function formatMissingMomentTip(): string {
  return "not set on the event";
}

export function unconnectedMessage(issues: PlanPreflightIssue[]): string | null {
  return issues.find((issue) => issue.id === "plan:unconnected_share")?.message ?? null;
}

export const LAUNCH_INFO_VARIANT = "card" as const;

export function launchControlsVisible(role: "operator" | "client"): {
  launch: boolean;
  unitPicker: boolean;
  drawerEdit: boolean;
} {
  const operator = role !== "client";
  return { launch: operator, unitPicker: operator, drawerEdit: operator };
}
