/**
 * The Retargeting panel under the funnel (docs/design-record/2026-11-26-retargeting-funnel.html,
 * frames RF-A, RF-B, RF-C): the share line, RF6's access line, the Create
 * card (split, where the money comes from, the next stretch), and one row
 * per tier — Cold, Warm, Hot — with its audiences, leave-outs, frequency
 * and budget, and under the budget the cap (ochre), the lift, a warmer
 * tier's extra and the floor (muted). The footer names the next stretch.
 *
 * What stands from the 17 Nov records: the panel's place, Accept and
 * Reject, the purchase read and the not-proposed sentences. Pure.
 */

import { tierBudget } from "./words.ts";
import {
  capTiers,
  funnelSpecs,
  FUNNEL_TIERS,
  FUNNEL_TIER_LABEL,
  leavesOutText,
  accessLine,
  tierAudienceLines,
  type FunnelAccount,
  type FunnelSources,
  type FunnelTier,
  type TakeLine,
  type TierMinor,
  type TierWeek,
} from "./funnel.ts";
import { FLOOR_LINE, nextLine, shareLine, splitLine, takeLines, type FunnelShowPlan } from "./funnel-plan.ts";
import { fill, freq, JOIN, money } from "./funnel-words.ts";
import type { SourcePage, SourceSet } from "./audiences.ts";

export type FunnelLine = { text: string; tone: "ochre" | "muted" };

export type FunnelTierRow = {
  tier: FunnelTier;
  label: string;
  audiences: string[];
  leavesOut: string;
  /** 7-day frequency; null before the campaign runs. */
  frequency: number | null;
  budgetMinor: number;
  /** Under Budget: the cap (ochre) and its lift, a warmer tier's extra, the floor (muted). */
  lines: FunnelLine[];
};

export type FunnelPanel = {
  shareLine: string;
  /** RF6: once per panel, under the share line (brick). */
  access: string | null;
  create: { split: string; take: string[]; next: string | null; noMoney: boolean } | null;
  tiers: FunnelTierRow[];
  /** The footer on a running campaign: the next stretch, or the last. */
  next: string | null;
};

/** RF2 / RF6: the promoter's and lineup's Facebook Pages and Instagram accounts, from the read's pages. */
export function accountsFromPages(pages: readonly SourcePage[]): FunnelAccount[] {
  const out: FunnelAccount[] = [];
  for (const page of pages) {
    if (page.kind !== "promoter" && page.kind !== "lineup") continue;
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

const plusLine = (from: FunnelTier, minor: number): FunnelLine => ({ text: fill("rt.cap.plus", { x: money(minor), from: FUNNEL_TIER_LABEL[from] }), tone: "muted" });

/** The tier rows for these budgets; with the 7-day figures (a running campaign), RF5's caps. */
export function funnelTierRows(sources: FunnelSources, shares: TierMinor, opts: { atFloor?: readonly FunnelTier[]; week?: Partial<Record<FunnelTier, TierWeek>>; took?: readonly TakeLine[] } = {}): FunnelTierRow[] {
  const specs = funnelSpecs(sources);
  const caps = opts.week ? capTiers(shares, opts.week, opts.took ?? []) : null;
  const rows: FunnelTierRow[] = [];
  for (const tier of FUNNEL_TIERS) {
    const spec = specs.find((row) => row.tier === tier);
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
    if (opts.atFloor?.includes(tier)) lines.push({ text: FLOOR_LINE, tone: "muted" });
    const frequency = opts.week?.[tier]?.frequency ?? null;
    rows.push({ tier, label: FUNNEL_TIER_LABEL[tier], audiences: tierAudienceLines(spec, sources), leavesOut: leavesOutText(tier), frequency: frequency == null ? null : Math.round(frequency * 10) / 10, budgetMinor: shares[tier], lines });
  }
  return rows;
}

/** A proposed show: the Create card and the rows at its budgets. */
export function proposedPanel(plan: FunnelShowPlan, sources: FunnelSources, showDay: string): FunnelPanel {
  return {
    shareLine: shareLine(plan),
    access: accessLine(sources.accounts),
    create: { split: splitLine(plan.tiers), take: takeLines(plan), next: nextLine(plan, showDay), noMoney: plan.noMoney },
    tiers: plan.noMoney ? [] : funnelTierRows(sources, plan.tiers, { atFloor: plan.atFloor }),
    next: null,
  };
}

/** A running (or paused) build: its share line at today's stretch, its rows, caps from the 7-day figures, the next stretch. */
export function runningPanel(plan: FunnelShowPlan, sources: FunnelSources, showDay: string, built: { tiers: TierMinor; took: readonly TakeLine[]; week?: Partial<Record<FunnelTier, TierWeek>> }): FunnelPanel {
  const total = FUNNEL_TIERS.reduce((sum, tier) => sum + built.tiers[tier], 0);
  return {
    shareLine: shareLine({ targetMinor: total, share: plan.share, stretch: plan.stretch }),
    access: accessLine(sources.accounts),
    create: null,
    tiers: funnelTierRows(sources, built.tiers, { week: built.week, took: built.took }),
    next: nextLine(plan, showDay),
  };
}

/** "£4.80 a day" (the 17 Nov record's budget words). */
export function funnelBudget(minor: number): string {
  return tierBudget(minor);
}

/** RF-B / RF-C at 393: "Frequency 3.2 · leaves out Warm · Hot · buyers", or "leaves out …" before figures. */
export function cardMeta(row: FunnelTierRow): string {
  const leaves = fill("rt.m.leaves", { x: row.leavesOut });
  return row.frequency == null ? leaves : `${fill("rt.m.freq", { f: freq(row.frequency) })}${JOIN}${leaves}`;
}
