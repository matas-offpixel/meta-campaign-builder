/**
 * The Retargeting campaign's words (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT3, RT4, RT8, RT9, RT10). Every string the panel draws is built
 * here, from the record's templates, so a test can hold them to the
 * record. Pure: no database, no Meta.
 *
 * Never on the panel (RT10): ABO, CBO, IC, LPV, "cost per sale", CAPI,
 * Events API, advertiser ID, dataset.
 */

import { dayMonth, shortDay } from "../onsale-refresh/schedule.ts";

export type Tier = "bottom" | "mid_bottom" | "mid";

export const TIERS: readonly Tier[] = ["bottom", "mid_bottom", "mid"];

/** RT1: the panel's tier names. */
export const TIER_LABEL: Record<Tier, string> = { bottom: "Bottom", mid_bottom: "Mid Bottom", mid: "Mid" };

/** RT1: "{code} · Retargeting". */
export function retargetingCampaignName(code: string): string {
  return `${code} · Retargeting`;
}

/** RT1: "{code} · Retargeting · Bottom", "· Mid Bottom", "· Mid" (the TT1 naming). */
export function tierAdSetName(code: string, tier: Tier): string {
  return `${retargetingCampaignName(code)} · ${TIER_LABEL[tier]}`;
}

/** A campaign named `{code} · Retargeting` (the RT1 campaign), whatever follows it. */
export function isRetargetingCampaignName(name: string | null | undefined, code: string | null | undefined): boolean {
  if (!name || !code) return false;
  const head = retargetingCampaignName(code).toLowerCase();
  const value = name.trim().toLowerCase();
  return value === head || value.startsWith(`${head} `);
}

/** TT1's Tests campaign (`{code} · Tests`, `· Tests · Video`): left out of current daily spend (RT4). */
export function isTestsCampaignName(name: string | null | undefined, code: string | null | undefined): boolean {
  if (!name || !code) return false;
  const head = `${code} · Tests`.toLowerCase();
  const value = name.trim().toLowerCase();
  return value === head || value.startsWith(`${head} `);
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Always with pence: £12.00, £185.60, £1,234.50. */
export function pence(minorOrMajor: number, opts: { minor?: boolean } = {}): string {
  const value = opts.minor ? minorOrMajor / 100 : minorOrMajor;
  const [int, frac] = (Math.round(value * 100) / 100).toFixed(2).split(".");
  return `£${group(int!)}.${frac}`;
}

/** Whole pounds drop the pence: £1, £24, £5.80. */
export function pounds(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return `£${group(String(rounded))}`;
  return pence(rounded);
}

// ── RT3 ──────────────────────────────────────────────────────────────────────

/** RT3: "£{total} a day · {pct} % of current daily spend". */
export function budgetHeader(totalMinor: number, pct: number): string {
  return `${pence(totalMinor, { minor: true })} a day · ${pct} % of current daily spend`;
}

/** RT3: "Running since {Ddd d Mon} · ends {Ddd d Mon}, 23:59". */
export function runningLine(since: string, showDay: string): string {
  return `Running since ${shortDay(since)} · ends ${shortDay(showDay)}, 23:59`;
}

/** RT10's 393 form: "Ends {Ddd d Mon}, 23:59". */
export function endsLine(showDay: string): string {
  return `Ends ${shortDay(showDay)}, 23:59`;
}

/** RT3 / T4: the signal line. */
export function signalLine(path: "platform" | "own_domain", args: { pixelName: string | null; domain: string | null }): string {
  if (path === "own_domain" && args.domain) return `Attributed purchases on ${args.domain}`;
  return `Attributed purchases on the ${args.pixelName ?? "show's"} pixel, shared with its other shows' sales`;
}

/** RT10's 393 form of the platform signal (frame RA 393): "{pixel name} pixel, shared with its other shows". */
export function signalNarrow(path: "platform" | "own_domain", args: { pixelName: string | null; domain: string | null }): string {
  if (path === "own_domain" && args.domain) return `Attributed purchases on ${args.domain}`;
  return `${args.pixelName ?? "The show's"} pixel, shared with its other shows`;
}

/** RT3: "£12.00 a day". */
export function tierBudget(minor: number): string {
  return `${pence(minor, { minor: true })} a day`;
}

/** RT3: "Leaves out" for each tier; without a buyers source the word "buyers" goes (RT8 says why). */
export function leavesOut(tier: Tier, buyers: boolean): string {
  const hotter = tier === "bottom" ? [] : tier === "mid_bottom" ? ["Bottom"] : ["Mid Bottom", "Bottom"];
  const parts = [...hotter, ...(buyers ? [tier === "bottom" ? "Buyers" : "buyers"] : [])];
  return parts.join(" · ");
}

/** RT14: a source's windows as words, "7, 14 and 30 days". */
export function windowsText(days: readonly number[]): string {
  const parts = days.map(String);
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]} days`;
}

/**
 * RT3 / RT14: the includes in short, one entry per line; sources with the
 * same windows share a line ("Ticket-link visitors · checkout starters ·
 * 7, 14 and 30 days").
 */
export function audiencesShort(tier: Tier, args: { signupLists: number; similarLists: number; pagesUsed: number; pagesTotal: number; hasVideo: boolean; hasTickets: boolean; hasLanding: boolean }): string[] {
  const lines: string[] = [];
  if (tier === "bottom") {
    if (args.hasTickets) lines.push(`Ticket-link visitors · checkout starters · ${windowsText([7, 14, 30])}`);
    if (args.hasLanding) lines.push(`Registrations · ${windowsText([30, 90, 180])}`);
    if (args.signupLists) lines.push(args.signupLists === 1 ? "Signup list" : `${args.signupLists} signup lists`);
    return lines;
  }
  if (tier === "mid_bottom") {
    if (args.hasLanding) lines.push(`Page visitors · ${windowsText([14, 30, 60])}`);
    if (args.hasTickets) lines.push(`Checkout starters · ${windowsText([60])}`);
    // Similar lists sit in Mid Bottom (Matas, 17 Nov).
    if (args.similarLists) lines.push(args.similarLists === 1 ? "Similar list" : `${args.similarLists} similar lists`);
    return lines;
  }
  if (args.hasVideo) lines.push(`Video viewers 75 % · ${windowsText([90, 180, 365])}`);
  if (args.pagesUsed) {
    const pages = args.pagesUsed === args.pagesTotal ? `${args.pagesUsed} page${args.pagesUsed === 1 ? "" : "s"}` : `${args.pagesUsed} of ${args.pagesTotal} pages`;
    lines.push(`Page and Instagram engagers · ${windowsText([30, 90, 180])} · ${pages}`);
  }
  return lines;
}

/** RT10's card form: the includes on one line, lists in lower case ("… · 30 days · signup list · 2 similar lists"). */
export function audiencesNarrow(lines: readonly string[]): string {
  return lines.map((line, index) => (index === 0 ? line : line.charAt(0).toLowerCase() + line.slice(1))).join(" · ");
}

/** RT3: before the campaign runs, the figure columns read "—". */
export const NO_FIGURE = "—";

/** RT3 (revised 17 Nov): before Apply the tier's audiences don't exist, so Meta has no estimate. Never "—" or another figure. */
export const POOL_BEFORE_CREATE = "Known after create";
/** RT10's card form. */
export const POOL_BEFORE_CREATE_NARROW = "Pool known after create";

// ── RT4 ──────────────────────────────────────────────────────────────────────

/** RT4: "No spend in the last 7 days to size a budget from." */
export const NO_SPEND = "No spend in the last 7 days to size a budget from.";

/** RT4: " · £1 a tier minimum" (the floor, or Meta's min_daily_budget when higher). */
export function floorSuffix(floorMinor: number): string {
  return ` · ${pounds(floorMinor / 100)} a tier minimum`;
}

/** RT11: "£{total} a day · {share} % of current daily spend", inside a step "{share} % of current daily spend, {stretch}". */
export function createHead(totalMinor: number, pct: number, stretch: string | null): string {
  return `${budgetHeader(totalMinor, pct)}${stretch ? `, ${stretch}` : ""}`;
}

/** RT11's Create line: "£{total} a day · {share} % of current daily spend[, {stretch}] · Bottom £{b} · Mid Bottom £{mb} · Mid £{m}". */
export function createLine(args: { totalMinor: number; pct: number; tiers: Record<Tier, number>; atFloor: boolean; floorMinor: number; stretch?: string | null }): string {
  const tiers = TIERS.filter((tier) => args.tiers[tier] > 0).map((tier) => `${TIER_LABEL[tier]} ${pence(args.tiers[tier], { minor: true })}`);
  return `${createHead(args.totalMinor, args.pct, args.stretch ?? null)} · ${tiers.join(" · ")}${args.atFloor ? floorSuffix(args.floorMinor) : ""}`;
}

/** RT4 at 393 (frame RB 393): the tier split on its own line. */
export function createSplit(args: { tiers: Record<Tier, number>; atFloor: boolean; floorMinor: number }): string {
  const tiers = TIERS.filter((tier) => args.tiers[tier] > 0).map((tier) => `${TIER_LABEL[tier]} ${pence(args.tiers[tier], { minor: true })}`);
  return `${tiers.join(" · ")}${args.atFloor ? floorSuffix(args.floorMinor) : ""}`;
}

/** RT4: "£{hold} to the show ({n} days) · {from}". */
export function holdLine(holdMinor: number, days: number, from: string): string {
  return `${pence(holdMinor, { minor: true })} to the show (${days} day${days === 1 ? "" : "s"}) · ${from}`;
}

/** RT4's {from}: plan headroom, or headroom and a move out of the main campaign (the Purchase create's words). */
export function fromText(args: { headroom: number; move: number; mainShort: string | null; noBudget: boolean }): string {
  if (args.noBudget && args.mainShort) return `moved from ${args.mainShort}`;
  if (args.move > 0 && args.mainShort) return args.headroom > 0 ? `${pounds(args.headroom)} from plan headroom + ${pounds(args.move)} from ${args.mainShort}` : `${pounds(args.move)} from ${args.mainShort}`;
  return "from plan headroom";
}

/**
 * New string (not in the record; the Purchase card's PC1 sentence, for this
 * campaign): the hold doesn't fit the 20 % cap. Accept is held.
 */
export function overCap(holdMinor: number, capGbp: number, capOf: "plan" | "main", mainShort: string | null): string {
  const phrase = capOf === "plan" ? "the plan left" : `what ${mainShort ?? "the main campaign"} has left`;
  return `No budget to start it: ${pence(holdMinor, { minor: true })} to the show is over 20 % of ${phrase} (${pounds(capGbp)}).`;
}

/** New string: no event budget and no main campaign with a lifetime budget to move from. Accept is held. */
export function noMoney(mainShort: string | null): string {
  return mainShort ? `No budget to start it: ${mainShort} has no lifetime budget to move from.` : "No budget to start it: this event has no budget and no campaign to move from.";
}

/** RB's write line under the Create line. */
export const CREATE_WRITE = "New campaign, audiences and ad sets through the Purchase create path · goes in live";

// ── RT8 ──────────────────────────────────────────────────────────────────────

export const NO_SIGNUP_LIST = "No signup list yet, so Bottom runs on ticket-link visitors and checkout starters only.";

/** RT15: "No signup list yet, so Bottom runs on {sources} only.", {sources} what Bottom has. */
export function noSignupList(sources: readonly string[]): string {
  const list = sources.length > 1 ? `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)}` : (sources[0] ?? "nothing else");
  return `No signup list yet, so Bottom runs on ${list} only.`;
}

/** RT15: no registrations reaching the pixel from the landing pages in 28 days. */
export function noRegistrations(pages: readonly string[]): string {
  return `No registrations from ${joinNames(pages)} reach the pixel in 28 days, so Bottom counts signups from the signup list only.`;
}

/** RT13: Bottom can't be built; its 50 % goes to Mid Bottom and Mid, 1 to 1. */
export const BOTTOM_NOT_BUILT = "Bottom has no audience yet: no visits, checkout starters, registrations or signup list.";

/** RT18: before Apply the links' audiences don't exist. */
export const BY_LINK_BEFORE_CREATE = "By link: known after create";

/** RT18: a link audience's size band, "2,100–2,500" or "below 1,000". */
export function sizeBand(lower: number, upper: number): string {
  if (!(upper >= 1000)) return "below 1,000";
  return `${group(String(Math.round(lower)))}–${group(String(Math.round(upper)))}`;
}

/** RT18: "Skiddle 2,100–2,500 · RA 1,000–1,200 · Fixr below 1,000"; a size Meta didn't give reads "—". */
export function sizesLine(entries: readonly { name: string; band: string | null }[]): string {
  return entries.map((entry) => `${entry.name} ${entry.band ?? NO_FIGURE}`).join(" · ");
}

/** RT18: "Pixel on {names}: yes · {names}: no", or "Pixel on {names}: no" when all are no. */
export function pixelLine(entries: readonly { name: string; on: boolean }[]): string {
  const yes = entries.filter((entry) => entry.on).map((entry) => entry.name);
  const no = entries.filter((entry) => !entry.on).map((entry) => entry.name);
  if (!yes.length) return `Pixel on ${joinNames(no)}: no`;
  return `Pixel on ${joinNames(yes)}: yes${no.length ? ` · ${joinNames(no)}: no` : ""}`;
}

/** RT18: under a ticket site the pixel isn't on. */
export const TICKET_SITE_COUNTS = "A ticket site counts visitors only when your pixel is on it there.";

export const UPLOAD_SIGNUP_LIST = "Upload the signup list";

/** RT8: one line naming every lineup page with no role. */
export function pagesNoRole(names: readonly string[]): string {
  const list = joinNames(names);
  return `${list} ${names.length === 1 ? "isn't" : "aren't"} in Mid: your Facebook user has no role on ${names.length === 1 ? "the page" : "these pages"}. Granting ADVERTISE on ${names.length === 1 ? "it adds it" : "them adds them"} at the next read.`;
}

/** RT8 on a phone: "{page}: no page role, not in Mid." */
export function pagesNoRoleNarrow(names: readonly string[]): string {
  return `${joinNames(names)}: no page role, not in Mid.`;
}

export const MID_NOT_BUILT = "Mid has no audience yet: no page with a role and no video views.";

/** RT8 (revised 17 Nov): the same line whether or not the client has a ticketing connection, which doesn't supply buyers yet. */
export const NO_BUYERS_LIST = "No buyers list yet, so buyers aren't left out and will keep seeing these ads.";
export const UPLOAD_BUYERS = "Upload a buyers list";

/** RT8: "Buyers list uploaded {d Mon} · {n} days old", and from 7 days "…: upload it again so new buyers drop out". */
export function buyersListAge(uploaded: string, days: number): string {
  const base = `Buyers list uploaded ${dayMonth(uploaded)} · ${days} day${days === 1 ? "" : "s"} old`;
  return days >= 7 ? `${base}: upload it again so new buyers drop out` : base;
}

/** RT8: not proposed, each replacing the Create line. */
export function startsOnSale(onSaleDay: string): string {
  return `Retargeting starts when the show goes on sale (${shortDay(onSaleDay)}).`;
}
export const NO_PIXEL = "No Retargeting campaign: these ads have no pixel to optimise on.";
export function sellsElsewhere(args: { host: string; pct: number; purchases: number; platform: string }): string {
  return `No Retargeting campaign: this pixel mostly sells on ${args.host} (${args.pct} % of ${group(String(args.purchases))} purchases in 28 days), not on ${args.platform}.`;
}
export const NOT_READ = "Retargeting not proposed: purchases couldn't be read this run. The next run tries again.";
/** RT13: CIRQLIN's 404 no_page. */
export const LINKS_NO_PAGE = "Retargeting not proposed: this show's CIRQLIN page isn't published. It's proposed at the first read after it is.";
/** RT13: any other failure of the page-links read. */
export const LINKS_NOT_READ = "Retargeting not proposed: the show's links couldn't be read from CIRQLIN this run. The next run tries again.";
/** RT8 (#1299 6ec5353): E2's "nothing reaches", with no platform path. */
export function nothingReaches(domain: string): string {
  return `No Retargeting campaign: no purchase has reached ${domain} in 28 days, and the ticket link isn't on a ticket platform.`;
}
export const NO_PIXEL_PURCHASES = "No Retargeting campaign: this pixel has had no purchases in 28 days.";
export const NO_PAGE_OR_TICKET = "No Retargeting campaign: this show has no page or ticket link to read purchases from.";

// ── RT9 ──────────────────────────────────────────────────────────────────────

/** RT9: the on-sale panel's one note in place of the per-campaign Retargeting default. */
export function runsInOwnCampaign(code: string): string {
  return `Retargeting runs in its own campaign, ${retargetingCampaignName(code)}.`;
}

/** RT9: legacy ad sets: "{n} retargeting ad set(s) already run in {campaign}: pause them once this is live." */
export function legacyAdSets(n: number, campaign: string): string {
  return n === 1 ? `1 retargeting ad set already runs in ${campaign}: pause it once this is live.` : `${n} retargeting ad sets already run in ${campaign}: pause them once this is live.`;
}

/** RT8: "{A} and {B}", "{A}, {B} and {C}", and past three "{A}, {B}, {C} and {n} more". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** RT9: when the campaign is off, one line on the Retargeting panel. */
export function retargetingOff(code: string): string {
  return `${retargetingCampaignName(code)} is off.`;
}

// ── RT17 (the layout test) ───────────────────────────────────────────────────

export type Arm = "A" | "B";

/** RT17: the arms' headings. */
export const ARM_LABEL: Record<Arm, string> = { A: "A · tiers by action", B: "B · by recency" };

/** RT17: "{code} · Retargeting · A/B · A" / "· B". */
export function armCampaignName(code: string, arm: Arm): string {
  return `${retargetingCampaignName(code)} · A/B · ${arm}`;
}

/** RT17: "{code} · Retargeting · A/B · {A | B} · {tier}". */
export function armAdSetName(code: string, arm: Arm, tier: Tier): string {
  return `${armCampaignName(code, arm)} · ${TIER_LABEL[tier]}`;
}

/** RT17: the panel header, "{code} · Retargeting · A/B test". */
export function testTitle(code: string): string {
  return `${retargetingCampaignName(code)} · A/B test`;
}

/** RT17: "£{half} a day to each arm · Meta splits people at random, so nobody sees both". */
export function eachArmLine(halfMinor: number): string {
  return `${pence(halfMinor, { minor: true })} a day to each arm · Meta splits people at random, so nobody sees both`;
}

/** RT17 at 393: "£{total} a day · £{half} to each arm", then "Meta splits people at random, so nobody sees both". */
export function eachArmNarrow(totalMinor: number, halfMinor: number): string {
  return `${pence(totalMinor, { minor: true })} a day · ${pence(halfMinor, { minor: true })} to each arm`;
}
export const META_SPLITS = "Meta splits people at random, so nobody sees both";

/** RT17: "Too small to test: £{total} a day is under £6.00, so it runs layout A only." */
export function tooSmallToTest(totalMinor: number): string {
  return `Too small to test: ${pence(totalMinor, { minor: true })} a day is under £6.00, so it runs layout A only.`;
}

/** RT17: arm B's audiences, "Every source · {30 | 60 | 180} days", Bottom's second line "Registrations · 180 days · signup list". */
export function armBAudiences(tier: Tier, args: { signupLists: number; similarLists: number; hasLanding: boolean }): string[] {
  const days = tier === "bottom" ? 30 : tier === "mid_bottom" ? 60 : 180;
  const first = `Every source · ${days} days${tier === "mid_bottom" && args.similarLists ? ` · ${args.similarLists === 1 ? "similar list" : `${args.similarLists} similar lists`}` : ""}`;
  if (tier !== "bottom") return [first];
  const second = [...(args.hasLanding ? ["Registrations · 180 days"] : []), ...(args.signupLists ? [args.signupLists === 1 ? "signup list" : `${args.signupLists} signup lists`] : [])];
  return second.length ? [first, second.join(" · ").replace(/^s/, (c) => c.toUpperCase())] : [first];
}

/** RT17: the pooled block's heading. */
export const POOLED_TITLE = "The test, every show";

/** RT17: before the minimum. */
export function notCalledYet(args: { day: number; a: number; b: number; shows: number }): string {
  return `Not called yet: day ${args.day} of at least 14 · A ${args.a} and B ${args.b} attributed purchases, at least 30 each · ${args.shows} show${args.shows === 1 ? "" : "s"}, at least 3`;
}

/** RT17: under the margin. */
export function tooCloseToCall(args: { a: number; b: number; pct: number }): string {
  return `Too close to call: A ${pence(args.a)}, B ${pence(args.b)} per attributed purchase, ${args.pct} % apart (15 % needed).`;
}

/** RT17: from 28 days, still under 15 % (accepting keeps A). */
export function noClearWinner(args: { a: number; b: number }): string {
  return `No clear winner after 28 days: A ${pence(args.a)}, B ${pence(args.b)} per attributed purchase.`;
}

/** RT17: the call line. */
export function callTitle(winner: Arm): string {
  return `Layout ${winner} wins the retargeting test`;
}
export function callDetail(args: { winner: Arm; x: number; nx: number; y: number; ny: number; pct: number; shows: number; days: number; from: string; to: string }): string {
  const loser: Arm = args.winner === "A" ? "B" : "A";
  return `${pence(args.x)} per attributed purchase (${args.nx}) against ${loser}'s ${pence(args.y)} (${args.ny}) · ${args.pct} % cheaper · ${args.shows} shows · ${args.days} days, ${dayRange(args.from, args.to)}`;
}
export function callOnAccept(winner: Arm, shows: number): string {
  const loser: Arm = winner === "A" ? "B" : "A";
  return `On accept: ${loser} pauses on ${shows} shows and each show's ${winner} takes its whole retargeting budget. New shows start on ${winner}.`;
}
export function callWrite(shows: number): string {
  return `Ends the Meta A/B test on ${shows} shows · pauses ${shows} campaigns · ad-set budget writes`;
}
export function callNarrow(args: { winner: Arm; x: number; y: number; pct: number }): string {
  return `Layout ${args.winner} wins · ${pence(args.x)} vs ${pence(args.y)} · ${args.pct} % cheaper`;
}
export function callNarrowSub(shows: number, days: number): string {
  return `${shows} shows · ${days} days`;
}

/** "Tue 17 – Mon 30 Nov" (one month), else "Mon 30 Nov – Tue 1 Dec". */
export function dayRange(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const first = shortDay(from);
  return sameMonth ? `${first.replace(/ [A-Z][a-z]{2}$/, "")} – ${shortDay(to)}` : `${first} – ${shortDay(to)}`;
}

/** RT17 at 393: an arm card's tier line, "{tier} · £{b} a day · £{c} · {n} purchases · frequency {f}". */
export function armTierNarrow(args: { tier: Tier; budgetMinor: number; cost: number | null; purchases: number | null; frequency: number | null }): string {
  return `${TIER_LABEL[args.tier]} · ${pence(args.budgetMinor, { minor: true })} a day · ${args.cost == null ? NO_FIGURE : pence(args.cost)} · ${args.purchases ?? 0} purchase${args.purchases === 1 ? "" : "s"} · frequency ${args.frequency == null ? NO_FIGURE : args.frequency.toFixed(1)}`;
}

/** RT3: the total row's label and spend (also PR C's; the same strings). */
export const LAST_7_DAYS = "Last 7 days";
export function spentText(minor: number): string {
  return `${pence(minor, { minor: true })} spent`;
}
