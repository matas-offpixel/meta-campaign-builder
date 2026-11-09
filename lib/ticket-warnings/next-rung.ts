import { countdownRung, lineupRung, priceRiseRung, velocityRung, type CountRead } from "../releases/derived.ts";
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
};

export type RungResult = {
  claim: string;
  triggerKind: LadderRung["triggerKind"];
  triggerValue: string;
  met: boolean;
  because: string;
};

const PAST_ON_SALE = new Set(["on_sale", "selling_fast", "final_x", "sold_out"]);

function percent(release: Release): number | null {
  if (release.capacity == null || release.capacity <= 0 || release.sold == null) return null;
  return (release.sold / release.capacity) * 100;
}

function fill(template: string, release: Release): string {
  return template.replaceAll("{release}", release.name);
}

function isRoll(rung: LadderRung): boolean {
  return rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call";
}

function claimText(rung: LadderRung, release: Release, siblings: readonly Release[], nowIso: string, context: DerivedContext): string {
  if (isRoll(rung)) return rollCallWords(siblings).claim;
  if (rung.triggerKind === "velocity") {
    return velocityRung(context.counts ?? [], nowIso, rung.options.windowDays ?? 14, rung.options.threshold ?? Number(rung.triggerValue)).claim;
  }
  if (rung.triggerKind === "price_rise_date") {
    return priceRiseRung(nowIso, context.nextListAt ?? null, release.price, rung.options.days ?? 4).claim ?? rung.claimTemplate;
  }
  if (rung.triggerKind === "countdown_pct") {
    const pctMet = percent(release) != null && (percent(release) ?? 0) >= 90;
    return countdownRung(nowIso, context.eventAt ?? null, pctMet || release.state === "final_x", rung.options.days ?? 14).claim;
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
    return countdownRung(nowIso, context.eventAt ?? null, (pct != null && pct >= 90) || release.state === "final_x", rung.options.days ?? 14).met;
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
    return daysBetween(release.stateAt, nowIso) >= (rung.options.days ?? 7);
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
    const days = rung.options.days ?? 7;
    return isMet ? `selling fast for ${days}+ days, no count` : `needs selling fast for ${days}+ days`;
  }
  if (rung.triggerValue === "final_x") return isMet ? "final X" : "needs the release at final X, or a count at 90%+";
  if (rung.triggerValue === "on_sale") return isMet ? "on sale" : "needs the list time";
  if (rung.triggerValue === "sold_out") return isMet ? "sold out" : "needs sold out";
  return isMet ? "the page shows remaining" : "needs a remaining figure";
}

/**
 * The rung this release may say now. The roll-call wins, on the release that
 * is on sale, when two or more are sold out. Otherwise the furthest met rung.
 * When nothing is met, the first rung, marked unmet, so the timeline can show
 * what is next.
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
    const isMet = met(rung, release, siblings, nowIso, context);
    return { rung, isMet, claim: claimText(rung, release, siblings, nowIso, context) };
  });
  const live = release.state === "on_sale" || release.state === "selling_fast";
  const roll = evaluated.find((row) => isRoll(row.rung) && row.isMet && row.rung.options.preferred !== false);
  if (roll && live) {
    return {
      claim: roll.claim,
      triggerKind: roll.rung.triggerKind,
      triggerValue: roll.rung.triggerValue,
      met: true,
      because: because(roll.rung, release, siblings, true, nowIso, context),
    };
  }
  const reached = evaluated.filter((row) => row.isMet && !isRoll(row.rung));
  const pick = reached.length ? reached[reached.length - 1] : evaluated.find((row) => !isRoll(row.rung));
  if (!pick) return null;
  return {
    claim: pick.claim,
    triggerKind: pick.rung.triggerKind,
    triggerValue: pick.rung.triggerValue,
    met: pick.isMet,
    because: because(pick.rung, release, siblings, pick.isMet, nowIso, context),
  };
}

/** A proposal exists only when the met rung's words differ from the last one. */
export function proposalOnChange(previousClaim: string | null, rung: RungResult | null): { propose: boolean; claim: string | null } {
  if (!rung?.met) return { propose: false, claim: rung?.claim ?? null };
  if (rung.claim === previousClaim) return { propose: false, claim: rung.claim };
  return { propose: true, claim: rung.claim };
}
