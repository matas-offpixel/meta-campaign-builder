import type { LadderRung, Release } from "../releases/types.ts";
import { daysBetween } from "../releases/dates.ts";

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

function rollCall(siblings: readonly Release[]): { met: boolean; claim: string } {
  const sold = siblings.filter((release) => release.state === "sold_out");
  const live = siblings.find((release) => release.state === "on_sale");
  const met = sold.length >= 2 && live != null;
  const line1 = `${sold.map((release) => release.name).join(" · ")} SOLD OUT`;
  const line2 = live ? `${live.name} live · selling fast` : "";
  return { met, claim: line2 ? `${line1}\n${line2}` : line1 };
}

function claimText(rung: LadderRung, release: Release, siblings: readonly Release[]): string {
  if (rung.triggerValue === "roll_call") return rollCall(siblings).claim;
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

function met(rung: LadderRung, release: Release, siblings: readonly Release[], nowIso: string): boolean {
  const pct = percent(release);
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
  if (rung.triggerValue === "roll_call") return rollCall(siblings).met;
  return false;
}

function because(rung: LadderRung, release: Release, isMet: boolean): string {
  if (rung.triggerValue === "roll_call") return isMet ? "two releases sold out and one on sale" : "needs two sold out and one on sale";
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
): RungResult | null {
  const ordered = [...ladder].sort((a, b) => a.position - b.position);
  const evaluated = ordered.map((rung) => {
    const isMet = met(rung, release, siblings, nowIso);
    return { rung, isMet, claim: claimText(rung, release, siblings) };
  });
  const roll = evaluated.find((row) => row.rung.triggerValue === "roll_call" && row.isMet && row.rung.options.preferred !== false);
  if (roll && release.state === "on_sale") {
    return { claim: roll.claim, triggerKind: roll.rung.triggerKind, triggerValue: roll.rung.triggerValue, met: true, because: because(roll.rung, release, true) };
  }
  const reached = evaluated.filter((row) => row.isMet && row.rung.triggerValue !== "roll_call");
  const pick = reached.length ? reached[reached.length - 1] : evaluated.find((row) => row.rung.triggerValue !== "roll_call");
  if (!pick) return null;
  return {
    claim: pick.claim,
    triggerKind: pick.rung.triggerKind,
    triggerValue: pick.rung.triggerValue,
    met: pick.isMet,
    because: because(pick.rung, release, pick.isMet),
  };
}

/** A proposal exists only when the met rung's words differ from the last one. */
export function proposalOnChange(previousClaim: string | null, rung: RungResult | null): { propose: boolean; claim: string | null } {
  if (!rung?.met) return { propose: false, claim: rung?.claim ?? null };
  if (rung.claim === previousClaim) return { propose: false, claim: rung.claim };
  return { propose: true, claim: rung.claim };
}
