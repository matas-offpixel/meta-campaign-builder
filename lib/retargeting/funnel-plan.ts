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
  SPLIT_WITH_SIMILAR,
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
  similarSkipOf,
  type SimilarSkip,
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
  /** Two campaigns: why Similar doesn't run this read (its share is Cold's), or null. */
  similarSkip: SimilarSkip | null;
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
  // Rechecked on every read: a group confirmed later, or an audience grown past Meta's minimum, brings Similar back from the next step.
  const similarSkip = similarSkipOf(input.spec ?? {});
  const splitFor = (s: FunnelStretch) => splitOf(s, twoCampaigns, similarSkip != null);
  const specs = funnelSpecs(input.sources, input.spec);
  const buildable = specs.map((spec) => spec.tier).filter((tier) => splitFor(stretch)[tier] > 0);
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
  const base = { code: input.code, stretch, share: rule.share, showDailyMinor, targetMinor, specs, audiences, similarSkip };
  const split = take.takenMinor >= floors ? splitTotal(take.takenMinor, splitFor(stretch), { floorMinor: floor, buildable }) : null;
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
    const stepSplit = splitTotal(newTotal, splitFor(step.stretch), { floorMinor: floor, buildable });
    if (!stepSplit) continue;
    steps.push({ day: step.day, stretch: step.stretch, share: next.share, targetMinor: Math.floor((showDailyMinor * next.share) / 100 + 1e-9), totalMinor: newTotal, tiers: stepSplit.tiers, deltaMinor: delta, prospecting: lines });
    total = newTotal;
  }
  return { ...base, totalMinor: sum(split.tiers), tiers: split.tiers, atFloor: split.atFloor, take, short: take.short && take.takenMinor < targetMinor, noMoney: false, steps };
}

/** TC7: a presale show — announced, not on sale yet, the show still ahead. */
export function isPresale(input: { onSaleDay: string | null; runDay: string; announceDay?: string | null; eventDate: string | null }): boolean {
  return Boolean(input.onSaleDay && input.onSaleDay > input.runDay && input.announceDay && input.announceDay <= input.runDay && input.eventDate && input.eventDate > input.runDay);
}

// ─── The words: the panel's Create card (TC1), the footer (TC6) and the lines for Claude (TC8) ───

/** "£21.00 a day · 35 % of the show's daily spend · final month" (Retargeting's share; the running panel's first line). */
export function shareLine(plan: Pick<FunnelShowPlan, "targetMinor" | "share" | "stretch">): string {
  return fill("rt.share.line", { x: money(plan.targetMinor), p: plan.share, stretch: stretchName(plan.stretch) });
}

/** TC5: "Similar £3.15 · Cold £5.25 · Warm £7.35 · Hot £5.25" */
export function splitLine(tiers: TierMinor): string {
  return fill("rt.share.split", { s: money(tiers.similar), c: money(tiers.cold), w: money(tiers.warm), h: money(tiers.hot) });
}

/** Wider as the plan sizes it (show-campaigns.ts planWider), for the words. */
export type WiderWords = { lifetimeMinor: number; dailyMinor: number; daysLeft: number; endDay: string; steps: readonly { day: string; beforeMinor: number; afterMinor: number; wantDailyMinor: number; givenDailyMinor: number; atFloor: boolean }[] };

/** TC1's Create card: Wider, Retargeting, the split, the show's total, (presale) the note, and the geo line (muted, last). */
export function createLines(plan: FunnelShowPlan, wider: WiderWords, presale: boolean): { lines: string[]; muted: string[] } {
  const lines = [
    fill("tc.create.wider", { l: money(wider.lifetimeMinor), date: rfDay(wider.endDay), n: wider.daysLeft, d: money(wider.dailyMinor) }),
    fill("tc.create.retargeting", { x: money(plan.totalMinor), p: plan.share, stretch: stretchName(plan.stretch) }),
    splitLine(plan.tiers),
    fill("tc.create.total", { s: money(plan.showDailyMinor), d: money(wider.dailyMinor), x: money(plan.totalMinor) }),
    ...(presale ? [fill("rt.presale.note")] : []),
  ];
  return { lines, muted: [fill("tc.create.geo")] };
}

/** PENDING DESIGN: a step that lowers Retargeting (a payday week ending into "normally"); Wider's remaining budget goes back up. */
export function nextGivesBack(args: { stretch: string; date: string; p: number; x: string; y: string; n: number }): string {
  return `Next: ${args.stretch} from ${args.date} · ${args.p} % · Retargeting down £${args.x} a day, Wider’s remaining budget up £${args.y} (£${args.x} a day × ${args.n} days)`;
}

/**
 * TC6's footer: the next step with both sides (Retargeting up by what Wider
 * gives, Wider's remaining budget down by that × the days left); the last
 * stretch's show day; a presale show's on-sale date (TC7).
 */
export function nextLine(plan: FunnelShowPlan, showDay: string, wider: WiderWords | null, presale?: { onSaleDay: string } | null): string | null {
  if (plan.noMoney) return null;
  if (presale) return fill("rt.presale.onsale", { date: rfDay(presale.onSaleDay) });
  const step = plan.steps[0];
  if (!step) return fill("rt.next.none", { date: rfDay(showDay) });
  const w = wider?.steps.find((row) => row.day === step.day);
  const n = daysFrom(step.day, wider?.endDay ?? showDay);
  const x = w ? w.givenDailyMinor : step.deltaMinor;
  if (x < 0) return nextGivesBack({ stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share, x: money(-x), y: money(-x * n), n });
  return fill("rt.next", { stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share, x: money(x), y: money(x * n), n });
}

/** Days from a day to the end, both counted. */
function daysFrom(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);
}

/** RF8's muted line on a tier at the floor. */
export const FLOOR_LINE = fill("rt.floor");

/** TC9: the Pages a show matched — its venue's, the promoter's brand Pages, the lineup's. An empty slot is "not matched". */
export type MatchedPages = { venue: string | null; brands: string[]; artists: string[] };

export function matchedPagesLine(pages: MatchedPages): string {
  return fill("claude.rt.plan.pages", {
    venue: pages.venue ?? fill("claude.rt.plan.pages.no_venue"),
    brands: pages.brands.length ? pages.brands.join(", ") : fill("claude.rt.plan.pages.no_brand"),
    // PENDING DESIGN: no row covers a show with no lineup Page matched; it reads as the slots above do.
    artists: pages.artists.length ? pages.artists.join(", ") : fill("claude.rt.plan.pages.no_brand"),
  });
}

export type ExistingAction = "keep" | "pause" | "fold";

const EXISTING_ROW = { keep: "claude.rt.plan.existing.keep", pause: "claude.rt.plan.existing.pause", fold: "claude.rt.plan.existing.fold" } as const;

export function existingLine(campaign: string, action: ExistingAction): string {
  return fill("claude.rt.plan.existing", { campaign, action: fill(EXISTING_ROW[action]) });
}

/** TC3 / TC8: Similar skipped, told to Claude. A group under Meta's minimum has no row yet (PENDING DESIGN). */
export function similarSkipLine(reason: SimilarSkip, args: { code: string; genre: string | null }): string {
  if (reason === "too_small") return "Similar skipped: its page group’s audience is under Meta’s minimum, so its share goes to Cold.";
  const why = reason === "no_genre" ? fill("claude.rt.plan.similar.genre", { code: args.code }) : fill("claude.rt.plan.similar.group", { genre: args.genre ?? "" });
  return fill("claude.rt.plan.similar.skip", { reason: why });
}

/** TC3: the Similar row in place of its audiences (muted), with the £ a day that went to Cold. */
export function similarSkipRow(reason: SimilarSkip, args: { code: string; genre: string | null; minor: number }): string {
  if (reason === "too_small") return `Similar skipped: its page group’s audience is under Meta’s minimum, so its £${money(args.minor)} a day goes to Cold.`;
  return reason === "no_genre" ? fill("rt.similar.skip.genre", { code: args.code, x: money(args.minor) }) : fill("rt.similar.skip.group", { genre: args.genre ?? "", x: money(args.minor) });
}

/**
 * TC8: the plan's line for Claude (both campaigns), then the matched Pages
 * (TC9), missing access (RF6), Similar skipped, presale sign-ups, each
 * existing prospecting campaign, and the next stretch.
 */
export function claudePlanLines(
  plan: FunnelShowPlan,
  sources: FunnelSources,
  extra: { wider: WiderWords; pages?: MatchedPages | null; genre?: string | null; presale?: boolean; presaleSignups?: number | null; existing?: readonly { name: string; action: ExistingAction }[] },
): string[] {
  const lines = [
    fill("claude.rt.plan.line", {
      code: plan.code,
      stretch: stretchName(plan.stretch),
      p: plan.share,
      l: money(extra.wider.lifetimeMinor),
      d: money(extra.wider.dailyMinor),
      x: money(plan.totalMinor),
      s: money(plan.tiers.similar),
      c: money(plan.tiers.cold),
      w: money(plan.tiers.warm),
      h: money(plan.tiers.hot),
      made: plan.audiences.made,
      make: plan.audiences.toMake,
      missing: plan.audiences.missingAccess,
    }),
  ];
  if (extra.pages) lines.push(matchedPagesLine(extra.pages));
  const missing = missingAccess(sources.accounts);
  if (missing.length) {
    lines.push(fill("claude.rt.plan.access", { names: missing.map((row) => fill("rt.access.name", { account: row.name, platform: row.platform === "facebook" ? "Facebook" : "Instagram" })).join(JOIN) }));
  }
  if (plan.similarSkip) lines.push(similarSkipLine(plan.similarSkip, { code: plan.code, genre: extra.genre ?? null }));
  if (extra.presale && extra.presaleSignups != null) lines.push(fill("claude.rt.plan.presale", { n: extra.presaleSignups }));
  for (const row of extra.existing ?? []) lines.push(existingLine(row.name, row.action));
  const step = plan.steps[0];
  if (step && !extra.presale) lines.push(fill("claude.rt.plan.next", { stretch: stretchName(step.stretch), date: rfDay(step.day), p: step.share }));
  return lines;
}

export type SkipReason = "no_pixel" | "no_link" | "no_signup_link" | "soon" | "archived" | "built" | "no_budget";

/** PENDING DESIGN: the two skip reasons TC left without a row (claude.rt.skip.no_money is withdrawn). */
export const SKIP_PENDING = {
  no_budget: "it has no prospecting budget to fold into Wider",
  no_signup_link: "it has no sign-up page link",
} as const;

const SKIP_ROW = {
  no_pixel: "claude.rt.skip.no_pixel",
  no_link: "claude.rt.skip.no_link",
  soon: "claude.rt.skip.soon",
  archived: "claude.rt.skip.archived",
  built: "claude.rt.skip.built",
} as const;

export function skipLine(code: string, reason: SkipReason): string {
  const why = reason === "no_budget" || reason === "no_signup_link" ? SKIP_PENDING[reason] : fill(SKIP_ROW[reason]);
  return fill("claude.rt.skip", { code, reason: why });
}

export function planHead(args: { shows: number; build: number; skipped: number }): string {
  return fill("claude.rt.plan.head", { n: args.shows, a: args.build, c: args.skipped });
}

/** The show is within 3 days of today (RF9's skip). */
export const SOON_DAYS = 3;

export function isSoon(runDay: string, showDay: string): boolean {
  return Date.parse(`${showDay}T12:00:00Z`) - Date.parse(`${runDay}T12:00:00Z`) <= SOON_DAYS * 86_400_000;
}

/** RF9's skip for a show, in RF9's order (TC8: "already built" is either campaign). A presale show needs a sign-up link, not a ticket link. */
export function skipReason(args: { archived: boolean; built: boolean; runDay: string; showDay: string | null; pixelId: string | null; hasTicketLink: boolean; hasSignupLink?: boolean; presale?: boolean; plan: FunnelShowPlan | null }): SkipReason | null {
  if (args.archived) return "archived";
  if (args.built) return "built";
  if (!args.showDay || isSoon(args.runDay, args.showDay)) return "soon";
  if (!args.pixelId) return "no_pixel";
  if (args.presale ? !args.hasSignupLink : !args.hasTicketLink) return args.presale ? "no_signup_link" : "no_link";
  if (!args.plan || args.plan.noMoney) return "no_budget";
  return null;
}

/** TC8: create_show_campaigns' answer. */
export function doneLine(args: { code: string; live: boolean; adSets: number; made: number }): string {
  return fill("claude.rt.done", { code: args.code, state: args.live ? "live" : "paused", n: args.adSets, made: args.made });
}
