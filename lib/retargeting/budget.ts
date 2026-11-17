/**
 * RT4: the starting budget (docs/design-record/2026-11-17-retargeting-campaign.html).
 *
 * - Current daily spend is TF1's: the show's Meta spend over the last 7
 *   days across its on-sale campaigns, ÷ 7. The Tests and Retargeting
 *   campaigns aren't counted (the caller leaves them out).
 * - The total starts at 10 % of that (10 · 15 · 20 % on offer), rounded
 *   down to the penny.
 * - The split is Bottom 50 %, Mid Bottom 25 %, Mid 25 %, to the penny, any
 *   odd penny to Bottom. When Mid can't be built (RT8), its 25 % goes to
 *   Bottom and Mid Bottom, 2 to 1.
 * - The floor is £1.00 a day per tier, or Meta's min_daily_budget when
 *   higher. A tier under it is lifted to it and the difference comes out of
 *   Bottom, so the smallest total is three floors.
 * - The money held is the total × the days to the show, both included.
 *
 * Integer pennies throughout. Pure: no database, no Meta.
 */

import type { Tier } from "./words.ts";

/** The £1.00 a day floor (plan-guard.ts's MIN_DAILY_BUDGET_MINOR; not imported, so the panel stays free of server code). */
const MIN_DAILY_BUDGET_MINOR = 100;

export const RT4 = {
  windowDays: 7,
  /** The choice on the Create line, the default first in the record's order. */
  shares: [10, 15, 20] as const,
  defaultShare: 10,
  floorMinor: MIN_DAILY_BUDGET_MINOR,
  /** R5's cap on a refresh's money: 20 % of the remaining plan. */
  capShare: 0.2,
} as const;

export type Share = (typeof RT4.shares)[number];

export function isShare(value: unknown): value is Share {
  return value === 10 || value === 15 || value === 20;
}

/** Current daily spend, in pennies, from the 7 days' spend in pounds. */
export function currentDailyMinor(last7SpendGbp: number): number {
  return Math.round((last7SpendGbp * 100) / RT4.windowDays);
}

export type Starting = {
  totalMinor: number;
  tiers: Record<Tier, number>;
  /** A tier (or Bottom, after giving) was lifted to the floor. */
  atFloor: boolean;
  floorMinor: number;
  share: Share;
};

/**
 * RT4's split for one share. `midBuildable` false: Mid gets nothing and its
 * quarter goes 2 to 1 to Bottom and Mid Bottom. Null with no spend.
 */
export function startingBudget(args: { currentDailyMinor: number; share: Share; minDailyMinor?: number | null; midBuildable: boolean }): Starting | null {
  if (!(args.currentDailyMinor > 0)) return null;
  const floorMinor = Math.max(RT4.floorMinor, args.minDailyMinor != null && args.minDailyMinor > 0 ? args.minDailyMinor : 0);
  const total = Math.floor((args.currentDailyMinor * args.share) / 100 + 1e-9);
  let mid = 0;
  let midBottom: number;
  if (args.midBuildable) {
    midBottom = Math.floor(total / 4);
    mid = Math.floor(total / 4);
  } else {
    midBottom = Math.floor(total / 3);
  }
  let atFloor = false;
  const lift = (value: number) => {
    if (value >= floorMinor) return value;
    atFloor = true;
    return floorMinor;
  };
  midBottom = lift(midBottom);
  if (args.midBuildable) mid = lift(mid);
  // The difference comes out of Bottom; Bottom is never under the floor either.
  let bottom = total - midBottom - mid;
  bottom = lift(bottom);
  return { totalMinor: bottom + midBottom + mid, tiers: { bottom, mid_bottom: midBottom, mid }, atFloor, floorMinor, share: args.share };
}

/** Days from `from` to `to`, both included. */
export function daysToShow(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

export type Funding = {
  holdMinor: number;
  /** £ from plan headroom. */
  headroom: number;
  /** £ moved out of the main campaign's lifetime budget. */
  move: number;
  capGbp: number | null;
  capOf: "plan" | "main";
  fits: boolean;
  /** Why it doesn't fit: over the cap, or nothing to move from. */
  why: "over_cap" | "no_money" | null;
};

/**
 * RT4's money, as the Purchase create decides it: the hold from plan
 * headroom first, the rest a move out of the main campaign's lifetime
 * budget (keeping its floor), all inside 20 % of the remaining plan (or of
 * what the main campaign has left, with no event budget).
 */
export function fundHold(args: {
  holdMinor: number;
  budgetGbp: number | null;
  spendToDateGbp: number;
  /** What every live campaign of the event still has committed, £; null when a budget couldn't be read. */
  committedGbp: number | null;
  appliedMovesGbp?: number;
  main: { lifetimeGbp: number | null; spentToDate: number; floorGbp: number } | null;
}): Funding {
  const hold = args.holdMinor / 100;
  const mainLeft = args.main?.lifetimeGbp == null ? null : Math.max(0, args.main.lifetimeGbp - args.main.spentToDate);
  const capOf: "plan" | "main" = args.budgetGbp != null ? "plan" : "main";
  const capBase = capOf === "plan" ? Math.max(0, args.budgetGbp! - args.spendToDateGbp) : mainLeft;
  const none = (why: Funding["why"], capGbp: number | null): Funding => ({ holdMinor: args.holdMinor, headroom: 0, move: 0, capGbp, capOf, fits: false, why });
  if (capBase == null) return none("no_money", null);
  const capGbp = round2(capBase * RT4.capShare - (args.appliedMovesGbp ?? 0));
  if (hold > capGbp + 1e-9) return none("over_cap", capGbp);
  const headroomLeft = args.budgetGbp != null && args.committedGbp != null ? Math.max(0, args.budgetGbp - args.spendToDateGbp - args.committedGbp) : 0;
  const headroom = round2(Math.min(hold, headroomLeft));
  const move = round2(hold - headroom);
  if (move > 0) {
    const canGive = args.main?.lifetimeGbp == null ? 0 : Math.max(0, args.main.lifetimeGbp - args.main.floorGbp);
    if (move > canGive + 1e-9) return { ...none("no_money", capGbp) };
  }
  return { holdMinor: args.holdMinor, headroom, move, capGbp, capOf, fits: true, why: null };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
