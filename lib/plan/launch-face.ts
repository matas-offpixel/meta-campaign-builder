/**
 * LAUNCH face copy — canon §2.2 and frames A1–A15.
 * Structure stays seven zones; this file is what it says.
 */

import { formatVizDay, formatVizMoment } from "../viz/format-moment.ts";
import { VIZ_PLATFORM_LABEL, VIZ_STATE_WORD, VIZ_TICKET_LINE_WORD, type VizPlatform } from "../viz/tokens.ts";
import type { IdentityNameMap } from "./identity-chips.ts";
import type { PlanPreflightIssue } from "./preflight.ts";
import type { CampaignPlan, PlanAdapterName } from "./types.ts";
import { budgetedLaunchAdapters } from "./types.ts";

export const LAUNCH_STARTING_POINT = {
  reg: 1.6,
  purchase: 18,
  lpv: 0.35,
  view: 5.5,
} as const;

export type LaunchReadingUnit = "reg" | "purchase" | "view";

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

export function launchUnitWord(unit: LaunchReadingUnit): string {
  if (unit === "reg") return "signup";
  if (unit === "purchase") return "purchase";
  return "thousand reached";
}

export function formatStartingPoint(unit: LaunchReadingUnit): string {
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

export function identityAccountLabel(
  resolvedId: string | null,
  names: IdentityNameMap | undefined,
): string {
  if (!resolvedId) return "";
  const name = names?.metaAdAccount[resolvedId];
  if (name?.trim()) return name.trim();
  return resolvedId.startsWith("act_") ? resolvedId : `act_${resolvedId}`;
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

export function formatIdentityTip(input: {
  metaId: string | null;
  eventMetaAdAccountId?: string | null;
  destinationUrl?: string | null;
  clientName?: string | null;
}): string {
  const parts: string[] = [];
  if (input.clientName?.trim()) parts.push(input.clientName.trim());
  if (input.destinationUrl?.trim()) parts.push(input.destinationUrl.trim());
  if (input.metaId) parts.push(input.metaId);
  const eventId = input.eventMetaAdAccountId?.trim();
  if (eventId && eventId !== input.metaId) {
    parts.push(`event account ${eventId}`);
  }
  return parts.join(" · ");
}

export function decisionsChangesLabel(count: number): string | null {
  return count > 0 ? `${count} changes ▸` : null;
}

export function formatLaunchedLine(launchedAt: string): string {
  const day = formatVizDay(launchedAt);
  const moment = formatVizMoment(launchedAt);
  const time = moment.includes(" · ") ? moment.split(" · ")[1] : null;
  return time ? `paused · launched ${day} · ${time}` : `paused · launched ${day}`;
}

export function formatSkippedShare(pct: number): string {
  return `${pct}% of the budget — skipped`;
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
        blockerCount: row.blockers.filter((blocker) => blocker.kind === "blocker").length,
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
