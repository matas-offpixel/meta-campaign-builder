/**
 * The Retargeting panel under the two campaigns (docs/design-record/2026-11-26-retargeting-two-campaigns.html,
 * TC1–TC9, frames TW-A, TW-B, TW-C; RF-B and RF-C stand for RF5 and RF6):
 *   - the Create card (TC1): Wider, Retargeting, the split, the show's total,
 *     the presale note (TC7), location expansion off, and the next step;
 *   - a running build's Wider row (TC6): what's left, the last step and the
 *     floor line;
 *   - one row per tier, Similar · Cold · Warm · Hot (TC2): audiences, the
 *     muted "From the venue's and promoter's Pages and the lineup artists"
 *     line (TC9), leave-outs ("signed up" for presale), frequency, budget,
 *     and under Budget the cap (ochre), its lift, a warmer tier's extra, the
 *     floor and Similar's share when it's skipped (muted, TC3);
 *   - the footer: the next step, the last stretch, or the on-sale date (TC7).
 *
 * What stands from the 17 Nov records: the panel's place, Accept and
 * Reject, the purchase read and the not-proposed sentences. Pure.
 */

import { tierBudget } from "./words.ts";
import {
  accessLine,
  capTiers,
  funnelSpecs,
  FUNNEL_TIERS,
  FUNNEL_TIER_LABEL,
  leavesOutText,
  SPLIT_WITH_SIMILAR,
  splitTotal,
  stretchName,
  tierAudienceLines,
  tierFromLine,
  type FunnelAccount,
  type FunnelSources,
  type FunnelTier,
  type SpecOptions,
  type TakeLine,
  type TierMinor,
  type TierWeek,
} from "./funnel.ts";
import { widerGive } from "./show-campaigns.ts";
import { SIMILAR_RETURN } from "./funnel-plan.ts";
import { createLines, FLOOR_LINE, nextLine, shareLine, similarSkipRow, type FunnelShowPlan, type WiderWords } from "./funnel-plan.ts";
import { fill, freq, JOIN, money, rfDay } from "./funnel-words.ts";
import type { SourcePage, SourceSet } from "./audiences.ts";
import { genreLabelInSentence, type GenreFamilyKey } from "../learning/genre/families.ts";

export type FunnelLine = { text: string; tone: "ochre" | "muted" };

export type FunnelTierRow = {
  tier: FunnelTier;
  label: string;
  audiences: string[];
  /** TC9: whose Pages and accounts the account sources use (muted, last). */
  from: string | null;
  /** TC3: Similar skipped, in place of its audiences; its budget reads "—". */
  skipped: string | null;
  /** The skipped line's tone: muted, or ochre when the step couldn't add Similar (rt.similar.back.failed). */
  skippedTone?: "muted" | "ochre";
  leavesOut: string;
  /** 7-day frequency; null before the campaign runs. */
  frequency: number | null;
  /** Null when the tier is skipped. */
  budgetMinor: number | null;
  /** Under Budget: the cap (ochre) and its lift, a warmer tier's extra (Similar's when it's skipped), the floor (muted). */
  lines: FunnelLine[];
};

export type FunnelPanel = {
  /** Retargeting's share line (the running panel's first line). */
  shareLine: string;
  /** RF6: once per panel, under the share line (brick). */
  access: string | null;
  /** TC7: the presale note under the share line (running). */
  notes: string[];
  /** TC1: "CREATE {code} · Wider and {code} · Retargeting", its lines, the muted geo line and the next step. */
  create: { title: string; lines: string[]; muted: string[]; next: string | null; noMoney: boolean } | null;
  /** TC6: a running build's Wider row and the line after it (muted, or ochre at the floor). */
  wider: { row: string; line: FunnelLine | null } | null;
  tiers: FunnelTierRow[];
  /** The footer: the next step, the last stretch, or a presale show's on-sale date. */
  next: string | null;
};

/** RF2 / RF6 / TC9: the promoter's brand Pages, the venue's Page and the lineup's Facebook Pages and Instagram accounts. */
export function accountsFromPages(pages: readonly SourcePage[]): FunnelAccount[] {
  const out: FunnelAccount[] = [];
  for (const page of pages) {
    if (page.kind !== "promoter" && page.kind !== "lineup" && page.kind !== "venue") continue;
    out.push({ pageId: page.id, name: page.name, platform: "facebook", kind: page.kind, access: page.hasRole });
    if (page.igId) out.push({ pageId: page.id, igId: page.igId, name: page.name, platform: "instagram", kind: page.kind, access: page.hasRole });
  }
  return out;
}

/** The funnel's sources from the read's source set (the video ids are read at Apply). */
export function funnelSourcesOf(set: SourceSet, accounts?: readonly FunnelAccount[]): FunnelSources {
  const list = accounts ? [...accounts] : accountsFromPages(set.pages);
  const pending = set.videos.some((group) => group.videoIds.length > 0) && !set.videos.some((group) => group.contextId);
  const firstPage = list.find((row) => row.access !== false && row.kind === "promoter")?.pageId ?? list.find((row) => row.access !== false)?.pageId ?? null;
  const videos = pending ? (firstPage ? [{ pageId: firstPage, videoIds: ["pending"] }] : []) : set.videos.map((group) => ({ pageId: group.contextId, videoIds: group.videoIds }));
  return { pixelId: set.pixelId, links: set.links, accounts: list, videos, lists: set.lists };
}

/** "drum & bass": a genre as the rows write it. */
export function genreWords(genre: string | null | undefined): string | null {
  if (!genre) return null;
  try {
    return genreLabelInSentence(genre as GenreFamilyKey);
  } catch {
    return genre;
  }
}

const plusLine = (from: FunnelTier, minor: number): FunnelLine => ({ text: fill("rt.cap.plus", { x: money(minor), from: FUNNEL_TIER_LABEL[from] }), tone: "muted" });

export type RowOptions = {
  atFloor?: readonly FunnelTier[];
  week?: Partial<Record<FunnelTier, TierWeek>>;
  took?: readonly TakeLine[];
  spec?: SpecOptions;
  /** TC3: Similar skipped this read (its share is in Cold's budget): the reason, the code and its share. */
  similar?: { reason: "no_genre" | "no_group" | "too_small"; code: string; minor: number; /** In place of the skip row: Similar comes back at the next step, or couldn't be added. */ text?: string; tone?: "muted" | "ochre" } | null;
};

/** The tier rows for these budgets; with the 7-day figures (a running campaign), RF5's caps. */
export function funnelTierRows(sources: FunnelSources, shares: TierMinor, opts: RowOptions = {}): FunnelTierRow[] {
  const specs = funnelSpecs(sources, opts.spec);
  const presale = opts.spec?.presale === true;
  const genre = genreWords(opts.spec?.genreFamily ?? opts.spec?.pageGroup?.genreFamily ?? null);
  const caps = opts.week ? capTiers(shares, opts.week, opts.took ?? []) : null;
  const rows: FunnelTierRow[] = [];
  for (const tier of FUNNEL_TIERS) {
    const spec = specs.find((row) => row.tier === tier);
    if (tier === "similar" && (!spec || opts.similar?.text)) {
      // TC3: the row says Similar is skipped, and Cold takes its share.
      if (opts.similar) rows.push({ tier, label: FUNNEL_TIER_LABEL[tier], audiences: [], from: null, skipped: opts.similar.text ?? similarSkipRow(opts.similar.reason, { code: opts.similar.code, genre, minor: opts.similar.minor }), skippedTone: opts.similar.tone ?? "muted", leavesOut: "", frequency: null, budgetMinor: null, lines: [] });
      continue;
    }
    if (!spec) continue;
    const lines: FunnelLine[] = [];
    const cap = caps?.caps[tier];
    if (cap) {
      const to = cap.to === "prospecting" ? (cap.back ?? []).map((row) => row.name).join(JOIN) : FUNNEL_TIER_LABEL[cap.to];
      if (cap.to === "prospecting" && to) lines.push({ text: fill("rt.cap.back", { c: money(cap.capMinor), f: freq(cap.frequency), x: money(cap.extraMinor), to }), tone: "ochre" });
      else if (cap.to !== "prospecting") lines.push({ text: fill("rt.cap", { c: money(cap.capMinor), f: freq(cap.frequency), x: money(cap.extraMinor), to }), tone: "ochre" });
      lines.push({ text: fill("rt.cap.lift"), tone: "muted" });
    }
    for (const plus of caps?.plus[tier] ?? []) lines.push(plusLine(plus.from, plus.minor));
    let budget = shares[tier];
    if (tier === "cold" && opts.similar) {
      budget -= opts.similar.minor;
      lines.push(plusLine("similar", opts.similar.minor));
    }
    if (opts.atFloor?.includes(tier)) lines.push({ text: FLOOR_LINE, tone: "muted" });
    const frequency = opts.week?.[tier]?.frequency ?? null;
    rows.push({ tier, label: FUNNEL_TIER_LABEL[tier], audiences: tierAudienceLines(spec, { presale, genreLabel: genre }), from: tierFromLine(spec, sources), skipped: null, leavesOut: leavesOutText(tier, presale), frequency: frequency == null ? null : Math.round(frequency * 10) / 10, budgetMinor: budget, lines });
  }
  return rows;
}

/** TC3: Similar's share this stretch, when it's skipped (it's already in Cold's budget). */
export function similarShareOf(plan: Pick<FunnelShowPlan, "similarSkip" | "totalMinor" | "stretch" | "code">): RowOptions["similar"] {
  if (!plan.similarSkip) return null;
  const minor = splitTotal(plan.totalMinor, SPLIT_WITH_SIMILAR[plan.stretch])?.tiers.similar ?? 0;
  return { reason: plan.similarSkip, code: plan.code, minor };
}

/** tc.create.title: the Create card's title, both campaign names. */
export function createTitle(code: string): string {
  return fill("tc.create.title", { wider: fill("wd.name.campaign", { code }), retargeting: fill("rt.name.campaign", { code }) });
}

/** A proposed show: the Create card and the rows at its budgets. */
export function proposedPanel(plan: FunnelShowPlan, sources: FunnelSources, args: { showDay: string; wider: WiderWords; spec?: SpecOptions; onSaleDay?: string | null }): FunnelPanel {
  const presale = args.spec?.presale === true;
  const card = createLines(plan, args.wider, presale);
  const footer = nextLine(plan, args.showDay, args.wider, presale && args.onSaleDay ? { onSaleDay: args.onSaleDay } : null);
  return {
    shareLine: shareLine(plan),
    access: accessLine(sources.accounts),
    notes: [],
    create: { title: createTitle(plan.code), lines: card.lines, muted: card.muted, next: presale ? null : footer, noMoney: plan.noMoney },
    wider: null,
    tiers: plan.noMoney ? [] : funnelTierRows(sources, plan.tiers, { atFloor: plan.atFloor, spec: args.spec, similar: similarShareOf(plan) }),
    next: presale ? footer : null,
  };
}

/** A running Wider: its words, Meta's budget_remaining, its ad sets, and the steps whose scheduled change has run. */
export type RunningWider = WiderWords & {
  remainingMinor: number | null;
  adSets?: number;
  /** The steps whose scheduled change has run (scheduled_meta_changes applied); absent = every step to today. */
  doneDays?: readonly string[];
  /** The show's daily spend as the build made it (Wider + Retargeting). */
  showDailyMinor?: number;
};

/**
 * TC6's Wider row: what's left of the lifetime it was made with, its money a
 * day to its end, and one line after it — the floor (ochre) when the next
 * step can't be given in full, else the last step (muted). The next step is
 * re-sized against what's left (Meta's budget_remaining), so the footer
 * gives what Wider can give. Pure.
 */
export function widerRow(w: RunningWider, args: { today: string; stretchOf: (day: string) => FunnelShowPlan["stretch"] }): { row: string; line: FunnelLine | null; steps: WiderWords["steps"] } {
  const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);
  const isDone = (day: string) => (w.doneDays ? w.doneDays.includes(day) : day <= args.today);
  const left = w.remainingMinor ?? w.lifetimeMinor;
  const rest = Math.max(1, days(args.today, w.endDay));
  const daily = Math.floor(left / rest);
  const done = w.steps.filter((step) => isDone(step.day)).at(-1) ?? null;
  // {l} is Meta's lifetime budget now, after any step (the 27 Nov list); {left} what's left of it.
  const row = fill("wd.row", { left: money(left), l: money(done ? done.afterMinor : w.lifetimeMinor), d: money(daily), date: rfDay(w.endDay) });
  const upcoming = w.steps.find((step) => !isDone(step.day) && step.day >= args.today) ?? null;
  const steps = w.steps.map((step) => {
    if (step !== upcoming || w.remainingMinor == null) return step;
    const atStep = left - daily * Math.max(0, days(args.today, step.day) - 1);
    const given = widerGive({ remainingMinor: atStep, wantDailyMinor: step.wantDailyMinor, daysLeft: days(step.day, w.endDay), adSets: w.adSets ?? WIDER_AD_SETS });
    return { ...step, givenDailyMinor: given, atFloor: step.wantDailyMinor > 0 && given < step.wantDailyMinor };
  });
  const next = upcoming ? steps.find((step) => step.day === upcoming.day)! : null;
  let line: FunnelLine | null = null;
  if (next?.atFloor) line = { text: fill("wd.step.floor", { y: money(next.givenDailyMinor), x: money(next.wantDailyMinor) }), tone: "ochre" };
  else if (done?.atFloor) line = { text: fill("wd.step.floor", { y: money(done.givenDailyMinor), x: money(done.wantDailyMinor) }), tone: "ochre" };
  else if (done && done.givenDailyMinor > 0) {
    const n = days(done.day, w.endDay);
    line = { text: fill("wd.step", { y: money(done.givenDailyMinor * n), date: rfDay(done.day), x: money(done.givenDailyMinor), n, stretch: stretchName(args.stretchOf(done.day)) }), tone: "muted" };
  }
  return { row, line, steps };
}

/** Wider's four ad sets (TC1), when a build doesn't say. */
const WIDER_AD_SETS = 4;

/**
 * A running (or paused) build: Retargeting's share line, Wider's row (what's
 * left of its lifetime, its money a day, the last step or the floor), the
 * rows with caps from the 7-day figures, and the next step.
 */
export function runningPanel(
  plan: FunnelShowPlan,
  sources: FunnelSources,
  args: { showDay: string; today: string; built: { tiers: TierMinor; took: readonly TakeLine[]; week?: Partial<Record<FunnelTier, TierWeek>>; similarRefused?: { day: string; reason: string } | null }; wider?: RunningWider | null; spec?: SpecOptions; onSaleDay?: string | null },
): FunnelPanel {
  const total = FUNNEL_TIERS.reduce((sum, tier) => sum + args.built.tiers[tier], 0);
  const presale = args.spec?.presale === true;
  const stretchOf = (day: string) => plan.steps.find((step) => step.day === day)?.stretch ?? plan.stretch;
  const w = args.wider ? widerRow(args.wider, { today: args.today, stretchOf }) : null;
  const isDone = (day: string) => (args.wider?.doneDays ? args.wider.doneDays.includes(day) : day <= args.today);
  return {
    shareLine: shareLine({ targetMinor: total, share: plan.share, stretch: plan.stretch }),
    access: accessLine(sources.accounts),
    notes: presale ? [fill("rt.presale.note")] : [],
    create: null,
    wider: w ? { row: w.row, line: w.line } : null,
    tiers: funnelTierRows(sources, args.built.tiers, { week: args.built.week, took: args.built.took, spec: args.spec, similar: args.built.tiers.similar === 0 ? (similarShareOf(plan) ?? similarReturnOf(plan, args.built.similarRefused ?? null, (day) => !isDone(day) && day > args.today)) : null }),
    next: nextLine({ ...plan, steps: footerSteps(plan, args.wider ?? null, args.today, isDone) }, args.showDay, args.wider && w ? { ...args.wider, steps: w.steps } : null, presale && args.onSaleDay ? { onSaleDay: args.onSaleDay } : null),
  };
}

/**
 * Matas, 27 Nov ("Yes, at the next step"): a running build without Similar
 * whose group is confirmed now — Similar comes back at the next step (or
 * couldn't be added at the last one); its share is in Cold until then.
 */
export function similarReturnOf(plan: FunnelShowPlan, refused: { day: string; reason: string } | null, ahead: (day: string) => boolean): RowOptions["similar"] {
  if (plan.similarSkip || !plan.specs.some((spec) => spec.tier === "similar")) return null;
  const minor = splitTotal(plan.totalMinor, SPLIT_WITH_SIMILAR[plan.stretch])?.tiers.similar ?? 0;
  const next = plan.steps.find((step) => ahead(step.day)) ?? null;
  const text = refused ? SIMILAR_RETURN.rowRefused(rfDay(refused.day), refused.reason, money(minor)) : next ? SIMILAR_RETURN.row(rfDay(next.day), money(minor)) : SIMILAR_RETURN.rowNoStep(money(minor));
  return { reason: "no_group", code: plan.code, minor, text, tone: refused ? "ochre" : "muted" };
}

/**
 * The footer's steps: a step due today whose scheduled change hasn't run is
 * still next (today's stretch and share), then the plan's later steps.
 */
function footerSteps(plan: FunnelShowPlan, wider: RunningWider | null, today: string, isDone: (day: string) => boolean): FunnelShowPlan["steps"] {
  const later = plan.steps.filter((step) => !isDone(step.day) && step.day > today);
  const due = wider?.steps.find((step) => !isDone(step.day) && step.day === today);
  if (!due) return later;
  return [{ day: due.day, stretch: plan.stretch, share: plan.share, targetMinor: plan.targetMinor, totalMinor: plan.totalMinor, tiers: plan.tiers, deltaMinor: due.givenDailyMinor, prospecting: [] }, ...later];
}

/** "£4.80 a day" (the 17 Nov record's budget words). */
export function funnelBudget(minor: number): string {
  return tierBudget(minor);
}

/** RF-B / TW at 393: "Frequency 3.2 · leaves out Warm · Hot · buyers", or "leaves out …" before figures. */
export function cardMeta(row: FunnelTierRow): string {
  // {x} with its first letter lower-cased (the 27 Nov list).
  const leaves = fill("rt.m.leaves", { x: row.leavesOut ? row.leavesOut[0]!.toLowerCase() + row.leavesOut.slice(1) : row.leavesOut });
  return row.frequency == null ? leaves : `${fill("rt.m.freq", { f: freq(row.frequency) })}${JOIN}${leaves}`;
}
