/**
 * lib/dashboard/page-audience-panel/model.ts
 *
 * HE2's panel (dashboard v2, HA2 / HB3): CIRQLIN's page audience on the
 * sales dashboard, for every view the dashboard has (client, venue, show)
 * and every period. Pure: the reads are in ./server.ts, through
 * lib/cirqlin/page-audience/read.ts only.
 *
 * Words come from the design records:
 *   - 2026-11-15-dashboard-v2-he2-page-audience.html (PA1–PA7);
 *   - 2026-11-15-dashboard-v2-panels-and-he2-gaps.html (PB3, PB4);
 *   - 2026-11-15-dashboard-v2-presale-creatives-budget.html (PH2, PH7);
 *   - 2026-11-16-sales-page-order-he2.html (HP1–HP3: the footnote, the
 *     scope line);
 *   - 2026-11-16-he2-join-rate.html (JR1–JR5: the join rate returns from
 *     CIRQLIN's joined-and-reachable count, since launch only);
 *   - 2026-11-13-dashboard-v2-phase-2.html (E1, E2, EV1, EV2), where the
 *     records above don't replace them.
 * HP2 accepted the strings #1284 added; they're marked HP2 below.
 *
 * Two figures live here:
 *   - Signups & communities (E2): the three steps and, since launch, the
 *     join rate (JR1), marketing and partner opt-in, invite link clicks.
 *   - Signup geography (E1), drawn inside "Who we reached" beside Meta's.
 *
 * The umbrella page (events.is_umbrella) is its own block in both, never
 * summed into the shows. Invite link clicks are never summed (PA4): they
 * show on a one-page block only.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { partnerOptInShown, type PageAudienceFigures } from "../../cirqlin/page-audience/read.ts";
import { scopesForViews, type PanelShow, type PanelVenue } from "../audience-panels.ts";
import { dayInZone, dayWords, shiftDay } from "./dates.ts";

export type PanelSurface = "internal" | "share";

export type PanelPeriod = "launch" | "30" | "14" | "7" | "3" | "yesterday";

/** The dashboard's periods (SALES_PERIODS), in its order. */
export const PANEL_PERIODS: readonly { id: PanelPeriod; days: number | null }[] = [
  { id: "launch", days: null },
  { id: "30", days: 30 },
  { id: "14", days: 14 },
  { id: "7", days: 7 },
  { id: "3", days: 3 },
  { id: "yesterday", days: 1 },
];

// ── Words ────────────────────────────────────────────────────────────────

/** EV2's section title. */
export const SIGNUPS_TITLE = "Signups & communities";
/** PA7. */
export const SOURCE_LINE = "CIRQLIN · counted signups, spam removed";
/** EV2's step 1. */
export const STEP_SIGNUPS = "1 · Email signups";
/** PA2. */
export const STEP_REACHABLE = "2 · Reachable on WhatsApp";
export const REACHABLE_SUB = "said yes to marketing and left a phone";
export const WHATSAPP_NOT_OFFERED = "WhatsApp isn't offered on this page";
/** HP2: PA2's not-offered state on a block of several pages. */
export const WHATSAPP_NOT_OFFERED_PAGES = "WhatsApp isn't offered on these pages";
/** EV2's step 3. */
export const STEP_COMMUNITY = "3 · Community members";
/** JR1: the fourth tile's title (kept by HP3). */
export const JOIN_RATE_LABEL = "Opt-in → community";
/** JR1: the tile's line. */
export const JOIN_RATE_SUB = "of reachable signups joined";
/** HP1: under the steps, only when step 3 is more than step 2. */
export const JOINED_OVER_REACHABLE = "Joining the community doesn't need a marketing opt-in, so this can be more than step 2.";
/** PA3. */
export const JOINED_SUB = "joined from signups";
export const CIRQLIN_EXACT = "CIRQLIN · exact";
/** HP2: step 2's source. */
export const CIRQLIN = "CIRQLIN";
/** PA1. */
export const MARKETING_LABEL = "Marketing opt-in";
/** PA5. */
export const PARTNER_LABEL = "Partner opt-in";
export const PARTNER_SUB = "agreed to hear from the page's partner promoters";
/** EV1. */
export const GEOGRAPHY_TITLE = "Where your signups are · from your signups";
export const EVERYWHERE_ELSE = "Everywhere else";
export const COULDNT_TELL = "Couldn't tell";
/** PA6. */
export const GEOGRAPHY_WITHHELD = "Signup places don't add up for this read yet";
/** E1: a city is named at 10 or more signups. */
export const CITY_FLOOR = 10;
/** EV1 draws five cities, then "Everywhere else" and "Couldn't tell". */
export const TOP_CITIES = 5;

const CHANNEL_WORDS: Record<string, string> = { email: "email", sms: "SMS", whatsapp: "WhatsApp" };
/** PA1: always in this order. */
const CHANNEL_ORDER = ["email", "sms", "whatsapp"] as const;

/** HP2: "{j} joined {period}" (PA3) with the period as words. */
export const PERIOD_WORDS: Record<Exclude<PanelPeriod, "launch">, string> = {
  "30": "in the last 30 days",
  "14": "in the last 14 days",
  "7": "in the last 7 days",
  "3": "in the last 3 days",
  yesterday: "yesterday",
};

const n = (v: number) => Math.round(v).toLocaleString("en-GB");
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1)} %`;
const pagesWord = (k: number) => (k === 1 ? "1 CIRQLIN page" : `${n(k)} CIRQLIN pages`);

/** PA4 (internal and client view). */
export function inviteClicksLine(clicks: number, shared: boolean, surface: PanelSurface): string | null {
  if (!shared) return `${n(clicks)} invite link clicks · every source`;
  return surface === "internal" ? `${n(clicks)} clicks on an invite shared with other pages` : null;
}

/** PA1: "offered: email · SMS · WhatsApp", the offered channels only, in that order. */
export function offeredLine(channels: Iterable<string>): string | null {
  const set = new Set(channels);
  const named = CHANNEL_ORDER.filter((c) => set.has(c)).map((c) => CHANNEL_WORDS[c]);
  return named.length ? `offered: ${named.join(" · ")}` : null;
}

/** HP2: the umbrella block's heading. */
export function umbrellaHeading(name: string): string {
  return `${name} · its own page, never added to the shows`;
}

/**
 * HP2: the block's scope line. Step 1 carries the source, so the line
 * doesn't repeat it. Shows in scope with no CIRQLIN page are named as a
 * count, so a total never reads as complete when it isn't.
 */
export function scopeLine(label: string, pages: number, fetchDay: string, nowMs: number, showsWithoutPage = 0): string {
  const line = `${label} · ${pagesWord(pages)} · read ${dayWords(fetchDay, nowMs)}`;
  if (showsWithoutPage <= 0) return line;
  return `${line} · ${showsWithoutPage === 1 ? "1 show" : `${n(showsWithoutPage)} shows`} without a CIRQLIN page`;
}

/** HP2: a period whose start no stored read reaches. */
/** JR1's source, with JR3's suffix for pages read before cirqlin #647. */
export function joinRateSource(joinedReachable: number, reachable: number, pagesWithout = 0): string {
  const line = `${CIRQLIN} · ${n(joinedReachable)} of ${n(reachable)} · since launch`;
  if (pagesWithout <= 0) return line;
  return `${line} · ${pagesWithout === 1 ? "1 page" : `${n(pagesWithout)} pages`} without this count yet`;
}

/** JR2: internal only, when a stored read has more joined-and-reachable than reachable. */
export function joinRateOverLine(show: string): string {
  return `Joined-and-reachable is more than reachable on ${show}'s page. Check CIRQLIN's read.`;
}

export function windowNotStored(start: string, nowMs: number): string {
  return `No CIRQLIN read before ${dayWords(start, nowMs)} yet, so this period isn't counted.`;
}

/** HP2: PA6's internal note, naming the page. */
export function geographyNote(pages: readonly string[]): string {
  return `Doesn't add up: ${pages.join(", ")}`;
}

// ── Inputs ───────────────────────────────────────────────────────────────

/** One stored day of a page's all-time counts (a cirqlin_page_audience row). */
export interface PageDayCounts {
  fetchDay: string;
  signups: number;
  consentMarketing: number;
  whatsappWithPhone: number;
  communityJoined: number;
  communityLinkClicks: number;
  partnerOptIn: number;
}

/** HE4's latest entered member count for a show (lib/dashboard/presale/community-headline.ts). */
export interface EnteredMembers {
  members: number;
  countedOn: string;
  entered: { at: string; name: string | null };
}

export interface PageAudiencePanelInput {
  shows: readonly PanelShow[];
  /** Event id → its page's latest figures, shows and umbrellas alike (figures.isUmbrella). */
  pages: ReadonlyMap<string, PageAudienceFigures>;
  /** Page id → its stored days, any order. Only windows read it. */
  history: ReadonlyMap<string, readonly PageDayCounts[]>;
  /** Event id → HE4's entered member count. */
  entered: ReadonlyMap<string, EnteredMembers>;
  clientName: string;
  /** Umbrella events (events.is_umbrella), so one with no page isn't counted as a show without one. */
  umbrellaIds?: ReadonlySet<string>;
}

// ── Models ───────────────────────────────────────────────────────────────

export interface PanelStep {
  id: "signups" | "reachable" | "community" | "rate";
  label: string;
  /** The figure; null on "WhatsApp isn't offered". */
  value: string | null;
  /** The words beside or under the figure. */
  sub: string | null;
  source: string | null;
  /** Further lines on the tile (PA3's joined line, PA4's clicks). */
  lines: string[];
}

export interface SignupsBlock {
  kind: "shows" | "umbrella";
  heading: string | null;
  scopeLine: string;
  /** Set when the period can't be counted; the block then shows only this. */
  notCounted: string | null;
  steps: PanelStep[];
  /** HP1's footnote under the steps, or null. */
  stepsNote: string | null;
  marketing: { line: string; offered: string | null } | null;
  partner: { line: string; sub: string } | null;
  source: string;
}

export interface SignupsPanelModel {
  title: string;
  blocks: SignupsBlock[];
}

export interface GeographyRow {
  label: string;
  value: string;
  kind: "city" | "else" | "unknown";
}

export interface GeographyBlock {
  kind: "shows" | "umbrella";
  heading: string | null;
  rows: GeographyRow[] | null;
  withheld: string | null;
  /** Internal only (PA6). */
  note: string | null;
  footnote: string;
  source: string;
}

export interface GeographyModel {
  title: string;
  blocks: GeographyBlock[];
}

export type SignupsPanelsByView = Record<string, Record<PanelPeriod, SignupsPanelModel>>;
export type GeographyByView = Record<string, GeographyModel>;

// ── Counting ─────────────────────────────────────────────────────────────

type Counts = {
  signups: number;
  marketing: number;
  reachable: number;
  joined: number;
  clicks: number;
  /** PA5 / PB3 per page, summed over the pages that show the row; null when none does. */
  partner: number | null;
};

function countsOf(f: PageAudienceFigures): Counts {
  return {
    signups: f.signups,
    marketing: f.consentMarketing,
    reachable: f.whatsappWithPhone,
    joined: f.communityJoined,
    clicks: f.communityLinkClicks,
    partner: f.partnerOptIn,
  };
}

const ZERO: Counts = { signups: 0, marketing: 0, reachable: 0, joined: 0, clicks: 0, partner: null };

function add(a: Counts, b: Counts): Counts {
  return {
    signups: a.signups + b.signups,
    marketing: a.marketing + b.marketing,
    reachable: a.reachable + b.reachable,
    joined: a.joined + b.joined,
    clicks: a.clicks + b.clicks,
    partner: a.partner == null && b.partner == null ? null : (a.partner ?? 0) + (b.partner ?? 0),
  };
}

/** The period's start day for a page read on `endDay`. */
export function windowStart(endDay: string, days: number): string {
  return shiftDay(endDay, -(days - 1));
}

/**
 * A page's counts inside a window: its latest read minus the latest stored
 * read before the window starts. Null when no stored read is that old.
 * The nightly read is all-time at 23:55 UTC, so a day's row closes that day.
 */
export function windowCounts(f: PageAudienceFigures, history: readonly PageDayCounts[], days: number): Counts | null {
  const start = windowStart(f.fetchDay, days);
  const before = shiftDay(start, -1);
  const base = [...history].filter((r) => r.fetchDay <= before).sort((a, b) => b.fetchDay.localeCompare(a.fetchDay))[0];
  if (!base) return null;
  const d = (now: number, then: number) => Math.max(0, now - then);
  // The partner box is today's form (cirqlin #633), so the latest read decides whether the row shows.
  // figures.partnerOptIn is null only where the row is left out, where the count is 0 or doesn't show.
  const partnerDelta = d(f.partnerOptIn ?? 0, base.partnerOptIn);
  return {
    signups: d(f.signups, base.signups),
    marketing: d(f.consentMarketing, base.consentMarketing),
    reachable: d(f.whatsappWithPhone, base.whatsappWithPhone),
    joined: d(f.communityJoined, base.communityJoined),
    clicks: d(f.communityLinkClicks, base.communityLinkClicks),
    partner: partnerOptInShown(partnerDelta, f.partnerBoxOffered),
  };
}

// ── Blocks ───────────────────────────────────────────────────────────────

type BlockArgs = {
  kind: "shows" | "umbrella";
  heading: string | null;
  label: string;
  /** Shows in scope with no CIRQLIN page (HP2). */
  showsWithoutPage?: number;
  pages: readonly PageAudienceFigures[];
  /** Only a one-page block reads it (PB4: the show's own count). */
  entered: EnteredMembers | null;
  /** Page id → the show's name, for JR2's internal review line. */
  pageNames?: ReadonlyMap<string, string>;
  history: ReadonlyMap<string, readonly PageDayCounts[]>;
  period: PanelPeriod;
  surface: PanelSurface;
  nowMs: number;
};

function latestDay(pages: readonly PageAudienceFigures[]): string {
  return pages.map((p) => p.fetchDay).sort().at(-1) ?? "";
}

/** "entered by {first name}, {date}" (PH2), or "entered {date}"; the share link names no one. */
function enteredSource(e: EnteredMembers, surface: PanelSurface, nowMs: number): string {
  const date = dayWords(dayInZone(e.entered.at), nowMs);
  return surface === "internal" && e.entered.name ? `entered by ${e.entered.name}, ${date}` : `entered ${date}`;
}

export function buildSignupsBlock(a: BlockArgs): SignupsBlock {
  const fetchDay = latestDay(a.pages);
  const base: SignupsBlock = {
    kind: a.kind,
    heading: a.heading,
    scopeLine: scopeLine(a.label, a.pages.length, fetchDay, a.nowMs, a.showsWithoutPage ?? 0),
    notCounted: null,
    steps: [],
    stepsNote: null,
    marketing: null,
    partner: null,
    source: SOURCE_LINE,
  };
  const days = PANEL_PERIODS.find((p) => p.id === a.period)?.days ?? null;
  let counts: Counts = ZERO;
  if (days == null) {
    for (const p of a.pages) counts = add(counts, countsOf(p));
  } else {
    for (const p of a.pages) {
      const w = windowCounts(p, a.history.get(p.pageId) ?? [], days);
      if (!w) return { ...base, notCounted: windowNotStored(windowStart(p.fetchDay, days), a.nowMs) };
      counts = add(counts, w);
    }
  }
  const single = a.pages.length === 1 ? a.pages[0] : null;
  const offers = a.pages.some((p) => p.offersWhatsapp);

  const steps: PanelStep[] = [
    { id: "signups", label: STEP_SIGNUPS, value: n(counts.signups), sub: null, source: SOURCE_LINE, lines: [] },
    offers
      ? { id: "reachable", label: STEP_REACHABLE, value: n(counts.reachable), sub: REACHABLE_SUB, source: CIRQLIN, lines: [] }
      : { id: "reachable", label: STEP_REACHABLE, value: null, sub: single ? WHATSAPP_NOT_OFFERED : WHATSAPP_NOT_OFFERED_PAGES, source: null, lines: [] },
  ];

  const clicks = single ? inviteClicksLine(counts.clicks, single.communityCodeShared, a.surface) : null;
  const tail = clicks ? [clicks] : [];
  if (days != null) {
    // PA3: no join rate in a window; the tile says who joined in it.
    const words = PERIOD_WORDS[a.period as Exclude<PanelPeriod, "launch">];
    steps.push({ id: "community", label: STEP_COMMUNITY, value: n(counts.joined), sub: `joined ${words}`, source: CIRQLIN_EXACT, lines: tail });
  } else if (single && a.entered) {
    // PA3's first source, then CIRQLIN's joins under it. Never the join rate's numerator.
    steps.push({
      id: "community",
      label: STEP_COMMUNITY,
      value: n(a.entered.members),
      sub: "members",
      source: enteredSource(a.entered, a.surface, a.nowMs),
      lines: [`${n(counts.joined)} joined from signups · CIRQLIN`, ...tail],
    });
  } else {
    steps.push({ id: "community", label: STEP_COMMUNITY, value: n(counts.joined), sub: JOINED_SUB, source: CIRQLIN_EXACT, lines: tail });
  }
  // HP1 / JR4: step 3 counts every joiner, most of whom said no to marketing, so it can pass
  // step 2; the footnote says why. The rate tile counts only the reachable joiners.
  const stepThree = days == null && single && a.entered ? a.entered.members : counts.joined;
  const stepsNote = offers && stepThree > counts.reachable ? JOINED_OVER_REACHABLE : null;

  // JR1–JR3: since launch only.
  if (days == null) {
    const rate = joinRateStep(a.pages, a.surface, a.pageNames);
    if (rate) steps.push(rate);
  }

  const offered = offeredLine(a.pages.flatMap((p) => p.channelsOffered));
  const marketing = {
    line: counts.signups > 0 ? `${MARKETING_LABEL} · ${n(counts.marketing)} · ${pct(counts.marketing, counts.signups)} of signups` : `${MARKETING_LABEL} · ${n(counts.marketing)}`,
    offered,
  };
  const partner = counts.partner == null ? null : { line: `${PARTNER_LABEL} · ${n(counts.partner)}`, sub: PARTNER_SUB };
  return { ...base, steps, stepsNote, marketing, partner };
}

/**
 * JR1–JR3: the summed joined-and-reachable over the summed reachable, all
 * time. Pages that don't offer WhatsApp add nothing; a page read before
 * cirqlin #647 (no count) is left out of both and named in the suffix.
 * Null when nothing counted is reachable. Capped at 100 %; internal views
 * name the page whose read passes it.
 */
export function joinRateStep(pages: readonly PageAudienceFigures[], surface: PanelSurface, pageNames?: ReadonlyMap<string, string>): PanelStep | null {
  let joinedReachable = 0;
  let reachable = 0;
  let without = 0;
  const over: string[] = [];
  for (const p of pages) {
    if (!p.offersWhatsapp) continue;
    if (p.communityJoinedReachable == null) {
      without += 1;
      continue;
    }
    joinedReachable += p.communityJoinedReachable;
    reachable += p.whatsappWithPhone;
    if (p.communityJoinedReachable > p.whatsappWithPhone) over.push(pageNames?.get(p.pageId) ?? "—");
  }
  if (reachable <= 0) return null;
  return {
    id: "rate",
    label: JOIN_RATE_LABEL,
    value: pct(Math.min(joinedReachable, reachable), reachable),
    sub: JOIN_RATE_SUB,
    source: joinRateSource(joinedReachable, reachable, without),
    lines: surface === "internal" ? over.map(joinRateOverLine) : [],
  };
}

/** A page's geography adds up when its named cities, everywhere else and couldn't tell make its signups (PA6). */
export function geographyAddsUp(f: PageAudienceFigures): boolean {
  const named = f.geography.cities.reduce((s, c) => s + c.signups, 0);
  return named + f.geography.everywhereElse + f.geography.couldntTell === f.signups;
}

type GeoArgs = {
  kind: "shows" | "umbrella";
  heading: string | null;
  label: string;
  pages: readonly PageAudienceFigures[];
  pageNames: ReadonlyMap<string, string>;
  surface: PanelSurface;
  nowMs: number;
};

export function buildGeographyBlock(a: GeoArgs): GeographyBlock {
  const signups = a.pages.reduce((s, p) => s + p.signups, 0);
  const footnote = `${a.label} · ${n(signups)} signups on ${pagesWord(a.pages.length)} · read ${dayWords(latestDay(a.pages), a.nowMs)} · city as the network reported it · no page asks for age yet`;
  const broken = a.pages.filter((p) => !geographyAddsUp(p));
  if (broken.length) {
    return {
      kind: a.kind,
      heading: a.heading,
      rows: null,
      withheld: GEOGRAPHY_WITHHELD,
      note: a.surface === "internal" ? geographyNote(broken.map((p) => a.pageNames.get(p.pageId) ?? p.pageId)) : null,
      footnote,
      source: SOURCE_LINE,
    };
  }
  const cities = new Map<string, { name: string; signups: number }>();
  let couldntTell = 0;
  for (const p of a.pages) {
    couldntTell += p.geography.couldntTell;
    for (const c of p.geography.cities) {
      if (c.signups < CITY_FLOOR) continue; // CIRQLIN never names one below the floor; the rest stays in everywhere else.
      const key = `${c.name}\u0000${c.country ?? ""}`;
      const got = cities.get(key) ?? { name: c.name, signups: 0 };
      got.signups += c.signups;
      cities.set(key, got);
    }
  }
  const top = [...cities.values()].sort((x, y) => y.signups - x.signups || x.name.localeCompare(y.name)).slice(0, TOP_CITIES);
  const named = top.reduce((s, c) => s + c.signups, 0);
  const rows: GeographyRow[] = [
    ...top.map((c) => ({ label: c.name, value: n(c.signups), kind: "city" as const })),
    { label: EVERYWHERE_ELSE, value: n(signups - named - couldntTell), kind: "else" },
    { label: COULDNT_TELL, value: n(couldntTell), kind: "unknown" },
  ];
  return { kind: a.kind, heading: a.heading, rows, withheld: null, note: null, footnote, source: SOURCE_LINE };
}

// ── Views ────────────────────────────────────────────────────────────────

type ViewPages = {
  label: string;
  shows: PageAudienceFigures[];
  umbrellas: { name: string; figures: PageAudienceFigures }[];
  /** HP2: shows in scope (umbrellas aside) with no stored CIRQLIN page read. */
  showsWithoutPage: number;
};

function pagesForViews(input: PageAudiencePanelInput, view: { viewIds: readonly string[]; venues: readonly PanelVenue[] }): Map<string, ViewPages> {
  const names = new Map(input.shows.map((s) => [s.id, s.name]));
  const out = new Map<string, ViewPages>();
  for (const [viewId, scope] of scopesForViews(view.viewIds, view.venues, input.shows, input.clientName)) {
    const shows: PageAudienceFigures[] = [];
    const umbrellas: ViewPages["umbrellas"] = [];
    let showsWithoutPage = 0;
    for (const id of scope.eventIds) {
      const f = input.pages.get(id);
      if (!f) {
        if (!input.umbrellaIds?.has(id)) showsWithoutPage += 1;
        continue;
      }
      if (f.isUmbrella) umbrellas.push({ name: names.get(id) ?? "—", figures: f });
      else shows.push(f);
    }
    if (shows.length || umbrellas.length) out.set(viewId, { label: scope.d2c.label, shows, umbrellas, showsWithoutPage });
  }
  return out;
}

export function buildSignupsPanels(
  input: PageAudiencePanelInput,
  view: { viewIds: readonly string[]; venues: readonly PanelVenue[] },
  surface: PanelSurface,
  nowMs: number,
): SignupsPanelsByView {
  const names = new Map(input.shows.map((s) => [s.id, s.name]));
  const pageNames = new Map<string, string>();
  for (const [eventId, f] of input.pages) pageNames.set(f.pageId, names.get(eventId) ?? "—");
  const out: SignupsPanelsByView = {};
  for (const [viewId, v] of pagesForViews(input, view)) {
    const byPeriod = {} as Record<PanelPeriod, SignupsPanelModel>;
    for (const { id: period } of PANEL_PERIODS) {
      const blocks: SignupsBlock[] = [];
      if (v.shows.length) {
        const entered = v.shows.length === 1 ? input.entered.get(v.shows[0]!.eventId) ?? null : null;
        blocks.push(
          buildSignupsBlock({ kind: "shows", heading: null, label: v.label, showsWithoutPage: v.showsWithoutPage, pages: v.shows, entered, pageNames, history: input.history, period, surface, nowMs }),
        );
      }
      for (const u of v.umbrellas) {
        blocks.push(
          buildSignupsBlock({
            kind: "umbrella",
            heading: umbrellaHeading(u.name),
            label: u.name,
            pages: [u.figures],
            entered: input.entered.get(u.figures.eventId) ?? null,
            pageNames,
            history: input.history,
            period,
            surface,
            nowMs,
          }),
        );
      }
      byPeriod[period] = { title: SIGNUPS_TITLE, blocks };
    }
    out[viewId] = byPeriod;
  }
  return out;
}

export function buildGeography(
  input: PageAudiencePanelInput,
  view: { viewIds: readonly string[]; venues: readonly PanelVenue[] },
  surface: PanelSurface,
  nowMs: number,
): GeographyByView {
  const names = new Map(input.shows.map((s) => [s.id, s.name]));
  const pageNames = new Map<string, string>();
  for (const [eventId, f] of input.pages) pageNames.set(f.pageId, `${names.get(eventId) ?? "—"}'s page`);
  const out: GeographyByView = {};
  for (const [viewId, v] of pagesForViews(input, view)) {
    const blocks: GeographyBlock[] = [];
    if (v.shows.length) blocks.push(buildGeographyBlock({ kind: "shows", heading: null, label: v.label, pages: v.shows, pageNames, surface, nowMs }));
    for (const u of v.umbrellas) {
      blocks.push(buildGeographyBlock({ kind: "umbrella", heading: umbrellaHeading(u.name), label: u.name, pages: [u.figures], pageNames, surface, nowMs }));
    }
    out[viewId] = { title: GEOGRAPHY_TITLE, blocks };
  }
  return out;
}

export function pickPanelPeriod(period: string | null | undefined, fallback: PanelPeriod): PanelPeriod {
  return PANEL_PERIODS.some((p) => p.id === period) ? (period as PanelPeriod) : fallback;
}
