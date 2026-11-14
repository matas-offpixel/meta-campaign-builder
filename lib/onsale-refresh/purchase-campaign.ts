/**
 * P4, PR A: the Purchase campaign line (docs/design-record/2026-11-14-purchase-campaigns.html,
 * PC1, PC2 and HP1). Pure: it reads what the run already has (the event's
 * ad-days, its convert scores, the purchase read, and the budgets the
 * purchase read fetched from Meta) and returns PC1's state and PC2's card.
 * Nothing here writes. The create write is PR B's (HP3).
 *
 * PC1, in order:
 *   1. the signal: the purchase line's state is Proposed (E2 or T2);
 *   2. no Purchase campaign yet: no campaign of the event delivered in the
 *      14 days on OFFSITE_CONVERSIONS with the promoted event PURCHASE
 *      (ad_daily_insights, migration 187). One that did makes it "running";
 *   3. a main campaign to copy: a delivering IC or LPV campaign with two
 *      ad sets PC3 can pick (5 results, or 5 purchases, in the 14 days);
 *   4. time to learn: 14 days from the run day to the show, both included;
 *   5. money to start it: £5 a day to the show fits PC3's cap, and the
 *      main campaign keeps its floor.
 */

import type { PurchaseRead } from "./purchases.ts";
import { addDaysIso, dayMonth, shortDay } from "./schedule.ts";

export const PC = {
  /** PC1 step 3 / PC3: a pick needs this many results, or this many purchases, in the 14 days. */
  pickMin: 5,
  /** PC1 step 4: the campaign would run at least this many days, both ends included. */
  minDays: 14,
  /** PC3: the daily rates, high first. */
  rates: [10, 5] as const,
  /** R5 / PC3: the cap, a share of the remaining plan or of what the main campaign has left. */
  capShare: 0.2,
  /** PC3: the main campaign keeps its spend to date plus this many days at its last-7-day daily spend. */
  floorDays: 3,
  /** PC3: two picks plus retargeting. */
  maxAdSets: 3,
  /** PC3: reused ads. */
  maxAds: 6,
} as const;

export const RETARGETING_NAME = /retarget/i;

export type PcResult = "initiate_checkout" | "landing_page_view";

export type PcAdSet = {
  adsetId: string;
  adsetIds: string[];
  name: string;
  /** The 14 days (the later of the window's 14-day start and the on-sale date, to the window's end). */
  spend: number;
  results: number;
  /** Purchases credited on the resolved pixel (T3); 0 on an ad set whose pixel isn't it. */
  purchases: number;
  delivering: boolean;
};

export type PcAd = { adId: string; adsetId: string; name: string; convertScore: number | null; deliveringNow: boolean };

export type PcMain = {
  campaignKey: string;
  /** The id carrying its latest spend: its budget and spend to date are this id's. */
  campaignId: string | null;
  resultEvent: PcResult;
  from: string;
  to: string;
  spend: number;
  results: number;
  purchases: number;
  adSets: PcAdSet[];
  ads: PcAd[];
  /** All its spend, to the window's end. */
  spentToDate: number;
  /** Its spend over the window's 7 days, per day. */
  last7Daily: number;
  /** Its campaign lifetime budget (CBO), £; null when it has none or it wasn't read. */
  lifetimeGbp: number | null;
  draftId: string | null;
  adAccountId: string | null;
};

export type PcInput = {
  eventCode: string | null;
  eventName: string;
  /** The run's day: PC1 counts from it, and the card's Apply date is it. */
  runDay: string;
  eventDate: string | null;
  read: PurchaseRead | undefined;
  /** A campaign of the event that delivered on Purchase in the 14 days (step 2). */
  existing: string | null;
  main: PcMain | null;
  budgetGbp: number | null;
  spendToDateGbp: number;
  /** What every live campaign of the event still has committed, £; null when a budget couldn't be read. */
  committedGbp: number | null;
};

export type PcState = "not_proposed" | "running" | "nothing_to_copy" | "too_close" | "no_money" | "proposed";

export type PcPick = {
  role: "purchase" | "checkout" | "both" | "retargeting";
  adsetId: string;
  adsetIds: string[];
  name: string;
  spend: number;
  results: number;
  purchases: number;
};

export type PcFunding = {
  rate: number;
  lifetime: number;
  headroom: number;
  move: number;
  mainBefore: number | null;
  mainAfter: number | null;
  fitsCap: boolean;
  keepsFloor: boolean;
  fits: boolean;
};

/** PC2's card, every string ready to draw. The panel shows it as written (names keep their digits). */
export type PurchaseCard = {
  campaignName: string;
  mainCampaignKey: string;
  mainShort: string;
  path: "platform" | "own_domain";
  header: string;
  headerNarrow: string;
  optimises: string;
  optimisesNarrow: string;
  picksHeading: string;
  pickLines: { label: string; text: string; aside: string }[];
  /** "No ad set has 5 purchases, so both are picked on cost per checkout", or null. */
  picksNote: string | null;
  retargetingLine: string;
  adsHeading: string;
  adsLine: string;
  /** The rates on offer, high first; `fits` false reads "over the cap" and can't be picked. */
  rates: { rate: number; label: string; labelNarrow: string; fits: boolean }[];
  defaultRate: number;
  /** Why £10 isn't offered, under the choice; null when it is. */
  rateNote: string | null;
  /** Per rate that fits: the lifetime sentence, the writes, the 393 budget clause. */
  byRate: Record<string, { budget: string; writes: string; narrow: string; lifetime: number; headroom: number; move: number; mainBefore: number | null; mainAfter: number | null }>;
  note: string | null;
  noteNarrow: string | null;
  /** Accept is held: no ad to reuse. Null when it can be accepted. */
  held: string | null;
};

export type PurchaseCampaignPlan = {
  state: PcState;
  /** PC1's second sentence (too close / nothing to copy / no money); null otherwise. */
  sentence: string | null;
  sentenceNarrow: string | null;
  card: PurchaseCard | null;
  /** For the line and for PR B: what Accept would build. Null unless proposed. */
  build: PurchaseBuild | null;
};

export type PurchaseBuild = {
  campaignName: string;
  path: "platform" | "own_domain";
  pixelId: string;
  customConversion: { name: string; domain: string } | null;
  mainCampaignKey: string;
  mainCampaignId: string | null;
  /** PR B rechecks these at apply time: the main campaign's lifetime (£), spend to date and last-7-day daily spend when proposed. */
  mainLifetimeGbp: number | null;
  mainSpentToDate: number;
  mainLast7Daily: number;
  mainShort: string;
  draftId: string | null;
  adAccountId: string | null;
  picks: PcPick[];
  noPurchasePick: boolean;
  ads: { adId: string; name: string; convertScore: number }[];
  days: number;
  startDay: string;
  endDay: string;
  cap: number;
  capOf: "plan" | "main";
  floor: number;
  funding: PcFunding[];
  defaultRate: number;
};

// ── Figures ──────────────────────────────────────────────────────────────────

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** £130, £1,370, £272.41, £35.33: whole pounds drop the pence. */
export function money(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return `£${group(String(rounded))}`;
  const [int, frac] = rounded.toFixed(2).split(".");
  return `£${group(int!)}.${frac}`;
}

/** Always with pence: £27.22 each, £1.44 each. */
function each(value: number): string {
  const [int, frac] = (Math.round(value * 100) / 100).toFixed(2).split(".");
  return `£${group(int!)}.${frac}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round2 = (value: number) => Math.round(value * 100) / 100;

/** Days from `from` to `to`, both included. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

/** "[NX26-LOCKLEAD] On Sale" → "On Sale"; "261204 Kream | [EBR26-KREAM] KREAM - On Sale" → "KREAM - On Sale". */
export function shortCampaign(key: string): string {
  const at = key.lastIndexOf("] ");
  return at >= 0 ? key.slice(at + 2).trim() || key : key;
}

const RESULT_SHORT: Record<PcResult, string> = { initiate_checkout: "IC", landing_page_view: "LPV" };

// ── PC7: the floor ───────────────────────────────────────────────────────────

/** Up to the penny, ignoring float noise (272.41 + 105.99 is 378.40, not 378.41). */
export function ceilPenny(value: number): number {
  return Math.ceil(Math.round(value * 1e6) / 1e4) / 100;
}

export type CampaignFloor = { floor: number; by: "days" | "meta"; spent: number; daily: number };

/**
 * PC7 (docs/design-record/2026-11-14-purchase-campaigns-2.html): a
 * campaign's floor is the larger of its spend to date + 3 days at its
 * last-7-day daily spend, and 1.1 × its spend to date (Meta's minimum for
 * lowering a lifetime budget), rounded up to the penny. The one floor the
 * proposal (PC1, PC2), the apply re-check (PC3 step 5) and Scale Purchase
 * (PC4, both campaigns) use.
 */
export function campaignFloor(spent: number, daily: number): CampaignFloor {
  const days = spent + PC.floorDays * daily;
  const meta = 1.1 * spent;
  return { floor: ceilPenny(Math.max(days, meta)), by: meta > days + 1e-9 ? "meta" : "days", spent, daily };
}

/** PC7's bracket, naming the term that won: "(spent £272.41 + 3 days at £35.33)" or "(Meta's minimum: 1.1 × £2,000.00 spent)". */
export function floorBracket(floor: CampaignFloor): string {
  return floor.by === "meta" ? `(Meta's minimum: 1.1 × ${each(floor.spent)} spent)` : `(spent ${money(floor.spent)} + ${PC.floorDays} days at ${money(floor.daily)})`;
}

/** "{campaign} keeps at least £{f} {bracket}". On the card the floor is to the penny (PC11); PC4's write draws it as money(). */
export function keepsAtLeast(short: string, floor: CampaignFloor, opts: { pence?: boolean } = {}): string {
  return `${short} keeps at least ${opts.pence ? each(floor.floor) : money(floor.floor)} ${floorBracket(floor)}`;
}

// ── PC3's picks ──────────────────────────────────────────────────────────────

const cost = (spend: number, n: number) => (n > 0 ? spend / n : Infinity);
const byCost = (key: (set: PcAdSet) => number) => (a: PcAdSet, b: PcAdSet) => key(a) - key(b) || a.name.localeCompare(b.name);

/**
 * The two picks, tested against each other: the purchase pick (lowest cost
 * per purchase among 5+ purchases) and the checkout pick (lowest cost per
 * result among 5+ results), deduplicated — when one ad set wins both it's
 * "Both picks" and the checkout pick is the next cheapest. With no ad set at
 * 5 purchases, the two cheapest by cost per result. Fewer than two distinct
 * copies: nothing to copy.
 */
export function pickAdSets(adSets: readonly PcAdSet[], purchasesReadable: boolean): { picks: PcPick[]; noPurchasePick: boolean } | null {
  const pool = adSets.filter((set) => set.spend > 0);
  const checkout = pool.filter((set) => set.results >= PC.pickMin).sort(byCost((set) => cost(set.spend, set.results)));
  const purchase = purchasesReadable ? pool.filter((set) => set.purchases >= PC.pickMin).sort(byCost((set) => cost(set.spend, set.purchases))) : [];
  const as = (set: PcAdSet, role: PcPick["role"]): PcPick => ({ role, adsetId: set.adsetId, adsetIds: set.adsetIds, name: set.name, spend: round2(set.spend), results: set.results, purchases: set.purchases });
  if (!purchase.length) {
    if (checkout.length < 2) return null;
    return { picks: [as(checkout[0]!, "checkout"), as(checkout[1]!, "checkout")], noPurchasePick: true };
  }
  const p = purchase[0]!;
  const c = checkout.find((set) => set.name !== p.name);
  if (checkout[0]?.name === p.name) {
    if (!c) return null;
    return { picks: [as(p, "both"), as(c, "checkout")], noPurchasePick: false };
  }
  if (!c) return null;
  return { picks: [as(p, "purchase"), as(c, "checkout")], noPurchasePick: false };
}

/** PC3: up to 6 delivering ads whose convert-axis score is in the campaign's top half, best first; one per creative name. */
export function reusedAds(ads: readonly PcAd[]): { adId: string; name: string; convertScore: number }[] {
  const best = new Map<string, { adId: string; name: string; convertScore: number }>();
  for (const ad of ads) {
    if (!ad.deliveringNow || ad.convertScore == null) continue;
    const have = best.get(ad.name);
    if (!have || ad.convertScore > have.convertScore) best.set(ad.name, { adId: ad.adId, name: ad.name, convertScore: ad.convertScore });
  }
  const ranked = [...best.values()].sort((a, b) => b.convertScore - a.convertScore || a.name.localeCompare(b.name));
  return ranked.slice(0, Math.min(PC.maxAds, Math.ceil(ranked.length / 2)));
}

// ── PC1 and PC2 ──────────────────────────────────────────────────────────────

const SIGNAL = new Set<PurchaseRead["state"]>(["proposed", "platform_proposed"]);

export function planPurchaseCampaign(input: PcInput): PurchaseCampaignPlan {
  const none = (state: PcState, sentence: string | null = null, sentenceNarrow: string | null = null): PurchaseCampaignPlan => ({ state, sentence, sentenceNarrow, card: null, build: null });
  const read = input.read;
  // 1. The signal.
  if (!read || !SIGNAL.has(read.state) || !read.pixel) return none("not_proposed");
  // 2. No Purchase campaign yet.
  if (input.existing) return none("running");
  const main = input.main;
  const path: "platform" | "own_domain" = read.state === "platform_proposed" ? "platform" : "own_domain";
  // 3. A main campaign to copy. On the own-domain path a pick's purchases are its domain's, which Meta doesn't split by ad set: no purchase pick.
  const picked = main ? pickAdSets(main.adSets, path === "platform") : null;
  if (!main || !picked) {
    const short = main ? shortCampaign(main.campaignKey) : null;
    return short
      ? none("nothing_to_copy", `${short} has no two ad sets with 5 results or 5 purchases in 14 days to copy.`, `Not enough in ${short} to copy.`)
      : none("nothing_to_copy", "This event has no checkout or landing-page campaign delivering to copy.", "No campaign to copy.");
  }
  const short = shortCampaign(main.campaignKey);
  // 4. Time to learn.
  const days = input.eventDate ? daysInclusive(input.runDay, input.eventDate) : 0;
  if (days < PC.minDays) {
    return none("too_close", `A Purchase campaign needs 14 days to learn; it would run ${plural(Math.max(0, days), "day")} before the show.`, "Too close to the show for a Purchase campaign.");
  }
  // 5. Money to start it.
  const remainingPlan = input.budgetGbp == null ? null : Math.max(0, input.budgetGbp - input.spendToDateGbp);
  const mainLeft = main.lifetimeGbp == null ? null : Math.max(0, main.lifetimeGbp - main.spentToDate);
  const capOf: "plan" | "main" = input.budgetGbp != null ? "plan" : "main";
  const capBase = capOf === "plan" ? remainingPlan : mainLeft;
  const capPhrase = capOf === "plan" ? "the plan left" : `what ${short} has left`;
  const mainFloor = campaignFloor(main.spentToDate, main.last7Daily);
  const floor = mainFloor.floor;
  if (capBase == null) {
    return none("no_money", `No budget to start it: ${short} has no lifetime budget to move from.`, "No budget to start a Purchase campaign.");
  }
  const cap = round2(capBase * PC.capShare);
  const headroom = input.budgetGbp != null && input.committedGbp != null ? Math.max(0, input.budgetGbp - input.spendToDateGbp - input.committedGbp) : 0;
  const maxMove = main.lifetimeGbp == null ? 0 : Math.max(0, main.lifetimeGbp - floor);
  const fund = (rate: number): PcFunding => {
    const lifetime = rate * days;
    const fromHeadroom = round2(Math.min(lifetime, headroom));
    const move = round2(lifetime - fromHeadroom);
    const fitsCap = lifetime <= cap + 1e-9;
    const keepsFloor = move <= 0 || (main.lifetimeGbp != null && move <= maxMove + 1e-9);
    return {
      rate,
      lifetime,
      headroom: fromHeadroom,
      move,
      mainBefore: move > 0 ? main.lifetimeGbp : null,
      mainAfter: move > 0 && main.lifetimeGbp != null ? round2(main.lifetimeGbp - move) : null,
      fitsCap,
      keepsFloor,
      fits: fitsCap && keepsFloor,
    };
  };
  const funding = PC.rates.map(fund);
  const five = funding.find((row) => row.rate === 5)!;
  const ten = funding.find((row) => row.rate === 10)!;
  if (!five.fits) {
    const sentence = five.fitsCap
      ? `No budget to start it: £5 a day to the show needs ${money(five.lifetime)}; ${short} keeps at least ${each(floor)} and can give ${money(maxMove)}.`
      : `No budget to start it: £5 a day to the show needs ${money(five.lifetime)}; 20 % of ${capPhrase} is ${money(cap)}.`;
    return none("no_money", sentence, "No budget to start a Purchase campaign.");
  }
  const defaultRate = ten.fits ? 10 : 5;
  const ads = reusedAds(main.ads);
  const retargeting = main.adSets.find((set) => set.delivering && RETARGETING_NAME.test(set.name) && !picked.picks.some((pick) => pick.name === set.name)) ?? null;
  const copies: PcPick[] = [...picked.picks, ...(retargeting ? [{ role: "retargeting" as const, adsetId: retargeting.adsetId, adsetIds: retargeting.adsetIds, name: retargeting.name, spend: round2(retargeting.spend), results: retargeting.results, purchases: retargeting.purchases }] : [])].slice(0, PC.maxAdSets);
  const code = input.eventCode ?? "";
  const campaignName = `[${code}] ${input.eventName} - Purchase`;
  const pixel = read.pixel;
  const last4 = pixel.id.slice(-4);
  const platform = read.platform ?? read.ticketSite ?? "the ticket site";
  const customConversion = path === "own_domain" && read.domain ? { name: `${code} · Purchase on ${read.domain}`, domain: read.domain } : null;
  const result = RESULT_SHORT[main.resultEvent];
  const attributedWord = path === "platform" ? "attributed purchase" : "purchase";
  const k = copies.length;
  const n = ads.length;
  const header = `Creates 1 campaign · ${plural(k, "ad set")} · ${plural(n, "ad")} · goes in live`;
  const optimises =
    path === "platform"
      ? `Purchase on pixel …${last4}${read.pixelName ? ` (${read.pixelName})` : ""}, the standard event — the signal is shared on ${platform}. Advantage campaign budget, lifetime.`
      : `${customConversion?.name ?? `${code} · Purchase`}, a custom conversion made on Accept. Advantage campaign budget, lifetime.`;
  const [first, second] = picked.picks;
  const tests = picked.noPurchasePick
    ? `tests ${first!.name} against ${second!.name} (both per ${result})`
    : `tests ${first!.name} (per purchase) against ${second!.name} (per ${result})`;
  const optimisesNarrow = path === "platform" ? `Purchase on pixel …${last4}, shared on ${platform} · ${tests}` : `${customConversion?.name ?? "Purchase"} · ${tests}`;
  const pickLine = (pick: PcPick): { label: string; text: string; aside: string } => {
    const perPurchase = pick.purchases > 0 ? ` · ${each(pick.spend / pick.purchases)} each` : "";
    const perResult = pick.results > 0 ? ` · ${each(pick.spend / pick.results)} each` : "";
    if (pick.role === "checkout") return { label: "Checkout pick", text: `${pick.name} · ${pick.results} ${result}${perResult}`, aside: `(${plural(pick.purchases, "purchase")})` };
    return { label: pick.role === "both" ? "Both picks" : "Purchase pick", text: `${pick.name} · ${plural(pick.purchases, attributedWord)}${perPurchase}`, aside: `(${pick.results} ${result}${perResult})` };
  };
  const tenLabel = ten.fits ? "£10 a day" : "£10 a day, over the cap";
  const rates = [
    { rate: 5, label: "£5 a day", labelNarrow: "£5 a day", fits: true },
    { rate: 10, label: tenLabel, labelNarrow: ten.fits ? "£10 a day" : "£10, over the cap", fits: ten.fits },
  ];
  const showDay = input.eventDate!;
  const rateNote = ten.fits
    ? null
    : ten.fitsCap
      ? `£5 picked: £10 a day to ${dayMonth(showDay)} needs ${money(ten.move)} from ${short}, which keeps at least ${each(floor)}.`
      : `£5 picked: £10 a day to ${dayMonth(showDay)} is ${money(ten.lifetime)}, over 20 % of ${capPhrase} (${money(cap)})`;
  const noBudget = input.budgetGbp == null;
  const byRate: PurchaseCard["byRate"] = {};
  for (const row of funding.filter((entry) => entry.fits)) {
    const lead = `From Apply (${shortDay(input.runDay)}) to the show, ${shortDay(showDay)} 23:59: ${days} days × £${row.rate} = ${money(row.lifetime)} lifetime.`;
    const keeps = `${keepsAtLeast(short, mainFloor, { pence: true })}.`;
    const moveClause = row.move > 0 && row.mainBefore != null && row.mainAfter != null ? `lifetime ${money(row.mainBefore)} → ${money(row.mainAfter)}` : "";
    const budget = noBudget
      ? `${lead} No event budget, so all of it moves from ${short}: ${moveClause}. ${keeps} It scales from here on results.`
      : row.move > 0
        ? `${lead} ${money(row.headroom)} from plan headroom + ${money(row.move)} from ${short}: ${moveClause}. ${keeps} It scales from here on results.`
        : `${lead} All of it from plan headroom; ${short}'s budget doesn't change. It scales from here on results.`;
    const writes = [
      ...(customConversion ? [`custom conversion ${customConversion.name}`] : []),
      `campaign create (${money(row.lifetime)} lifetime)`,
      `${plural(k, "ad set")}`,
      `${plural(n, "ad")} (launch path)`,
      ...(row.move > 0 && row.mainBefore != null && row.mainAfter != null ? [`${short} lifetime_budget ${money(row.mainBefore)} → ${money(row.mainAfter)}`] : []),
    ].join(" · ");
    const narrowFrom = noBudget ? `moved from ${short}` : row.move > 0 ? `${money(row.headroom)} from plan headroom + ${money(row.move)} from ${short}` : "from plan headroom";
    byRate[String(row.rate)] = { budget, writes: `Writes: ${writes}`, narrow: `${money(row.lifetime)} lifetime to ${dayMonth(showDay)}, ${narrowFrom}`, lifetime: row.lifetime, headroom: row.headroom, move: row.move, mainBefore: row.mainBefore, mainAfter: row.mainAfter };
  }
  const card: PurchaseCard = {
    campaignName,
    mainCampaignKey: main.campaignKey,
    mainShort: short,
    path,
    header,
    headerNarrow: header.replace(" · goes in live", " · live"),
    optimises,
    optimisesNarrow,
    picksHeading: picked.noPurchasePick ? `Ad sets, copied from ${short}` : `Ad sets, copied from ${short}: one pick on each measure, tested against each other`,
    pickLines: picked.picks.map(pickLine),
    picksNote: picked.noPurchasePick ? "No ad set has 5 purchases, so both are picked on cost per checkout" : null,
    retargetingLine: retargeting ? `Retargeting: ${retargeting.name} · outside the test` : `No retargeting ad set in ${short} to copy.`,
    adsHeading: `Ads, reused (${short}'s top half by convert score)`,
    adsLine: ads.length ? `${ads.map((ad) => ad.name).join(" · ")} (same posts)` : `No ad in ${short} has a convert score yet.`,
    rates,
    defaultRate,
    rateNote,
    byRate,
    note: noBudget ? `This event has no budget, so only a move out of ${short} can fund it.` : null,
    noteNarrow: noBudget ? `No event budget: only a move out of ${short} can fund it.` : null,
    held: ads.length ? null : `No ad in ${short} has a convert score yet, so there's nothing to reuse.`,
  };
  const build: PurchaseBuild = {
    campaignName,
    path,
    pixelId: pixel.id,
    customConversion,
    mainCampaignKey: main.campaignKey,
    mainCampaignId: main.campaignId,
    mainLifetimeGbp: main.lifetimeGbp,
    mainSpentToDate: main.spentToDate,
    mainLast7Daily: main.last7Daily,
    mainShort: short,
    draftId: main.draftId,
    adAccountId: main.adAccountId,
    picks: copies,
    noPurchasePick: picked.noPurchasePick,
    ads,
    days,
    startDay: input.runDay,
    endDay: showDay,
    cap,
    capOf,
    floor,
    funding,
    defaultRate,
  };
  return { state: "proposed", sentence: null, sentenceNarrow: null, card, build };
}

// ── HP1: the reads, from the event's ad-days ─────────────────────────────────

/** The parts of an ad-day the Purchase campaign reads (load.ts's InsightRow). */
export type PcRow = {
  meta_ad_id: string;
  meta_adset_id: string | null;
  meta_campaign_id: string | null;
  ad_account_id?: string | null;
  date: string;
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
  spend: number | string;
  landing_page_views: number | string;
  purchases: number | string;
  actions: { action_type?: string; value?: string | number }[] | null;
  promoted_event?: string | null;
  optimization_goal?: string | null;
};

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const icOf = (row: PcRow) => (Array.isArray(row.actions) ? row.actions.filter((action) => action?.action_type === "omni_initiated_checkout").reduce((sum, action) => sum + num(action.value), 0) : 0);

/** What a campaign optimises for over a span, by spend: "purchase", "initiate_checkout", "landing_page_view" or "other". */
function goalOf(row: PcRow): "purchase" | PcResult | "other" {
  const goal = (row.optimization_goal ?? "").toUpperCase();
  const event = (row.promoted_event ?? "").toUpperCase();
  if (goal === "OFFSITE_CONVERSIONS" && event === "PURCHASE") return "purchase";
  if (goal === "OFFSITE_CONVERSIONS" && event === "INITIATED_CHECKOUT") return "initiate_checkout";
  if (goal === "LANDING_PAGE_VIEWS") return "landing_page_view";
  return "other";
}

export type PcBudgets = {
  /** Campaign id → its budget, £ (from Meta, read only when the signal holds). */
  campaigns: ReadonlyMap<string, { daily: number | null; lifetime: number | null }>;
  /** Ad set id → its campaign, budget (£), and resolved-pixel match (from the purchase read's ad-set batch). */
  adSets: ReadonlyMap<string, { campaignId: string | null; daily: number | null; lifetime: number | null; pixelId: string | null }>;
};

/** The event's draft for a campaign (load.ts's draftForCampaign result). */
export type PcDraftOf = (campaignKey: string) => { draftId: string; adAccountId: string } | null;

/**
 * HP1: step 2's existing campaign, the main campaign with its 14-day ad
 * sets and ads, and what the live campaigns still have committed. `rows`
 * are the event's ad-days to the window's end.
 */
export function purchaseCampaignInput(args: {
  rows: readonly PcRow[];
  eventCode: string | null;
  eventName: string;
  runDay: string;
  eventDate: string | null;
  windowStart: string;
  windowEnd: string;
  onSaleDay: string | null;
  read: PurchaseRead | undefined;
  scores: ReadonlyMap<string, number | null>;
  budgets: PcBudgets | null;
  budgetGbp: number | null;
  spendToDateGbp: number;
  draftOf: PcDraftOf;
}): PcInput {
  const end = args.windowEnd;
  const from14 = addDaysIso(end, -13);
  const from = args.onSaleDay && args.onSaleDay > from14 && args.onSaleDay <= end ? args.onSaleDay : from14;
  const lastTwo = new Set([end, addDaysIso(end, -1)]);
  const pixelId = args.read?.pixel?.id ?? null;
  const inSpan = args.rows.filter((row) => row.date >= from14 && row.date <= end);
  const keyOf = (row: PcRow) => (row.campaign_name ?? row.meta_campaign_id ?? "—").trim();
  // Step 2: a campaign that delivered on Purchase in the 14 days.
  const existing = [...new Set(inSpan.filter((row) => num(row.spend) > 0 && goalOf(row) === "purchase").map(keyOf))].sort()[0] ?? null;
  // The main campaign: the delivering IC or LPV campaign with the most spend over the 14 days.
  const byCampaign = new Map<string, { spend: number; goals: Map<string, number>; delivering: boolean }>();
  for (const row of inSpan) {
    const key = keyOf(row);
    const entry = byCampaign.get(key) ?? { spend: 0, goals: new Map(), delivering: false };
    const spend = num(row.spend);
    entry.spend += spend;
    const goal = goalOf(row);
    entry.goals.set(goal, (entry.goals.get(goal) ?? 0) + spend);
    if (spend > 0 && lastTwo.has(row.date)) entry.delivering = true;
    byCampaign.set(key, entry);
  }
  const candidates = [...byCampaign]
    .map(([key, entry]) => ({ key, ...entry, goal: [...entry.goals].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other" }))
    .filter((entry) => entry.delivering && (entry.goal === "initiate_checkout" || entry.goal === "landing_page_view"))
    .sort((a, b) => b.spend - a.spend || a.key.localeCompare(b.key));
  const chosen = candidates[0] ?? null;
  let main: PcMain | null = null;
  if (chosen) {
    const resultEvent = chosen.goal as PcResult;
    const resultOf = (row: PcRow) => (resultEvent === "initiate_checkout" ? icOf(row) : num(row.landing_page_views));
    const campaignRows = args.rows.filter((row) => keyOf(row) === chosen.key && row.date <= end);
    const spanRows = campaignRows.filter((row) => row.date >= from);
    const latest = [...campaignRows].filter((row) => num(row.spend) > 0 && row.meta_campaign_id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
    const campaignId = latest?.meta_campaign_id ?? null;
    const onPixel = (adsetId: string | null) => {
      const meta = adsetId ? args.budgets?.adSets.get(adsetId) : undefined;
      // T3: purchases count on the resolved pixel only. Without the ad-set read, the purchase read's own pixel resolution stands.
      return !meta || !pixelId || meta.pixelId === pixelId;
    };
    const adSets = new Map<string, PcAdSet>();
    const ads = new Map<string, PcAd>();
    for (const row of spanRows) {
      const spend = num(row.spend);
      const setKey = (row.adset_name ?? row.meta_adset_id ?? "").trim();
      const set = adSets.get(setKey) ?? { adsetId: row.meta_adset_id ?? "", adsetIds: [], name: setKey, spend: 0, results: 0, purchases: 0, delivering: false };
      if (row.meta_adset_id && !set.adsetIds.includes(row.meta_adset_id)) set.adsetIds.push(row.meta_adset_id);
      if (row.meta_adset_id && spend > 0) set.adsetId = row.meta_adset_id;
      set.spend += spend;
      set.results += resultOf(row);
      if (onPixel(row.meta_adset_id)) set.purchases += num(row.purchases);
      if (spend > 0 && lastTwo.has(row.date)) set.delivering = true;
      adSets.set(setKey, set);
      const ad = ads.get(row.meta_ad_id) ?? { adId: row.meta_ad_id, adsetId: row.meta_adset_id ?? "", name: row.ad_name ?? row.meta_ad_id, convertScore: args.scores.get(row.ad_name ?? "") ?? null, deliveringNow: false };
      if (spend > 0 && lastTwo.has(row.date)) ad.deliveringNow = true;
      ads.set(row.meta_ad_id, ad);
    }
    const spentToDate = campaignId ? campaignRows.filter((row) => row.meta_campaign_id === campaignId).reduce((sum, row) => sum + num(row.spend), 0) : campaignRows.reduce((sum, row) => sum + num(row.spend), 0);
    const week = campaignRows.filter((row) => row.date >= args.windowStart && row.date <= end).reduce((sum, row) => sum + num(row.spend), 0);
    const draft = args.draftOf(chosen.key);
    main = {
      campaignKey: chosen.key,
      campaignId,
      resultEvent,
      from,
      to: end,
      spend: round2(spanRows.reduce((sum, row) => sum + num(row.spend), 0)),
      results: spanRows.reduce((sum, row) => sum + resultOf(row), 0),
      purchases: spanRows.reduce((sum, row) => sum + num(row.purchases), 0),
      adSets: [...adSets.values()].map((set) => ({ ...set, spend: round2(set.spend) })),
      ads: [...ads.values()],
      spentToDate: round2(spentToDate),
      last7Daily: round2(week / 7),
      lifetimeGbp: campaignId ? (args.budgets?.campaigns.get(campaignId)?.lifetime ?? null) : null,
      draftId: draft?.draftId ?? null,
      adAccountId: draft?.adAccountId ?? null,
    };
  }
  return {
    eventCode: args.eventCode,
    eventName: args.eventName,
    runDay: args.runDay,
    eventDate: args.eventDate,
    read: args.read,
    existing,
    main,
    budgetGbp: args.budgetGbp,
    spendToDateGbp: args.spendToDateGbp,
    committedGbp: committedOf(args, lastTwo),
  };
}

/**
 * PC3's headroom input: what every live campaign of the event still has
 * committed — its lifetime budget less its spend to date, or its daily rate
 * × the days to the show. A campaign budget wins; otherwise its delivering
 * ad sets' budgets. Null when any live campaign's budget wasn't read.
 */
function committedOf(args: { rows: readonly PcRow[]; runDay: string; eventDate: string | null; windowEnd: string; budgets: PcBudgets | null }, lastTwo: ReadonlySet<string>): number | null {
  if (!args.budgets || !args.eventDate) return null;
  const days = Math.max(0, daysInclusive(args.runDay, args.eventDate));
  const spentById = new Map<string, number>();
  const spentBySet = new Map<string, number>();
  const live = new Set<string>();
  const liveSets = new Map<string, Set<string>>();
  for (const row of args.rows) {
    if (row.date > args.windowEnd) continue;
    const spend = num(row.spend);
    if (row.meta_campaign_id) spentById.set(row.meta_campaign_id, (spentById.get(row.meta_campaign_id) ?? 0) + spend);
    if (row.meta_adset_id) spentBySet.set(row.meta_adset_id, (spentBySet.get(row.meta_adset_id) ?? 0) + spend);
    if (spend > 0 && lastTwo.has(row.date) && row.meta_campaign_id) {
      live.add(row.meta_campaign_id);
      if (row.meta_adset_id) liveSets.set(row.meta_campaign_id, (liveSets.get(row.meta_campaign_id) ?? new Set()).add(row.meta_adset_id));
    }
  }
  let total = 0;
  for (const id of live) {
    const campaign = args.budgets.campaigns.get(id);
    if (campaign?.lifetime != null) {
      total += Math.max(0, campaign.lifetime - (spentById.get(id) ?? 0));
      continue;
    }
    if (campaign?.daily != null) {
      total += campaign.daily * days;
      continue;
    }
    for (const setId of liveSets.get(id) ?? []) {
      const set = args.budgets.adSets.get(setId);
      if (!set || (set.lifetime == null && set.daily == null)) return null;
      total += set.lifetime != null ? Math.max(0, set.lifetime - (spentBySet.get(setId) ?? 0)) : set.daily! * days;
    }
  }
  return round2(total);
}

// ── The purchase sentence and the Budget block ───────────────────────────────

/** PC1 step 2: "Purchase campaign proposed — …" opens "Purchase campaign running — …"; at 393, "Purchase campaign running: …". */
export function runningForm(purchase: string, purchaseNarrow: string): { purchase: string; purchaseNarrow: string } {
  return {
    purchase: purchase.replace(/^Purchase campaign proposed — /, "Purchase campaign running — "),
    purchaseNarrow: purchaseNarrow.replace(/^Purchase campaign: /, "Purchase campaign running: "),
  };
}

/** PF1's Budget block: "£4,500 for this event · £2,051.30 spent to 12 Nov · £2,448.70 left in the plan"; null with no event budget. */
export function planSentence(budgetGbp: number | null, spendToDateGbp: number, windowEnd: string): { wide: string; narrow: string } | null {
  if (budgetGbp == null) return null;
  const left = Math.max(0, budgetGbp - spendToDateGbp);
  const whole = (value: number) => `£${group(String(Math.round(value)))}`;
  return {
    wide: `${money(budgetGbp)} for this event · ${each(spendToDateGbp)} spent to ${dayMonth(windowEnd)} · ${each(left)} left in the plan`,
    narrow: `${whole(budgetGbp)} · ${whole(spendToDateGbp)} spent · ${whole(left)} left`,
  };
}

/** PF1 / PF2's comparison row under Objective: "{from – to} · £669.95 · 76 IC · £8.82 each · 1 attributed purchase". */
export function mainRow(main: PcMain, path: "platform" | "own_domain" | null): { campaignKey: string; detail: string } {
  const result = RESULT_SHORT[main.resultEvent];
  const span = main.from.slice(0, 7) === main.to.slice(0, 7) ? `${Number(main.from.slice(8))} – ${dayMonth(main.to)}` : `${dayMonth(main.from)} – ${dayMonth(main.to)}`;
  const per = main.results > 0 ? ` · ${each(main.spend / main.results)} each` : "";
  return { campaignKey: main.campaignKey, detail: `${span} · ${each(main.spend)} · ${main.results} ${result}${per} · ${plural(main.purchases, path === "own_domain" ? "purchase" : "attributed purchase")}` };
}
