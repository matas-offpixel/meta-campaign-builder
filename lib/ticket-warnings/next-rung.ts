import { countdownRung, lineupRung, percentStandIn, priceRiseRung, velocityRung, type CountRead } from "../releases/derived.ts";
import { isBackfilled } from "../releases/visibility.ts";
import { rollCallWords } from "../releases/roll-call.ts";
import type { LadderRung, Release } from "../releases/types.ts";
import { daysBetween } from "../releases/dates.ts";

export type DerivedContext = {
  counts?: readonly CountRead[];
  nextListAt?: string | null;
  eventAt?: string | null;
  artists?: readonly { name: string; addedAt: string }[];
  lastProposalAt?: string | null;
  /** Days the selling-fast state rung waits before it stands in for 90%. */
  sellingFastDays?: number | null;
};

export type RungResult = {
  claim: string;
  triggerKind: LadderRung["triggerKind"];
  triggerValue: string;
  met: boolean;
  /** True when the rung can no longer come true. Distinct from unmet. */
  ended: boolean;
  because: string;
};

export type RungStanding = "met" | "unmet" | "ended";

/** A settled warning that already ran. The panel keeps it after the rung ends. */
export type RanRung = {
  releaseId: string | null;
  claim: string;
  state: string;
  ranAt: string | null;
};

export type PanelClaim = {
  text: string;
  chip: string;
  tone: "ok" | "dash";
  needs: string | null;
  kind: "done" | "now" | "later";
};

const PAST_ON_SALE = new Set(["on_sale", "selling_fast", "final_x", "sold_out"]);

function percent(release: Release): number | null {
  if (release.capacity == null || release.capacity <= 0 || release.sold == null) return null;
  return (release.sold / release.capacity) * 100;
}

function fill(template: string, release: Release): string {
  return template.replaceAll("{release}", release.name);
}

const DERIVED = new Set(["velocity", "price_rise_date", "countdown_pct", "lineup_add"]);

function isRoll(rung: LadderRung): boolean {
  return rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call";
}

function isDerived(rung: LadderRung): boolean {
  return DERIVED.has(rung.triggerKind);
}

function countdownMet(release: Release, nowIso: string, context: DerivedContext): { pct: boolean; standIn: boolean } {
  const pct = percent(release);
  return {
    pct: (pct != null && pct >= 90) || release.state === "final_x",
    standIn: percentStandIn(release, nowIso, context.sellingFastDays ?? null),
  };
}

function roster(release: Release, siblings: readonly Release[]): Release[] {
  return siblings.some((row) => row.id === release.id) ? [...siblings] : [...siblings, release];
}

/**
 * A rung that can no longer come true. Rung 1 ("{release} live") has ended
 * once a later release's list time has passed. Other kinds are not ended;
 * a later ruling can add one here without a second copy of this test.
 */
export function rungHasEnded(
  rung: Pick<LadderRung, "triggerKind" | "triggerValue">,
  release: Release,
  siblings: readonly Release[],
  nowIso: string,
): boolean {
  if (rung.triggerKind === "state" && rung.triggerValue === "on_sale") {
    const latest = latestListed(roster(release, siblings), nowIso);
    return latest != null && latest.id !== release.id;
  }
  return false;
}

/** The latest release whose list time has passed. Rung 1 belongs to this one only. */
function latestListed(rows: readonly Release[], nowIso: string): Release | null {
  const now = Date.parse(nowIso);
  const passed = rows.filter((row) => row.listAt != null && Date.parse(row.listAt) <= now);
  if (!passed.length) return null;
  return [...passed].sort((a, b) => Date.parse(b.listAt!) - Date.parse(a.listAt!) || b.position - a.position)[0]!;
}

function earlierAllSoldOut(release: Release, rows: readonly Release[]): boolean {
  const earlier = rows.filter((row) => row.position < release.position);
  return earlier.length > 0 && earlier.every((row) => row.state === "sold_out");
}

function claimText(rung: LadderRung, release: Release, siblings: readonly Release[], nowIso: string, context: DerivedContext, ladder: readonly LadderRung[]): string {
  if (isRoll(rung)) return rollCallWords(siblings, { ladder, nowIso }).claim;
  if (rung.triggerKind === "velocity") {
    return velocityRung(context.counts ?? [], nowIso, rung.options.windowDays ?? 14, rung.options.threshold ?? Number(rung.triggerValue)).claim;
  }
  if (rung.triggerKind === "price_rise_date") {
    return priceRiseRung(nowIso, context.nextListAt ?? null, release.price, rung.options.days ?? 4).claim ?? rung.claimTemplate;
  }
  if (rung.triggerKind === "countdown_pct") {
    const half = countdownMet(release, nowIso, context);
    return countdownRung(nowIso, context.eventAt ?? null, half.pct, rung.options.days ?? 14, half.standIn).claim;
  }
  if (rung.triggerKind === "lineup_add") {
    return lineupRung(context.artists ?? [], context.lastProposalAt ?? null).claim ?? rung.claimTemplate;
  }
  if (rung.triggerValue === "selling_fast" && rung.options.wording === "final_x" && rung.options.alt) {
    return fill(rung.options.alt, release);
  }
  if (rung.triggerValue === "90" && rung.options.wording === "final_x") return rung.options.alt ?? "final X";
  if (rung.triggerValue === "final_x") {
    const left = release.remaining ?? (release.capacity != null && release.sold != null ? release.capacity - release.sold : null);
    return left != null ? `final ${left}` : "final X";
  }
  return fill(rung.claimTemplate, release);
}

function met(rung: LadderRung, release: Release, siblings: readonly Release[], nowIso: string, context: DerivedContext): boolean {
  const pct = percent(release);
  if (rung.triggerKind === "velocity") {
    return velocityRung(context.counts ?? [], nowIso, rung.options.windowDays ?? 14, rung.options.threshold ?? Number(rung.triggerValue)).met;
  }
  if (rung.triggerKind === "price_rise_date") {
    return priceRiseRung(nowIso, context.nextListAt ?? null, release.price, rung.options.days ?? 4).met;
  }
  if (rung.triggerKind === "countdown_pct") {
    const half = countdownMet(release, nowIso, context);
    return countdownRung(nowIso, context.eventAt ?? null, half.pct, rung.options.days ?? 14, half.standIn).met;
  }
  if (rung.triggerKind === "lineup_add") return lineupRung(context.artists ?? [], context.lastProposalAt ?? null).met;
  if (rung.triggerKind === "count_pct") return pct != null && pct >= Number(rung.triggerValue);
  if (rung.triggerKind === "page_remaining") {
    return release.remaining != null && release.remaining <= Number(rung.triggerValue);
  }
  if (rung.triggerKind === "state_days") {
    if (release.sold != null) return false;
    if (release.state !== "selling_fast" && release.state !== "final_x") return false;
    if (!release.stateAt) return false;
    return daysBetween(release.stateAt, nowIso) >= (rung.options.days ?? 14);
  }
  if (rung.triggerKind === "state" && rung.triggerValue === "on_sale") {
    if (release.state !== "on_sale") return false;
    const latest = latestListed(roster(release, siblings), nowIso);
    return latest?.id === release.id;
  }
  if (rung.triggerKind === "state" && rung.triggerValue === "selling_fast") {
    if (release.state === "selling_fast") return true;
    if (release.state !== "on_sale") return false;
    return earlierAllSoldOut(release, roster(release, siblings));
  }
  if (rung.triggerValue === "on_sale") return PAST_ON_SALE.has(release.state);
  if (rung.triggerValue === "final_x") return release.state === "final_x";
  if (rung.triggerValue === "sold_out") return release.state === "sold_out";
  if (isRoll(rung)) return rollCallWords(siblings).met;
  return false;
}

function because(rung: LadderRung, release: Release, siblings: readonly Release[], isMet: boolean, nowIso: string, context: DerivedContext): string {
  if (isRoll(rung)) return rollCallWords(siblings).because;
  if (rung.triggerKind === "velocity") {
    return velocityRung(context.counts ?? [], nowIso, rung.options.windowDays ?? 14, rung.options.threshold ?? Number(rung.triggerValue)).because;
  }
  if (rung.triggerKind === "count_pct") return isMet ? `count at ${rung.triggerValue}%` : `needs a count at ${rung.triggerValue}%`;
  if (rung.triggerKind === "state_days") {
    const days = rung.options.days ?? 14;
    return isMet ? `selling fast for ${days}+ days, no count` : `needs selling fast for ${days}+ days`;
  }
  if (rung.triggerKind === "state" && rung.triggerValue === "selling_fast") {
    return isMet ? "selling fast" : "needs selling fast, or every earlier release sold out";
  }
  if (rung.triggerKind === "state" && rung.triggerValue === "on_sale") {
    return isMet ? "on sale" : "needs the latest release that has gone live";
  }
  if (rung.triggerValue === "final_x") return isMet ? "final X" : "needs the release at final X, or a count at 90%+";
  if (rung.triggerValue === "on_sale") return isMet ? "on sale" : "needs the list time";
  if (rung.triggerValue === "sold_out") return isMet ? "sold out" : "needs sold out";
  return isMet ? "the page shows remaining" : "needs a remaining figure";
}

/**
 * The rung this release may say now. The roll-call wins, on the one live
 * release (on sale, selling fast, or final X), when two or more are sold out.
 * Otherwise the furthest met % or state rung. Derived rungs are event-level
 * and never take a release's mark. An ended rung is not unmet: it is skipped,
 * and the next rung that can still come true is the one returned. When every
 * such rung has ended, that ended rung is returned with ended set.
 */
export function nextRung(
  release: Release,
  ladder: readonly LadderRung[],
  siblings: readonly Release[],
  nowIso: string,
  context: DerivedContext = {},
): RungResult | null {
  if (isBackfilled(release)) return null;
  const ordered = [...ladder].sort((a, b) => a.position - b.position);
  const evaluated = ordered.map((rung) => {
    const ended = rungHasEnded(rung, release, siblings, nowIso);
    const isMet = !ended && met(rung, release, siblings, nowIso, context);
    return { rung, isMet, ended, claim: claimText(rung, release, siblings, nowIso, context, ladder) };
  });
  const live = release.state === "on_sale" || release.state === "selling_fast" || release.state === "final_x";
  const roll = evaluated.find((row) => isRoll(row.rung) && row.isMet && row.rung.options.preferred !== false);
  if (roll && live) {
    return {
      claim: roll.claim,
      triggerKind: roll.rung.triggerKind,
      triggerValue: roll.rung.triggerValue,
      met: true,
      ended: false,
      because: because(roll.rung, release, siblings, true, nowIso, context),
    };
  }
  const open = (row: { rung: LadderRung; ended: boolean }) => !isRoll(row.rung) && !isDerived(row.rung) && !row.ended;
  const reached = evaluated.filter((row) => row.isMet && open(row));
  const pick = reached.length ? reached[reached.length - 1] : evaluated.find((row) => open(row));
  const chosen = pick ?? evaluated.find((row) => row.ended && !isRoll(row.rung) && !isDerived(row.rung));
  if (!chosen) return null;
  return {
    claim: chosen.claim,
    triggerKind: chosen.rung.triggerKind,
    triggerValue: chosen.rung.triggerValue,
    met: chosen.isMet,
    ended: !pick,
    because: because(chosen.rung, release, siblings, chosen.isMet, nowIso, context),
  };
}

/** Days the selling-fast rung waits before it stands in for 90%. */
export function sellingFastDays(ladder: readonly LadderRung[]): number | null {
  const rung = ladder.find((row) => row.triggerKind === "state_days" && row.triggerValue === "selling_fast");
  return rung ? (rung.options.days ?? 14) : null;
}

/**
 * Derived rungs are proposals for the event, not a mark on one release.
 * Velocity uses the event's counts. Price rise uses the next list time.
 * Countdown uses the show date and any release at 90%+, final X, or the
 * selling-fast stand-in. Lineup uses the artist added most recently.
 */
export function derivedProposals(
  ladder: readonly LadderRung[],
  releases: readonly Release[],
  nowIso: string,
  context: DerivedContext,
): RungResult[] {
  const anchor = releases.find((release) => release.state === "on_sale" || release.state === "selling_fast" || release.state === "final_x") ?? releases[0];
  if (!anchor) return [];
  const days = context.sellingFastDays ?? sellingFastDays(ladder);
  const pct = releases.some((release) => {
    const share = percent(release);
    return (share != null && share >= 90) || release.state === "final_x";
  });
  const standIn = releases.some((release) => percentStandIn(release, nowIso, days));
  return ladder.filter(isDerived).flatMap((rung) => {
    if (rung.triggerKind === "velocity") {
      const result = velocityRung(context.counts ?? [], nowIso, rung.options.windowDays ?? 14, rung.options.threshold ?? Number(rung.triggerValue));
      if (!result.met || !result.claim) return [];
      return [row(rung, result.claim, result.because)];
    }
    if (rung.triggerKind === "price_rise_date") {
      const result = priceRiseRung(nowIso, context.nextListAt ?? null, anchor.price, rung.options.days ?? 4);
      if (!result.met || !result.claim) return [];
      return [row(rung, result.claim, "the next release lists inside the window")];
    }
    if (rung.triggerKind === "countdown_pct") {
      const result = countdownRung(nowIso, context.eventAt ?? null, pct, rung.options.days ?? 14, standIn);
      if (!result.met) return [];
      return [row(rung, result.claim, "within the window, and the % rung")];
    }
    const result = lineupRung(context.artists ?? [], context.lastProposalAt ?? null);
    if (!result.met || !result.claim) return [];
    return [row(rung, result.claim, result.artist ? `${result.artist} added` : "a lineup row was added")];
  });
}

function row(rung: LadderRung, claim: string, why: string): RungResult {
  return { claim, triggerKind: rung.triggerKind, triggerValue: rung.triggerValue, met: true, ended: false, because: why };
}

const RAN = new Set(["approved", "scheduled", "live", "done"]);

function ranChip(iso: string | null): string {
  if (!iso) return "done";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "done";
  const label = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }).format(date);
  return `ran ${label}`;
}

function belongsTo(past: RanRung, release: Release): boolean {
  if (past.releaseId) return past.releaseId === release.id;
  return past.claim === release.name || past.claim.startsWith(`${release.name} `);
}

function panelNeeds(rung: RungResult): string | null {
  if (rung.triggerKind === "state" && rung.triggerValue === "selling_fast") return "needs selling fast";
  return rung.because.startsWith("needs ") ? rung.because : null;
}

/**
 * One release's claims for the panel. Done rungs that already ran stay,
 * including after a later release goes live. Then the next rung that can
 * still come true. An ended rung is left out, and is never shown as later.
 */
export function claimPanel(
  releases: readonly Release[],
  ladder: readonly LadderRung[],
  nowIso: string,
  context: DerivedContext = {},
  history: readonly RanRung[] = [],
): PanelClaim[] {
  const nowRows: PanelClaim[] = [];
  const laterRows: PanelClaim[] = [];
  for (const release of releases) {
    if (isBackfilled(release)) continue;
    const ran = history.filter((past) => RAN.has(past.state) && belongsTo(past, release));
    for (const past of ran) {
      nowRows.push({ text: past.claim, chip: ranChip(past.ranAt), tone: "ok", needs: null, kind: "done" });
    }
    const rung = nextRung(release, ladder, releases, nowIso, context);
    if (!rung || rung.ended) continue;
    if (ran.some((past) => past.claim === rung.claim)) continue;
    const row: PanelClaim = {
      text: rung.claim,
      chip: rung.met ? "met" : "later",
      tone: rung.met ? "ok" : "dash",
      needs: rung.met ? null : panelNeeds(rung),
      kind: rung.met ? "now" : "later",
    };
    if (rung.met) nowRows.push(row);
    else laterRows.push(row);
  }
  return [...nowRows, ...laterRows];
}

/** A proposal exists only when the met rung's words differ from the last one. */
export function proposalOnChange(previousClaim: string | null, rung: RungResult | null): { propose: boolean; claim: string | null } {
  if (!rung?.met) return { propose: false, claim: rung?.claim ?? null };
  if (rung.claim === previousClaim) return { propose: false, claim: rung.claim };
  return { propose: true, claim: rung.claim };
}
