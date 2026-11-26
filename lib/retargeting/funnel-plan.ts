/**
 * One show's retargeting plan under the funnel (docs/design-record/2026-11-26-retargeting-funnel.html,
 * RF3, RF4, RF8, RF9): today's stretch and share, the split, where the money
 * comes from, and each later stretch step as a budget change. The panel's
 * Create line and plan_retargeting both read it. Pure.
 *
 * The share is of the show's daily spend: every delivering prospecting
 * budget's money a day (READING: daily budgets; a lifetime budget neither
 * counts nor gives). Retargeting is part of it, not on top, so the show's
 * total stays the same: what retargeting gets, prospecting gives.
 *
 * The total is today's share, rounded down to the penny; never under one
 * floor a tier (RF8: "it takes a little more than its share"); never more
 * than prospecting can give (RF4: take what's there). Under one floor a
 * tier available: no money, no Create.
 *
 * Each step (RF3) is the change from the stretch before: a bigger share
 * takes more from prospecting, largest first, the same way; a smaller one
 * gives back to the budgets it came from, last taken first (READING: the
 * record names only rising steps). A step moves money only on a live build.
 */

import {
  afterTake,
  audiencesToMake,
  FLOOR_MINOR,
  NO_TIERS,
  funnelSpecs,
  FUNNEL_TIERS,
  missingAccess,
  RF3,
  splitTotal,
  stepsAfter,
  stretchName,
  stretchOn,
  takeFromProspecting,
  takeFromText,
  splitOf,
  type FunnelSources,
  type SpecOptions,
  type FunnelSpec,
  type FunnelStretch,
  type FunnelTier,
  type ProspectingBudget,
  type Take,
  type TakeLine,
  type TierMinor,
} from "./funnel.ts";
import { fill, JOIN, money, rfDay } from "./funnel-words.ts";

export type FunnelShowInput = {
  code: string;
  /** Today, London (YYYY-MM-DD). */
  runDay: string;
  showDay: string;
  /** The announcement (events.announcement_at), else the first on-sale day; null when neither is stored. */
  announceDay: string | null;
  /** The show's delivering prospecting budgets (not Retargeting, not Tests). */
  prospecting: ProspectingBudget[];
  /** Meta's min_daily_budget for the account, when higher than £1.00. */
  minDailyMinor?: number | null;
  sources: FunnelSources;
  /** Audience keys already made for this show (a re-run reuses them). */
  made?: ReadonlySet<string>;
  /**
   * A build that runs (or is made paused): what its tiers run at and what it
   * took. The show's daily spend is then prospecting plus this, nothing is
   * taken today, and the steps go on from it.
   */
  existing?: { totalMinor: number; took: readonly TakeLine[] } | null;
  /** Staged two-campaign record: the Similar tier and its split, Similar lists in Warm, presale. */
  spec?: SpecOptions;
};

export type FunnelStepPlan = {
  day: string;
  stretch: FunnelStretch;
  share: number;
  targetMinor: number;
  totalMinor: number;
  tiers: TierMinor;
  /** + taken from prospecting this step; − given back. */
  deltaMinor: number;
  /** The prospecting budgets this step writes, before → after. */
  prospecting: TakeLine[];
};

export type FunnelShowPlan = {
  code: string;
  stretch: FunnelStretch;
  share: number;
  /** The show's daily spend, pennies (it stays the same). */
  showDailyMinor: number;
  /** Today's share of it. */
  targetMinor: number;
  /** What retargeting starts at (the tiers' sum); 0 = no money. */
  totalMinor: number;
  tiers: TierMinor;
  atFloor: FunnelTier[];
  take: Take;
  /** RF4: prospecting couldn't give the whole share. */
  short: boolean;
  /** RF4: nothing to give, so no Create. */
  noMoney: boolean;
  specs: FunnelSpec[];
  audiences: { made: number; toMake: number; missingAccess: number };
  /** Each later step to the show day. */
  steps: FunnelStepPlan[];
};

const sum = (tiers: TierMinor) => FUNNEL_TIERS.reduce((total, tier) => total + tiers[tier], 0);

/** The show's daily spend: its delivering prospecting budgets, pennies. */
export function showDailyOf(budgets: readonly ProspectingBudget[]): number {
  return budgets.reduce((total, row) => total + Math.max(0, row.dailyMinor), 0);
}

function giveBack(budgets: ProspectingBudget[], taken: TakeLine[], minor: number): { budgets: ProspectingBudget[]; lines: TakeLine[]; given: number } {
  let left = minor;
  const lines: TakeLine[] = [];
  const now = budgets.map((row) => ({ ...row }));
  for (const line of [...taken].reverse()) {
    if (left <= 0) break;
    const budget = now.find((row) => row.id === line.id);
    if (!budget) continue;
    const room = line.beforeMinor - budget.dailyMinor;
    const back = Math.min(left, room);
    if (back <= 0) continue;
    lines.push({ ...line, beforeMinor: budget.dailyMinor, afterMinor: budget.dailyMinor + back });
    budget.dailyMinor += back;
    left -= back;
  }
  return { budgets: now, lines, given: minor - left };
}

export function planFunnelShow(input: FunnelShowInput): FunnelShowPlan {
  const floor = Math.max(FLOOR_MINOR, input.minDailyMinor ?? 0);
  const dates = { showDay: input.showDay, announceDay: input.announceDay };
  const stretch = stretchOn(input.runDay, dates);
  const rule = RF3[stretch];
  const existing = input.existing ?? null;
  const showDailyMinor = showDailyOf(input.prospecting) + (existing?.totalMinor ?? 0);
  const twoCampaigns = input.spec?.twoCampaigns === true;
  const specs = funnelSpecs(input.sources, input.spec);
  const buildable = specs.map((spec) => spec.tier).filter((tier) => splitOf(stretch, twoCampaigns)[tier] > 0);
  const floors = floor * Math.max(1, buildable.length);
  const targetMinor = Math.floor((showDailyMinor * rule.share) / 100 + 1e-9);
  // Two campaigns (staged; Matas, 26 Nov: "folds prospecting"): Wider replaces the show's prospecting and gives Retargeting its share,
  // so no prospecting ad set is lowered; the show's whole daily spend is there to give.
  const fromWider = twoCampaigns && !existing;
  const take: Take = existing
    ? { neededMinor: existing.totalMinor, takenMinor: existing.totalMinor, from: existing.took.map((row) => ({ ...row })), short: false }
    : fromWider
      ? { neededMinor: Math.max(targetMinor, floors), takenMinor: Math.min(showDailyMinor, Math.max(targetMinor, floors)), from: [], short: showDailyMinor < Math.max(targetMinor, floors) }
      : takeFromProspecting(input.prospecting, Math.max(targetMinor, floors), floor);
  const made = input.made ?? new Set<string>();
  const toMake = audiencesToMake(specs);
  const audiences = { made: toMake.filter((aud) => made.has(aud.key)).length, toMake: toMake.filter((aud) => !made.has(aud.key)).length, missingAccess: missingAccess(input.sources.accounts).length };
  const base = { code: input.code, stretch, share: rule.share, showDailyMinor, targetMinor, specs, audiences };
  const split = take.takenMinor >= floors ? splitTotal(take.takenMinor, splitOf(stretch, twoCampaigns), { floorMinor: floor, buildable }) : null;
  if (!split) {
    return { ...base, totalMinor: 0, tiers: NO_TIERS(), atFloor: [], take: { ...take, takenMinor: 0, from: [] }, short: true, noMoney: true, steps: [] };
  }
  // A take above the share is only the floors' top-up (RF8), never more.
  const steps: FunnelStepPlan[] = [];
  let budgets = existing ? input.prospecting.map((row) => ({ ...row })) : afterTake(input.prospecting, take);
  let taken: TakeLine[] = take.from.map((row) => ({ ...row }));
  let total = take.takenMinor;
  for (const step of stepsAfter(input.runDay, dates)) {
    const next = RF3[step.stretch];
    const stepTarget = Math.max(floors, Math.floor((showDailyMinor * next.share) / 100 + 1e-9));
    let lines: TakeLine[] = [];
    let delta = 0;
    if (fromWider || twoCampaigns) {
      // Wider gives and takes back (its lifetime budget moves, show-campaigns.ts planWider); no prospecting line.
      delta = Math.min(stepTarget, showDailyMinor) - total;
    } else if (stepTarget > total) {
      const more = takeFromProspecting(budgets, stepTarget - total, floor);
      lines = more.from;
      delta = more.takenMinor;
      budgets = afterTake(budgets, more);
      for (const line of more.from) {
        const had = taken.find((row) => row.id === line.id);
        if (had) had.afterMinor = line.afterMinor;
        else taken.push({ ...line });
      }
    } else if (stepTarget < total) {
      const back = giveBack(budgets, taken, total - stepTarget);
      lines = back.lines;
      delta = -back.given;
      budgets = back.budgets;
      taken = taken.map((row) => ({ ...row, afterMinor: budgets.find((b) => b.id === row.id)?.dailyMinor ?? row.afterMinor }));
    }
    const newTotal = total + delta;
    const stepSplit = splitTotal(newTotal, splitOf(step.stretch, twoCampaigns), { floorMinor: floor, buildable });
    if (!stepSplit) continue;
    steps.push({ day: step.day, stretch: step.stretch, share: next.share, targetMinor: Math.floor((showDailyMinor * next.share) / 100 + 1e-9), totalMinor: newTotal, tiers: stepSplit.tiers, deltaMinor: delta, prospecting: lines });
    total = newTotal;
  }
  return { ...base, totalMinor: sum(split.tiers), tiers: split.tiers, atFloor: split.atFloor, take, short: take.short && take.takenMinor < targetMinor, noMoney: false, steps };
}

// ─── The words: the panel's Create line and RF9's lines for Claude ───────────

/** "£15.00 a day · 25 % of the show's daily spend · announce" */
export function shareLine(plan: Pick<FunnelShowPlan, "targetMinor" | "share" | "stretch">): string {
  return fill("rt.share.line", { x: money(plan.targetMinor), p: plan.share, stretch: stretchName(plan.stretch) });
}

/** "Cold £9.00 · Warm £4.50 · Hot £1.50"; with the staged Similar tier, "Similar £{s} · " before it (PENDING DESIGN). */
export function splitLine(tiers: TierMinor): string {
  const line = fill("rt.share.split", { c: money(tiers.cold), w: money(tiers.warm), h: money(tiers.hot) });
  return tiers.similar > 0 ? `Similar £${money(tiers.similar)}${JOIN}${line}` : line;
}

/** The take's line(s): rt.take, then rt.take.short when short; rt.take.none alone with nothing to give. */
export function takeLines(plan: FunnelShowPlan): string[] {
  if (plan.noMoney) return [fill("rt.take.none")];
  const lines = [fill("rt.take", { x: money(plan.take.takenMinor), from: takeFromText(plan.take.from), s: money(plan.showDailyMinor) })];
  if (plan.short) lines.push(fill("rt.take.short", { y: money(plan.take.takenMinor), x: money(plan.targetMinor) }));
  return lines;
}

/** PENDING DESIGN: a step that gives money back (a payday week ending). No row covers it. */
export function nextGivesBack(args: { stretch: string; date: string; p: number; x: string; to: string }): string {
  return `Next: ${args.stretch} from ${args.date} · ${args.p} % · moves £${args.x} a day from retargeting to ${args.to}`;
}

/** PENDING DESIGN: a step prospecting can't give anything more to (it was short already). No row covers it. */
export function nextMovesNothing(args: { stretch: string; date: string; p: number }): string {
  return `Next: ${args.stretch} from ${args.date} · ${args.p} % · prospecting has nothing more to give`;
}

/** The footer: the next stretch and what it moves, or the last stretch's show day. */
export function nextLine(plan: FunnelShowPlan, showDay: string): string | null {
  if (plan.noMoney) return null;
  const step = plan.steps[0];
  if (!step) return fill("rt.next.none", { date: rfDay(showDay) });
  const names = [...new Set(step.prospecting.map((row) => row.name))].join(JOIN);
  if (step.deltaMinor === 0) return nextMovesNothing({ stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share });
  if (step.deltaMinor < 0) return nextGivesBack({ stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share, x: money(-step.deltaMinor), to: names });
  return fill("rt.next", { stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share, x: money(step.deltaMinor), from: names });
}

/** RF8's muted line on a tier at the floor. */
export const FLOOR_LINE = fill("rt.floor");

/** RF9: the plan's line for Claude, then up to three short lines. */
export function claudePlanLines(plan: FunnelShowPlan, sources: FunnelSources): string[] {
  let first = fill("claude.rt.plan.line", {
      code: plan.code,
      stretch: stretchName(plan.stretch),
      p: plan.share,
      x: money(plan.targetMinor),
      c: money(plan.tiers.cold),
      w: money(plan.tiers.warm),
      h: money(plan.tiers.hot),
      from: takeFromText(plan.take.from),
      made: plan.audiences.made,
      make: plan.audiences.toMake,
      missing: plan.audiences.missingAccess,
    });
  // PENDING DESIGN: the staged Similar tier's money, before Cold.
  if (plan.tiers.similar > 0) first = first.replace(": Cold £", `: Similar £${money(plan.tiers.similar)}${JOIN}Cold £`);
  const lines = [first];
  if (plan.short) lines.push(fill("claude.rt.plan.short", { y: money(plan.take.takenMinor), x: money(plan.targetMinor) }));
  const missing = missingAccess(sources.accounts);
  if (missing.length) {
    lines.push(fill("claude.rt.plan.access", { names: missing.map((row) => fill("rt.access.name", { account: row.name, platform: row.platform === "facebook" ? "Facebook" : "Instagram" })).join(JOIN) }));
  }
  const step = plan.steps[0];
  if (step) lines.push(fill("claude.rt.plan.next", { stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share }));
  return lines;
}

export type SkipReason = "no_pixel" | "no_link" | "soon" | "archived" | "built" | "no_money";

const SKIP_ROW = {
  no_pixel: "claude.rt.skip.no_pixel",
  no_link: "claude.rt.skip.no_link",
  soon: "claude.rt.skip.soon",
  archived: "claude.rt.skip.archived",
  built: "claude.rt.skip.built",
  no_money: "claude.rt.skip.no_money",
} as const;

export function skipLine(code: string, reason: SkipReason): string {
  return fill("claude.rt.skip", { code, reason: fill(SKIP_ROW[reason]) });
}

export function planHead(args: { shows: number; build: number; skipped: number }): string {
  return fill("claude.rt.plan.head", { n: args.shows, a: args.build, c: args.skipped });
}

/** The show is within 3 days of today (RF9's skip). */
export const SOON_DAYS = 3;

export function isSoon(runDay: string, showDay: string): boolean {
  return Date.parse(`${showDay}T12:00:00Z`) - Date.parse(`${runDay}T12:00:00Z`) <= SOON_DAYS * 86_400_000;
}

/** RF9's skip for a show, in RF9's order of reasons, or null when it's built. */
export function skipReason(args: { archived: boolean; built: boolean; runDay: string; showDay: string | null; pixelId: string | null; hasTicketLink: boolean; plan: FunnelShowPlan | null }): SkipReason | null {
  if (args.archived) return "archived";
  if (args.built) return "built";
  if (!args.showDay || isSoon(args.runDay, args.showDay)) return "soon";
  if (!args.pixelId) return "no_pixel";
  if (!args.hasTicketLink) return "no_link";
  if (!args.plan || args.plan.noMoney) return "no_money";
  return null;
}

/** RF9: create_retargeting's answer. */
export function doneLine(args: { code: string; live: boolean; made: number; takenMinor: number }): string {
  return fill("claude.rt.done", { code: args.code, state: args.live ? "live" : "paused", made: args.made, x: money(args.takenMinor), when: fill(args.live ? "claude.rt.done.when.live" : "claude.rt.done.when.paused") });
}
