/**
 * The retargeting funnel (docs/design-record/2026-11-26-retargeting-funnel.html,
 * RF1–RF6, RF8). Re-rules the 17 Nov records' tiers, windows, shares and
 * split (RT2, RT11, RT14, RT18). Pure: no database, no Meta.
 *
 * RF1 · three tiers, Cold, Warm and Hot, in that order (left to right).
 *
 * RF2 · one window per source; each tier leaves out every tier to its right,
 * and buyers:
 *
 * | Tier | Includes                                                          | Leaves out          |
 * |------|-------------------------------------------------------------------|---------------------|
 * | Cold | video viewers 75 % · 180 days · engagers · 180 days · followers   | Warm · Hot · buyers |
 * | Warm | show page and ticket-link visitors · 60 days · engagers · 60 days | Hot · buyers        |
 * |      | · video viewers 95 % · 60 days                                    |                     |
 * | Hot  | ticket-link visitors · 30 days · checkout starters · registrations| buyers              |
 * |      | and the signup list · engagers · 30 days · similar lists          |                     |
 *
 * Videos, engagers and followers come from the promoter's and the lineup
 * artists' Facebook Pages and Instagram accounts. An account without
 * advertiser access is left out of every source (RF6); the tier builds
 * without it.
 *
 * RF3 · the share of the show's daily spend and the split, by stretch;
 * overlaps take the higher; payday weeks come round only inside "normally".
 *
 * RF4 · the money is taken from the show's prospecting budgets, largest first,
 * never leaving an ad set under £1.00 (a campaign budget is one budget, and
 * every ad set it feeds keeps £1.00). Short: retargeting starts at what
 * prospecting can give. Nothing: no Create.
 *
 * RF5 · a tier whose 7-day frequency is over 3 is capped at what it spent a
 * day over those 7 days; the rest goes to the next colder tier, and from
 * Cold back to the prospecting budget it came from.
 *
 * RF8 · a tier under the £1.00 floor gets £1.00, taken from the largest other tier.
 *
 * Readings this file makes that the record leaves open are marked READING;
 * each is in the PR under "For design".
 *
 * Integer pennies throughout. Relative imports only (node:test).
 */

import { isInPaydayWindow } from "../dashboard/pacing.ts";
import { addDaysIso } from "../onsale-refresh/schedule.ts";
import { linkKey, RT2, type SourceList } from "./audiences.ts";
import { landingLinks, ticketLinks, type ShowLink } from "./links.ts";
import { fill, JOIN, money, rfDay, freq as freqText, type RfKey } from "./funnel-words.ts";

// ─── RF1 ─────────────────────────────────────────────────────────────────────

/**
 * "similar" is the two-campaign record's tier (staged: scratch/retargeting-two-campaigns-2026-11-26.md,
 * pending design's re-ruling of #1396). Under RF3's split it gets nothing and isn't built.
 */
export type FunnelTier = "similar" | "cold" | "warm" | "hot";

/** Left to right, coldest first, as the panel shows them: each tier leaves out every tier to its right. */
export const FUNNEL_TIERS: readonly FunnelTier[] = ["similar", "cold", "warm", "hot"];

// PENDING DESIGN: "Similar" (the two-campaign record's tier name).
export const FUNNEL_TIER_LABEL: Record<FunnelTier, string> = { similar: "Similar", cold: fill("rt.tier.cold"), warm: fill("rt.tier.warm"), hot: fill("rt.tier.hot") };

/** No money in any tier. */
export const NO_TIERS = (): TierMinor => ({ similar: 0, cold: 0, warm: 0, hot: 0 });

export function funnelCampaignName(code: string): string {
  return fill("rt.name.campaign", { code });
}

export function funnelAdSetName(code: string, tier: FunnelTier): string {
  return fill("rt.name.adset", { code, tier: FUNNEL_TIER_LABEL[tier] });
}

/** Meta's £1.00 a day floor per ad set (plan-guard.ts's MIN_DAILY_BUDGET_MINOR). */
export const FLOOR_MINOR = 100;

// ─── RF3 ─────────────────────────────────────────────────────────────────────

export type FunnelStretch = "announce" | "normally" | "payday" | "final_month" | "final_2w" | "final_week";

export type StretchRule = { share: number; split: Record<FunnelTier, number> };

/** RF3's table. */
export const RF3: Record<FunnelStretch, StretchRule> = {
  announce: { share: 25, split: { similar: 0, cold: 60, warm: 30, hot: 10 } },
  normally: { share: 30, split: { similar: 0, cold: 40, warm: 40, hot: 20 } },
  payday: { share: 35, split: { similar: 0, cold: 30, warm: 45, hot: 25 } },
  final_month: { share: 35, split: { similar: 0, cold: 30, warm: 45, hot: 25 } },
  final_2w: { share: 40, split: { similar: 0, cold: 20, warm: 45, hot: 35 } },
  final_week: { share: 50, split: { similar: 0, cold: 10, warm: 40, hot: 50 } },
};

/**
 * The two-campaign split with Similar, ruled by Matas on 26 Nov ("Yes, use
 * that split"; scratch/retargeting-two-campaigns-2026-11-26.md item 4). The
 * shares are RF3's. One object: the tests read it, never copies of it.
 */
export const SPLIT_WITH_SIMILAR: Record<FunnelStretch, Record<FunnelTier, number>> = {
  announce: { similar: 25, cold: 45, warm: 20, hot: 10 },
  normally: { similar: 20, cold: 30, warm: 35, hot: 15 },
  payday: { similar: 15, cold: 25, warm: 35, hot: 25 },
  final_month: { similar: 15, cold: 25, warm: 35, hot: 25 },
  final_2w: { similar: 10, cold: 15, warm: 40, hot: 35 },
  final_week: { similar: 5, cold: 10, warm: 35, hot: 50 },
};

/** The split in force: RF3's, or the two-campaign proposal once it's on. */
export function splitOf(stretch: FunnelStretch, twoCampaigns = false, similarSkipped = false): Record<FunnelTier, number> {
  if (!twoCampaigns) return RF3[stretch].split;
  const split = SPLIT_WITH_SIMILAR[stretch];
  // Matas, 26 Nov: with no Similar tier, "Similar's share goes to Cold for that stretch"; Warm and Hot keep theirs.
  return similarSkipped ? { ...split, similar: 0, cold: split.cold + split.similar } : split;
}

/** Why a two-campaign show runs without Similar this stretch. */
export type SimilarSkip = "no_genre" | "no_group" | "too_small";

/** The show's Similar tier for this read: null when it runs; else why not (no genre, no confirmed group, or Meta sized its audience under the minimum). */
export function similarSkipOf(opts: Pick<SpecOptions, "twoCampaigns" | "pageGroup" | "genreFamily" | "similarTooSmall">): SimilarSkip | null {
  if (!opts.twoCampaigns) return null;
  if (!opts.genreFamily && !opts.pageGroup) return "no_genre";
  if (!opts.pageGroup?.confirmed || !opts.pageGroup.pageIds.length && !opts.pageGroup.igIds.length) return "no_group";
  if (opts.similarTooSmall) return "too_small";
  return null;
}

export const STRETCH_KEY: Record<FunnelStretch, RfKey> = {
  announce: "rt.stretch.announce",
  normally: "rt.stretch.normally",
  payday: "rt.stretch.payday",
  final_month: "rt.stretch.final_month",
  final_2w: "rt.stretch.final_2w",
  final_week: "rt.stretch.final_week",
};

export function stretchName(stretch: FunnelStretch): string {
  return fill(STRETCH_KEY[stretch]);
}

/** Days out each run-in stretch starts (RT11's, kept). */
export const RUN_IN_DAYS: Record<"final_month" | "final_2w" | "final_week", number> = { final_month: 30, final_2w: 14, final_week: 7 };

/** READING: announce is the first 14 days from the announcement (else the first on-sale day). */
export const ANNOUNCE_DAYS = 14;

export type StretchDates = { showDay: string; announceDay: string | null };

/** The stretch a London day is in. Overlaps take the higher share; at a tie the run-in stretch names it. */
export function stretchOn(day: string, dates: StretchDates): FunnelStretch {
  const inAnnounce = dates.announceDay != null && day >= dates.announceDay && day < addDaysIso(dates.announceDay, ANNOUNCE_DAYS);
  // RF3: payday weeks come round inside "normally" (RT6's window), not during announce.
  const base: FunnelStretch = inAnnounce ? "announce" : isInPaydayWindow(day) ? "payday" : "normally";
  let runIn: FunnelStretch | null = null;
  if (day <= dates.showDay) {
    for (const stretch of ["final_week", "final_2w", "final_month"] as const) {
      if (day >= addDaysIso(dates.showDay, -RUN_IN_DAYS[stretch])) {
        runIn = stretch;
        break;
      }
    }
  }
  if (!runIn) return base;
  return RF3[runIn].share >= RF3[base].share ? runIn : base;
}

const sameRule = (a: FunnelStretch, b: FunnelStretch) => RF3[a].share === RF3[b].share && FUNNEL_TIERS.every((tier) => RF3[a].split[tier] === RF3[b].split[tier]);

export type StretchStep = { day: string; stretch: FunnelStretch };

/**
 * RF3's steps after `day` to the show day: each day the share or split
 * changes (payday week into final month, same rule, is no step).
 */
export function stepsAfter(day: string, dates: StretchDates): StretchStep[] {
  const steps: StretchStep[] = [];
  let current = stretchOn(day, dates);
  for (let d = addDaysIso(day, 1); d <= dates.showDay; d = addDaysIso(d, 1)) {
    const next = stretchOn(d, dates);
    if (!sameRule(next, current)) steps.push({ day: d, stretch: next });
    current = next;
  }
  return steps;
}

// ─── RF3 + RF8: the split ───────────────────────────────────────────────────

export type TierMinor = Record<FunnelTier, number>;

export type Split = { tiers: TierMinor; atFloor: FunnelTier[] };

/**
 * The split of a total by a stretch's percentages, to the penny (the odd
 * pennies to the tier with the largest percentage, the hotter at a tie),
 * then RF8: a tier under the floor is lifted to it, the difference taken
 * from the largest other tier. Only `buildable` tiers get money; a tier with
 * nothing to build passes its percentage to the others pro rata. Null when
 * the total can't give every buildable tier its floor.
 */
export function splitTotal(totalMinor: number, split: Record<FunnelTier, number>, opts: { floorMinor?: number; buildable?: readonly FunnelTier[] } = {}): Split | null {
  const floor = opts.floorMinor ?? FLOOR_MINOR;
  const tiers = (opts.buildable ?? FUNNEL_TIERS).filter((tier) => FUNNEL_TIERS.includes(tier) && split[tier] > 0);
  if (!tiers.length || totalMinor < floor * tiers.length) return null;
  const weight = tiers.reduce((sum, tier) => sum + split[tier], 0);
  const out: TierMinor = NO_TIERS();
  for (const tier of tiers) out[tier] = Math.floor((totalMinor * split[tier]) / weight + 1e-9);
  const order = [...tiers].sort((a, b) => split[b] - split[a] || FUNNEL_TIERS.indexOf(b) - FUNNEL_TIERS.indexOf(a));
  let odd = totalMinor - tiers.reduce((sum, tier) => sum + out[tier], 0);
  for (let i = 0; odd > 0; i = (i + 1) % order.length, odd -= 1) out[order[i]!] += 1;
  const atFloor: FunnelTier[] = [];
  for (const tier of FUNNEL_TIERS) {
    if (!tiers.includes(tier) || out[tier] >= floor) continue;
    const need = floor - out[tier];
    const giver = tiers.filter((other) => other !== tier && !atFloor.includes(other)).sort((a, b) => out[b] - out[a] || FUNNEL_TIERS.indexOf(b) - FUNNEL_TIERS.indexOf(a))[0];
    if (!giver || out[giver] - need < floor) return null;
    out[giver] -= need;
    out[tier] = floor;
    atFloor.push(tier);
  }
  return { tiers: out, atFloor };
}

// ─── RF4: where the money comes from ────────────────────────────────────────

/** One prospecting budget: an ad set's daily budget, or a campaign's (which feeds `adSets` ad sets). */
export type ProspectingBudget = { id: string; kind: "adset" | "campaign"; name: string; dailyMinor: number; adSets: number; campaignId?: string | null };

export type TakeLine = { id: string; kind: "adset" | "campaign"; name: string; beforeMinor: number; afterMinor: number; campaignId?: string | null };

export type Take = { neededMinor: number; takenMinor: number; from: TakeLine[]; short: boolean };

/** What one budget can give and still keep £1.00 an ad set. */
export function canGive(budget: ProspectingBudget, floorMinor = FLOOR_MINOR): number {
  const keep = floorMinor * (budget.kind === "campaign" ? Math.max(1, budget.adSets) : 1);
  return Math.max(0, budget.dailyMinor - keep);
}

/** Largest first, each budget down to its floor before the next (RF-A's frames). */
export function takeFromProspecting(budgets: readonly ProspectingBudget[], neededMinor: number, floorMinor = FLOOR_MINOR): Take {
  const sorted = [...budgets].filter((row) => row.dailyMinor > 0).sort((a, b) => b.dailyMinor - a.dailyMinor || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const from: TakeLine[] = [];
  let left = Math.max(0, neededMinor);
  for (const budget of sorted) {
    if (left <= 0) break;
    const give = Math.min(left, canGive(budget, floorMinor));
    if (give <= 0) continue;
    from.push({ id: budget.id, kind: budget.kind, name: budget.name, beforeMinor: budget.dailyMinor, afterMinor: budget.dailyMinor - give, campaignId: budget.campaignId ?? null });
    left -= give;
  }
  const takenMinor = Math.max(0, neededMinor) - left;
  return { neededMinor: Math.max(0, neededMinor), takenMinor, from, short: left > 0 };
}

/** The prospecting budgets after a take. */
export function afterTake(budgets: readonly ProspectingBudget[], take: Take): ProspectingBudget[] {
  return budgets.map((budget) => {
    const line = take.from.find((row) => row.id === budget.id);
    return line ? { ...budget, dailyMinor: line.afterMinor } : budget;
  });
}

// ─── RF5: the frequency ceiling ─────────────────────────────────────────────

export const FREQUENCY_CEILING = 3;
export const FREQUENCY_DAYS = 7;

export type TierWeek = { frequency: number | null; spendMinor: number };

export type TierCap = { capMinor: number; frequency: number; extraMinor: number; to: FunnelTier | "prospecting"; back?: { id: string; name: string; minor: number }[] };

export type CapResult = {
  /** What each tier runs at after the caps. */
  budgets: TierMinor;
  caps: Partial<Record<FunnelTier, TierCap>>;
  /** A warmer tier's capped extra that came to this tier. */
  plus: Partial<Record<FunnelTier, { from: FunnelTier; minor: number }[]>>;
  /** Back to prospecting, by budget (Cold's extra). */
  back: { id: string; name: string; minor: number }[];
};

/**
 * RF5: Hot first, then Warm, then Cold. A tier over the ceiling runs at its
 * 7-day average spend a day (never under the floor); the rest of what it
 * has (its share and anything a hotter tier passed it) goes colder, and
 * the coldest built tier's (Cold; Similar under the two-campaign record,
 * READING) goes back to the prospecting budgets it came from, in the order
 * they gave, up to what each gave. At 3 or under it runs at its share.
 */
export function capTiers(shares: TierMinor, week: Partial<Record<FunnelTier, TierWeek>>, took: readonly TakeLine[], floorMinor = FLOOR_MINOR): CapResult {
  const budgets: TierMinor = { ...shares };
  const caps: CapResult["caps"] = {};
  const plus: CapResult["plus"] = {};
  let incoming = 0;
  let incomingFrom: FunnelTier | null = null;
  const back: CapResult["back"] = [];
  // Hottest first; a tier with no share isn't built, so nothing passes to it. The coldest built tier gives back to prospecting.
  const built = [...FUNNEL_TIERS].reverse().filter((tier) => shares[tier] > 0);
  for (const [index, tier] of built.entries()) {
    if (incoming > 0 && incomingFrom) {
      budgets[tier] += incoming;
      (plus[tier] ??= []).push({ from: incomingFrom, minor: incoming });
    }
    incoming = 0;
    incomingFrom = null;
    const row = week[tier];
    if (!row || row.frequency == null || !(row.frequency > FREQUENCY_CEILING) || budgets[tier] <= 0) continue;
    const cap = Math.max(floorMinor, Math.floor(row.spendMinor / FREQUENCY_DAYS));
    if (cap >= budgets[tier]) continue;
    const extra = budgets[tier] - cap;
    budgets[tier] = cap;
    const colder = built[index + 1];
    if (!colder) {
      let left = extra;
      for (const line of took) {
        if (left <= 0) break;
        const minor = Math.min(left, line.beforeMinor - line.afterMinor);
        if (minor > 0) back.push({ id: line.id, name: line.name, minor });
        left -= minor;
      }
      // Nothing was taken (a hand-built show): the extra simply isn't spent.
      caps[tier] = { capMinor: cap, frequency: row.frequency, extraMinor: extra, to: "prospecting", back: [...back] };
    } else {
      caps[tier] = { capMinor: cap, frequency: row.frequency, extraMinor: extra, to: colder };
      incoming = extra;
      incomingFrom = tier;
    }
  }
  return { budgets, caps, plus, back };
}

// ─── RF2 + RF6: the sources ─────────────────────────────────────────────────

export type FunnelAccount = {
  /** The Facebook Page id (both platforms: Meta's IG engagement rules take the Page). */
  pageId: string;
  /** The Instagram business account, for an Instagram account. */
  igId?: string | null;
  name: string;
  platform: "facebook" | "instagram";
  kind: "promoter" | "lineup" | "venue" | "event";
  /** Advertiser access held; null when it wasn't read (Apply checks again). */
  access: boolean | null;
};

export type FunnelSources = {
  pixelId: string | null;
  links: ShowLink[];
  accounts: FunnelAccount[];
  /** Every video of the show's ads, by the Page it ran from. */
  videos: { pageId: string; videoIds: string[] }[];
  lists: SourceList[];
};

export const PLATFORM_LABEL: Record<FunnelAccount["platform"], string> = { facebook: "Facebook", instagram: "Instagram" };

/** RF2 / RF6: the accounts every account-based source uses (access held or not read), one per page and platform. */
export function usableAccounts(accounts: readonly FunnelAccount[]): FunnelAccount[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = `${account.platform}:${account.pageId}`;
    if (account.access === false || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** RF6: the accounts without advertiser access, named once each. */
export function missingAccess(accounts: readonly FunnelAccount[]): FunnelAccount[] {
  const seen = new Set<string>();
  return accounts.filter((account) => {
    const key = `${account.platform}:${account.pageId}`;
    if (account.access !== false || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type FunnelSource = "video75" | "engaged" | "followers" | "visitors" | "video95" | "ticket" | "checkout" | "registrations" | "signups" | "similar" | "similar_pages";

/** One window per source (RF2). READING: Hot's checkout starters 30 days, registrations 180 (RT's longest of each). */
export const RF2_WINDOWS = {
  video75: 180,
  engagedCold: 180,
  visitors: 60,
  engagedWarm: 60,
  video95: 60,
  ticket: 30,
  checkout: 30,
  registrations: 180,
  engagedHot: 30,
} as const;

/** One audience a tier uses. `key` is stable for the same sources, so a re-run reuses what it made. */
export type FunnelAudience =
  | { key: string; source: FunnelSource; kind: "pixel_url"; pixelId: string; urlContains: string[]; retentionDays: number }
  | { key: string; source: FunnelSource; kind: "pixel_event"; pixelId: string; pixelEvent: "InitiateCheckout" | "CompleteRegistration"; urlContains: string[]; retentionDays: number }
  | { key: string; source: FunnelSource; kind: "video"; pageId: string; videoIds: string[]; threshold: 75 | 95; retentionDays: number }
  | { key: string; source: FunnelSource; kind: "page_fb" | "page_ig"; pageIds: string[]; retentionDays: number }
  | { key: string; source: FunnelSource; kind: "followers_fb" | "followers_ig"; pageIds: string[] }
  | { key: string; source: FunnelSource; kind: "list"; metaAudienceId: string; role: SourceList["role"] };

export type FunnelSpec = { tier: FunnelTier; includes: FunnelAudience[]; excludes: FunnelAudience[] };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const idsKey = (ids: readonly string[]) => linkKey([...ids].sort().join(","));

function accountAudiences(sources: FunnelSources, source: "engaged" | "followers", days: number | null): FunnelAudience[] {
  const accounts = usableAccounts(sources.accounts);
  const fb = accounts.filter((row) => row.platform === "facebook").map((row) => row.pageId);
  // An Instagram rule takes the account's own id (#1400's ig_engagers / ig_followers specs); the Page id only when it isn't known.
  const ig = accounts.filter((row) => row.platform === "instagram").map((row) => row.igId ?? row.pageId);
  const out: FunnelAudience[] = [];
  for (const [platform, ids] of [["fb", fb], ["ig", ig]] as const) {
    for (const part of chunk(ids, RT2.pagesPerAudience)) {
      if (source === "engaged") out.push({ key: `rf:engaged_${platform}:${days}:${idsKey(part)}`, source, kind: platform === "fb" ? "page_fb" : "page_ig", pageIds: part, retentionDays: days! });
      else out.push({ key: `rf:followers_${platform}:${idsKey(part)}`, source, kind: platform === "fb" ? "followers_fb" : "followers_ig", pageIds: part });
    }
  }
  return out;
}

function videoAudiences(sources: FunnelSources, threshold: 75 | 95, days: number): FunnelAudience[] {
  const allowed = new Set(usableAccounts(sources.accounts).map((row) => row.pageId));
  const out: FunnelAudience[] = [];
  for (const group of sources.videos) {
    if (!allowed.has(group.pageId) || !group.videoIds.length) continue;
    for (const part of chunk(group.videoIds, RT2.videosPerAudience)) {
      out.push({ key: `rf:video${threshold}:${days}:${group.pageId}:${idsKey(part)}`, source: threshold === 75 ? "video75" : "video95", kind: "video", pageId: group.pageId, videoIds: part, threshold, retentionDays: days });
    }
  }
  return out;
}

/**
 * A genre page group (page_groups, migration 275): pages the client's
 * business can build engagement audiences from, in the show's genre.
 * Unconfirmed groups aren't used (Matas confirms each).
 */
export type PageGroup = { id: string; genreFamily: string; pageIds: string[]; igIds: string[]; confirmed: boolean };

export type SpecOptions = {
  /** Staged two-campaign record: the Similar tier, Similar lists in Warm. */
  twoCampaigns?: boolean;
  /** The show's genre page group (two campaigns only); null = no genre or no confirmed group, so no Similar tier. */
  pageGroup?: PageGroup | null;
  /** Staged: before on-sale, "converted" is a registration (CompleteRegistration on the sign-up links). */
  presale?: boolean;
  /** The show's events.genre_family (null = no genre: Similar's skip reason). */
  genreFamily?: string | null;
  /** Meta sized the group's engagement audience under its minimum (a stored audience read as too small). */
  similarTooSmall?: boolean;
};

/** Matas, 27 Nov: Similar's lookback is 365 days (not 180); Cold, Warm and Hot keep theirs. */
export const SIMILAR_ENGAGED_DAYS = 365;

/** The Similar tier's audiences: engagers of the group's pages, ≤ 5 pages an audience, Facebook and Instagram. */
export function similarAudiences(group: PageGroup | null | undefined): FunnelAudience[] {
  if (!group?.confirmed || !group.pageIds.length) return [];
  const out: FunnelAudience[] = [];
  for (const part of chunk(group.pageIds, RT2.pagesPerAudience)) {
    out.push({ key: `rf:similar_fb:${SIMILAR_ENGAGED_DAYS}:${idsKey(part)}`, source: "similar_pages", kind: "page_fb", pageIds: part, retentionDays: SIMILAR_ENGAGED_DAYS });
  }
  // Instagram: the accounts' own ids (#1400's ig_engagers spec).
  for (const part of chunk(group.igIds, RT2.pagesPerAudience)) {
    out.push({ key: `rf:similar_ig:${SIMILAR_ENGAGED_DAYS}:${idsKey(part)}`, source: "similar_pages", kind: "page_ig", pageIds: part, retentionDays: SIMILAR_ENGAGED_DAYS });
  }
  return out;
}

/** Presale: registrants (the registrations on the sign-up links and the signup lists), left out of every tier and listed for the reminder. */
export function presaleRegistrants(sources: FunnelSources): FunnelAudience[] {
  const landing = landingLinks(sources.links).map((link) => link.rule);
  const out: FunnelAudience[] = [];
  if (sources.pixelId && landing.length) out.push({ key: `rf:registrations:${RF2_WINDOWS.registrations}`, source: "registrations", kind: "pixel_event", pixelId: sources.pixelId, pixelEvent: "CompleteRegistration", urlContains: landing, retentionDays: RF2_WINDOWS.registrations });
  for (const list of sources.lists) if (list.role === "signups") out.push({ key: `list:${list.metaAudienceId}`, source: "signups", kind: "list", metaAudienceId: list.metaAudienceId, role: "signups" });
  return out;
}

/**
 * RF2's tiers, each with its includes and leave-outs. A tier with no
 * include is left out. Staged (scratch/retargeting-two-campaigns-2026-11-26.md):
 * `twoCampaigns` adds Similar (the genre group's engagers, minus Cold) and
 * moves Similar lists from Hot to Warm; `presale` makes Hot the sign-up
 * page's visitors and leaves registrants out of every tier.
 */
export function funnelSpecs(sources: FunnelSources, opts: SpecOptions = {}): FunnelSpec[] {
  const similar: FunnelAudience[] = opts.twoCampaigns && !similarSkipOf(opts) ? similarAudiences(opts.pageGroup) : [];
  const cold: FunnelAudience[] = [...videoAudiences(sources, 75, RF2_WINDOWS.video75), ...accountAudiences(sources, "engaged", RF2_WINDOWS.engagedCold), ...accountAudiences(sources, "followers", null)];
  const warm: FunnelAudience[] = [];
  const hot: FunnelAudience[] = [];
  const tickets = ticketLinks(sources.links).map((link) => link.rule);
  const landing = landingLinks(sources.links).map((link) => link.rule);
  const registrants = opts.presale ? presaleRegistrants(sources) : [];
  if (sources.pixelId) {
    const pixelId = sources.pixelId;
    if (opts.presale) {
      // Hot: visited the sign-up page and didn't register (registrants are left out below).
      if (landing.length) hot.push({ key: `rf:signup_visitors:${RF2_WINDOWS.ticket}`, source: "visitors", kind: "pixel_url", pixelId, urlContains: landing, retentionDays: RF2_WINDOWS.ticket });
      // TC7: Warm's visitors are show page visitors (no ticket link yet), 60 days.
      if (landing.length) warm.push({ key: `rf:show_visitors:${RF2_WINDOWS.visitors}`, source: "visitors", kind: "pixel_url", pixelId, urlContains: landing, retentionDays: RF2_WINDOWS.visitors });
    } else {
      const both = [...landing, ...tickets];
      if (both.length) warm.push({ key: `rf:visitors:${RF2_WINDOWS.visitors}`, source: "visitors", kind: "pixel_url", pixelId, urlContains: both, retentionDays: RF2_WINDOWS.visitors });
      if (tickets.length) {
        hot.push({ key: `rf:ticket:${RF2_WINDOWS.ticket}`, source: "ticket", kind: "pixel_url", pixelId, urlContains: tickets, retentionDays: RF2_WINDOWS.ticket });
        hot.push({ key: `rf:checkout:${RF2_WINDOWS.checkout}`, source: "checkout", kind: "pixel_event", pixelId, pixelEvent: "InitiateCheckout", urlContains: tickets, retentionDays: RF2_WINDOWS.checkout });
      }
      // On going on sale, registrants move into Hot.
      if (landing.length) hot.push({ key: `rf:registrations:${RF2_WINDOWS.registrations}`, source: "registrations", kind: "pixel_event", pixelId, pixelEvent: "CompleteRegistration", urlContains: landing, retentionDays: RF2_WINDOWS.registrations });
    }
  }
  warm.push(...accountAudiences(sources, "engaged", RF2_WINDOWS.engagedWarm), ...videoAudiences(sources, 95, RF2_WINDOWS.video95));
  if (!opts.presale) {
    for (const list of sources.lists) {
      if (list.role === "signups") hot.push({ key: `list:${list.metaAudienceId}`, source: "signups", kind: "list", metaAudienceId: list.metaAudienceId, role: "signups" });
    }
  }
  hot.push(...accountAudiences(sources, "engaged", RF2_WINDOWS.engagedHot));
  for (const list of sources.lists) {
    if (list.role !== "similar") continue;
    // Staged record item 3: Similar lists go in Warm (RF2 had them in Hot).
    (opts.twoCampaigns ? warm : hot).push({ key: `list:${list.metaAudienceId}`, source: "similar", kind: "list", metaAudienceId: list.metaAudienceId, role: "similar" });
  }
  const buyers: FunnelAudience[] = sources.lists.filter((list) => list.role === "buyers").map((list) => ({ key: `list:${list.metaAudienceId}`, source: "signups", kind: "list", metaAudienceId: list.metaAudienceId, role: "buyers" }));
  const byTier: Record<FunnelTier, FunnelAudience[]> = { similar, cold, warm, hot };
  const specs: FunnelSpec[] = [];
  FUNNEL_TIERS.forEach((tier, index) => {
    if (!byTier[tier].length) return;
    const right = FUNNEL_TIERS.slice(index + 1).flatMap((other) => byTier[other]);
    specs.push({ tier, includes: byTier[tier], excludes: dedupe([...right, ...buyers, ...registrants]) });
  });
  return specs;
}

/**
 * Staged: Buyers (upsell), only when the show has upsells. Outside the
 * share; its budget isn't ruled, so it isn't built yet.
 */
export function upsellSpec(sources: FunnelSources, hasUpsells: boolean): FunnelSpec | null {
  if (!hasUpsells) return null;
  const buyers: FunnelAudience[] = sources.lists.filter((list) => list.role === "buyers").map((list) => ({ key: `list:${list.metaAudienceId}`, source: "signups", kind: "list", metaAudienceId: list.metaAudienceId, role: "buyers" }));
  return buyers.length ? { tier: "hot", includes: buyers, excludes: [] } : null;
}

function dedupe(audiences: readonly FunnelAudience[]): FunnelAudience[] {
  const seen = new Set<string>();
  return audiences.filter((aud) => (seen.has(aud.key) ? false : (seen.add(aud.key), true)));
}

/** The tier a person lands in from the audiences they're in: at most one ever matches (the Acceptance test). */
export function funnelTiersMatching(specs: readonly FunnelSpec[], memberOf: ReadonlySet<string>): FunnelTier[] {
  return specs.filter((spec) => spec.includes.some((aud) => memberOf.has(aud.key)) && !spec.excludes.some((aud) => memberOf.has(aud.key))).map((spec) => spec.tier);
}

/** Every audience the specs use that the builder makes (lists are used as uploaded). */
export function audiencesToMake(specs: readonly FunnelSpec[]): Exclude<FunnelAudience, { kind: "list" }>[] {
  const seen = new Set<string>();
  const out: Exclude<FunnelAudience, { kind: "list" }>[] = [];
  for (const spec of specs) for (const aud of [...spec.includes, ...spec.excludes]) {
    if (aud.kind === "list" || seen.has(aud.key)) continue;
    seen.add(aud.key);
    out.push(aud);
  }
  return out;
}

const SOURCE_ROW: Record<Exclude<FunnelSource, "engaged" | "similar" | "signups" | "similar_pages">, RfKey> = {
  video75: "rt.src.video75",
  followers: "rt.src.followers",
  visitors: "rt.src.visitors60",
  video95: "rt.src.video95",
  ticket: "rt.src.ticket30",
  checkout: "rt.src.checkout",
  registrations: "rt.src.signups",
};

/**
 * RF2 / TC4 / TC7 / TC9: each audience row of a tier, the source and its
 * window. TC9: the per-source "· {n} accounts" goes; whose Pages the account
 * sources come from is one muted line (tierFromLine). Registrations and the
 * signup list are one row; similar lists end Warm's row (TC4).
 */
export function tierAudienceLines(spec: FunnelSpec | undefined, opts: { presale?: boolean; genreLabel?: string | null } = {}): string[] {
  if (!spec) return [];
  const lines: string[] = [];
  const has = (source: FunnelSource) => spec.includes.some((aud) => aud.source === source);
  const engagedDays = spec.tier === "cold" ? RF2_WINDOWS.engagedCold : spec.tier === "warm" ? RF2_WINDOWS.engagedWarm : RF2_WINDOWS.engagedHot;
  const similarLists = spec.includes.filter((aud) => aud.source === "similar").length;
  const listsLine = () => fill(similarLists === 1 ? "rt.src.similar.one" : "rt.src.similar", { n: similarLists });
  if (spec.tier === "similar") {
    const group = spec.includes.filter((aud) => aud.source === "similar_pages");
    const pages = new Set(group.flatMap((aud) => (aud.kind === "page_fb" ? aud.pageIds : []))).size;
    const head = fill("rt.src.page_group", { genre: opts.genreLabel ?? "", n: pages });
    lines.push(group.length > 1 ? `${head}${JOIN}${fill("rt.src.page_group.audiences", { n: group.length })}` : head);
  } else if (spec.tier === "cold") {
    if (has("video75")) lines.push(fill(SOURCE_ROW.video75));
    if (has("engaged")) lines.push(fill("rt.src.engaged", { n: engagedDays }));
    if (has("followers")) lines.push(fill(SOURCE_ROW.followers));
  } else if (spec.tier === "warm") {
    if (has("visitors")) lines.push(fill(opts.presale ? "rt.src.show_visitors60" : SOURCE_ROW.visitors));
    if (has("engaged")) lines.push(fill("rt.src.engaged", { n: engagedDays }));
    if (has("video95")) lines.push(fill(SOURCE_ROW.video95));
    if (similarLists) lines.push(listsLine());
  } else {
    if (opts.presale) {
      if (has("visitors")) lines.push(fill("rt.src.signup_visitors"));
    } else {
      if (has("ticket")) lines.push(fill(SOURCE_ROW.ticket));
      if (has("checkout")) lines.push(fill(SOURCE_ROW.checkout));
      if (has("registrations") || has("signups")) lines.push(fill(SOURCE_ROW.registrations));
    }
    if (has("engaged")) lines.push(fill("rt.src.engaged", { n: engagedDays }));
    if (similarLists) lines.push(listsLine());
  }
  return lines;
}

/** TC9: the tier's muted last line — whose Pages and accounts its account sources use — or null with none. */
export function tierFromLine(spec: FunnelSpec | undefined, sources: FunnelSources): string | null {
  if (!spec?.includes.some((aud) => aud.source === "video75" || aud.source === "video95" || aud.source === "engaged" || aud.source === "followers")) return null;
  const n = usableAccounts(sources.accounts).length;
  return n === 1 ? fill("rt.src.from.one") : fill("rt.src.from", { n });
}

const LEAVES_ROW: Record<FunnelTier, RfKey> = { similar: "rt.leaves.similar", cold: "rt.leaves.cold", warm: "rt.leaves.warm", hot: "rt.leaves.hot" };
const LEAVES_PRESALE_ROW: Record<FunnelTier, RfKey> = { similar: "rt.leaves.similar.presale", cold: "rt.leaves.cold.presale", warm: "rt.leaves.warm.presale", hot: "rt.leaves.hot.presale" };

/** TC2 / TC7: a tier's Leaves out; presale reads "signed up" for buyers. */
export function leavesOutText(tier: FunnelTier, presale = false): string {
  return fill((presale ? LEAVES_PRESALE_ROW : LEAVES_ROW)[tier]);
}

/** RF6's one line, under the share line, with its one-form. Null when nothing is missing. */
export function accessLine(accounts: readonly FunnelAccount[]): string | null {
  const missing = missingAccess(accounts);
  if (!missing.length) return null;
  const names = missing.map((row) => fill("rt.access.name", { account: row.name, platform: PLATFORM_LABEL[row.platform] }));
  if (names.length === 1) return fill("rt.access.missing.one", { name: names[0]! });
  return fill("rt.access.missing", { n: names.length, names: names.join(JOIN) });
}

/** RF9's names for Claude ("MC Fenn (Instagram) · Dawn Ray (Facebook)"). */
export function accessNames(accounts: readonly FunnelAccount[]): string {
  return missingAccess(accounts).map((row) => fill("rt.access.name", { account: row.name, platform: PLATFORM_LABEL[row.platform] })).join(JOIN);
}

/** "{name} £{a} → £{b}", joined. */
export function takeFromText(from: readonly TakeLine[]): string {
  return from.map((row) => fill("rt.take.from", { name: row.name, a: money(row.beforeMinor), b: money(row.afterMinor) })).join(JOIN);
}

export { money, rfDay, freqText };
