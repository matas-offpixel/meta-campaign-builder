/**
 * Two campaigns per show — STAGED (scratch/retargeting-two-campaigns-2026-11-26.md,
 * Matas 26 Nov; design's re-ruling of #1396 is to come). Nothing here is
 * used by the panel or the connector while SHOW_CAMPAIGNS_RULED is false;
 * the funnel (#1396) builds Retargeting alone until then.
 *
 *   "{code} · Wider": Advantage+ audience (suggestions on), a lifetime
 *   budget. Ad sets: Broad (the lineup artists as interest suggestions;
 *   replaces the lineup ad set), Similar pages (the genre group's engagers
 *   as suggestions), Interests (the genre's interests as suggestions),
 *   Lookalikes (1 % UK lookalikes of the artist engagers + followers, the
 *   signups lists and the similar lists, one per source, as suggestions).
 *   Leaves out buyers, Hot and Warm; Cold stays open.
 *
 *   "{code} · Retargeting": the funnel, Advantage+ off, daily budgets:
 *   Similar · Cold · Warm · Hot (and Buyers, upsell, only with upsells).
 *
 * Each stretch step lowers Wider's remaining lifetime budget by the step ×
 * the days left, never below £1.00 a day per ad set.
 *
 * Every Claude- or screen-facing word here is PENDING DESIGN.
 * Pure. Relative imports only (node:test).
 */

import { GEO_WORDS, geoExpansionOf } from "../meta/geo-expansion.ts";
import { fill } from "./funnel-words.ts";
import { FLOOR_MINOR, funnelSpecs, similarAudiences, type FunnelAudience, type FunnelSources, type PageGroup } from "./funnel.ts";

/** Off until the two-campaign record merges and Matas rules the split. */
export const SHOW_CAMPAIGNS_RULED = false;

/** TC1: "{code} · Wider". */
export function widerCampaignName(code: string): string {
  return fill("wd.name.campaign", { code });
}

export type WiderAdSetKey = "broad" | "similar_pages" | "interests" | "lookalikes";

export const WIDER_AD_SET_LABEL: Record<WiderAdSetKey, string> = { broad: fill("wd.set.broad"), similar_pages: fill("wd.set.similar_pages"), interests: fill("wd.set.interests"), lookalikes: fill("wd.set.lookalikes") };

/** TC1: "{code} · Wider · {set}". */
export function widerAdSetName(code: string, key: WiderAdSetKey): string {
  return fill("wd.name.adset", { code, set: WIDER_AD_SET_LABEL[key] });
}

export type Interest = { id: string; name: string };

/** A 1 % UK lookalike of one origin audience (Job 2's LOOKALIKE create: country GB, ratio 0.01, reused per source and spec). */
export type LookalikeAudience = { key: string; kind: "lookalike"; originKey: string; country: "GB"; ratio: 0.01 };

export type WiderAdSet = {
  key: WiderAdSetKey;
  /** Interest suggestions. */
  interests: Interest[];
  /** Custom audiences as suggestions (the group's engagers). */
  suggestions: FunnelAudience[];
  lookalikes: LookalikeAudience[];
  excludes: FunnelAudience[];
};

export type WiderInputs = {
  sources: FunnelSources;
  pageGroup: PageGroup | null;
  /** The lineup artists that are Meta interests. */
  lineupInterests: Interest[];
  /** The genre's interests. */
  genreInterests: Interest[];
};

/** Each lookalike's origin: the artist engagers and followers (Cold's account audiences), the signups lists, the similar lists. */
export function lookalikeOrigins(sources: FunnelSources): FunnelAudience[] {
  const cold = funnelSpecs(sources, { twoCampaigns: true }).find((spec) => spec.tier === "cold")?.includes ?? [];
  const accounts = cold.filter((aud) => aud.source === "engaged" || aud.source === "followers");
  const lists: FunnelAudience[] = sources.lists
    .filter((list) => list.role === "signups" || list.role === "similar")
    .map((list) => ({ key: `list:${list.metaAudienceId}`, source: list.role === "signups" ? "signups" : "similar", kind: "list", metaAudienceId: list.metaAudienceId, role: list.role }));
  return [...accounts, ...lists];
}

/** Wider's ad sets: an ad set with nothing to suggest isn't made (Broad always is: Advantage+ with no suggestion is still broad). */
export function widerSpecs(input: WiderInputs): WiderAdSet[] {
  const specs = funnelSpecs(input.sources, { twoCampaigns: true, pageGroup: input.pageGroup });
  const of = (tier: string) => specs.find((spec) => spec.tier === tier)?.includes ?? [];
  const buyers: FunnelAudience[] = input.sources.lists.filter((list) => list.role === "buyers").map((list) => ({ key: `list:${list.metaAudienceId}`, source: "signups", kind: "list", metaAudienceId: list.metaAudienceId, role: "buyers" }));
  // Leaves out buyers, Hot and Warm; Cold stays open.
  const excludes = [...of("warm"), ...of("hot"), ...buyers];
  const out: WiderAdSet[] = [{ key: "broad", interests: input.lineupInterests, suggestions: [], lookalikes: [], excludes }];
  const similar = similarAudiences(input.pageGroup);
  if (similar.length) out.push({ key: "similar_pages", interests: [], suggestions: similar, lookalikes: [], excludes });
  if (input.genreInterests.length) out.push({ key: "interests", interests: input.genreInterests, suggestions: [], lookalikes: [], excludes });
  const lookalikes: LookalikeAudience[] = lookalikeOrigins(input.sources).map((origin) => ({ key: `lal:gb:1:${origin.key}`, kind: "lookalike", originKey: origin.key, country: "GB", ratio: 0.01 }));
  if (lookalikes.length) out.push({ key: "lookalikes", interests: [], suggestions: [], lookalikes, excludes });
  return out;
}

export type ExistingCampaign = { id: string; name: string; adSetNames: string[]; delivering: boolean };

export type ExistingAdvice = { id: string; name: string; advice: "keep" | "pause" | "fold" };

const PROSPECTING = /\b(broad|advantage|interest|lookalike|\blal\b|similar|prospect|cold)/i;
const LINEUP = /\blineup\b|\bline-up\b/i;
const RETARGET = /retarget/i;

/**
 * READING (staged item: "plan_retargeting says which to keep, pause or fold
 * into Wider; nothing is paused without Matas's yes"): a campaign whose
 * delivering ad sets are all prospecting by name (broad, interests,
 * lookalikes, similar) folds into Wider; one that's only a lineup or
 * retargeting ad set is paused (Cold and the Retargeting campaign replace
 * it); anything else (Tests, a Purchase campaign, a brand campaign) is kept.
 * Advice only: nothing is paused or folded here.
 */
export function adviseExisting(campaigns: readonly ExistingCampaign[]): ExistingAdvice[] {
  return campaigns.filter((row) => row.delivering).map((row) => {
    const names = row.adSetNames.length ? row.adSetNames : [row.name];
    if (names.every((name) => LINEUP.test(name) || RETARGET.test(name))) return { id: row.id, name: row.name, advice: "pause" as const };
    if (names.every((name) => PROSPECTING.test(name) || LINEUP.test(name))) return { id: row.id, name: row.name, advice: "fold" as const };
    return { id: row.id, name: row.name, advice: "keep" as const };
  });
}

/** Design's ruled lines (#1401, 27 Nov): GEO_WORDS, lib/meta/geo-expansion.ts. */
export const untickLine = GEO_WORDS.untick;
export const geoNotReadLine = GEO_WORDS.notRead;

/**
 * The read-back: an ad set's targeting as Meta holds it after create.
 * Location expansion is off only when individual_setting.geo is 0; a
 * missing key isn't proof it's off.
 */
export function geoExpansionOff(targeting: Record<string, unknown> | null): boolean {
  return geoExpansionOf(targeting) === "off";
}

/** Retargeting's "Use as a suggestion" is off when advantage_audience is 0. */
export function advantageOff(targeting: Record<string, unknown> | null): boolean {
  const automation = (targeting?.targeting_automation ?? null) as { advantage_audience?: unknown } | null;
  return automation?.advantage_audience === 0;
}

/** Days from `from` to the show day, both counted (0 after the show). */
export function daysLeft(from: string, showDay: string): number {
  return Math.max(0, Math.round((Date.parse(`${showDay}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);
}

export type WiderStep = { day: string; beforeMinor: number; afterMinor: number; deltaDailyMinor: number; wantDailyMinor: number; givenDailyMinor: number; atFloor: boolean; retargetingMinor: number };

export type WiderPlan = {
  /** Wider's money a day today: the show's daily spend less Retargeting's. */
  dailyMinor: number;
  /** Its campaign (CBO) lifetime budget: that × the days left to its end. */
  lifetimeMinor: number;
  daysLeft: number;
  /** The show day, or the on-sale date for a presale show (TC7). */
  endDay: string;
  adSets: number;
  /** Each stretch step: the campaign's lifetime budget before → after, and what Retargeting gets (TC6). */
  steps: WiderStep[];
  /** Wider can't keep £1.00 a day per ad set today. */
  tooSmall: boolean;
};

/**
 * TC6 (Matas, 26 Nov: "folds prospecting", "Campaign (CBO)"): Wider's
 * lifetime is (the show's daily spend − Retargeting's) × the days to its end.
 * Each stretch step raises Retargeting by £x a day and lowers Wider's
 * remaining budget by £x × the days left, never below £1.00 a day per Wider
 * ad set (the coordinator's reading under CBO: remaining ≥ £1.00 × ad sets ×
 * days left). When the floor stops a full step, Retargeting rises only by
 * what Wider can give, to the penny. A step that lowers Retargeting gives
 * Wider its money back. Spend to a step is taken as the plan's money a day.
 */
export function planWider(args: { showDailyMinor: number; retargetingMinor: number; runDay: string; showDay: string; endDay?: string; adSets: number; steps: readonly { day: string; totalMinor: number }[] }): WiderPlan {
  const adSets = Math.max(1, args.adSets);
  const endDay = args.endDay ?? args.showDay;
  const left = daysLeft(args.runDay, endDay);
  const dailyMinor = Math.max(0, args.showDailyMinor - args.retargetingMinor);
  const lifetimeMinor = dailyMinor * left;
  const steps: WiderStep[] = [];
  let lifetime = lifetimeMinor;
  let daily = dailyMinor;
  let spent = 0;
  let from = args.runDay;
  let retargeting = args.retargetingMinor;
  for (const step of args.steps) {
    if (step.day > endDay) break;
    spent += daily * (daysLeft(from, step.day) - 1);
    const remaining = lifetime - spent;
    const rest = daysLeft(step.day, endDay);
    const want = step.totalMinor - retargeting;
    const floor = FLOOR_MINOR * adSets * rest;
    let given = want;
    if (want > 0) given = Math.max(0, Math.min(want, Math.floor((remaining - floor) / Math.max(1, rest))));
    const afterRemaining = remaining - given * rest;
    const after = spent + afterRemaining;
    steps.push({ day: step.day, beforeMinor: lifetime, afterMinor: after, deltaDailyMinor: given, wantDailyMinor: want, givenDailyMinor: given, atFloor: want > 0 && given < want, retargetingMinor: retargeting + given });
    lifetime = after;
    daily = rest > 0 ? Math.floor(afterRemaining / rest) : 0;
    retargeting += given;
    from = step.day;
  }
  return { dailyMinor, lifetimeMinor, daysLeft: left, endDay, adSets, steps, tooSmall: dailyMinor < FLOOR_MINOR * adSets };
}

/** PENDING DESIGN: a live create refused while the prospecting Wider replaces still runs. */
export function foldFirstLine(code: string, names: readonly string[]): string {
  return `Refused: ${code}'s prospecting still runs (${names.join(" · ")}). Fold or pause it first, on Matas's yes, then make it live. Nothing was changed.`;
}
