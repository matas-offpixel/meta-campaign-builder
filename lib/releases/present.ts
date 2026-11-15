import { SELLING_FAST_DEFAULT_DAYS } from "./ladder.ts";
import type { LadderRung } from "./types.ts";

export type PresentedRung = {
  trigger: string;
  claim: string;
  detail?: string;
  narrowDetail?: string;
  note?: string;
  mark?: "new";
  accent?: boolean;
};

function claimCell(rung: LadderRung): string {
  if (rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call") {
    return "\"{sold-out releases} RELEASE SOLD OUT\" / \"{live release} SELLING FAST\"";
  }
  if (rung.triggerKind === "countdown_pct") return "\"LESS THAN 2 WEEKS TO GO\" / \"OVER 90% SOLD OUT\"";
  return `"${rung.claimTemplate}"`;
}

function triggerLabel(rung: LadderRung): string {
  if (rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call") return "2+ releases sold out · 1 on sale or selling fast";
  if (rung.triggerKind === "velocity") return `Sold now − sold ${rung.options.windowDays ?? 14} days ago ≥ ${rung.options.threshold ?? rung.triggerValue}`;
  if (rung.triggerKind === "price_rise_date") return `Next release's list time within ${rung.options.days ?? 4} days`;
  if (rung.triggerKind === "countdown_pct") return `Days to show ≤ ${rung.options.days ?? 14} · and the % rung's trigger met`;
  if (rung.triggerKind === "lineup_add") return "A new row in the typed lineup";
  if (rung.triggerKind === "count_pct") return `Actual ${rung.triggerValue}% sold`;
  if (rung.triggerKind === "state" && rung.triggerValue === "on_sale") return "Release list time passed · state on sale";
  if (rung.triggerKind === "state" && rung.triggerValue === "selling_fast") {
    return "State selling fast · or on sale with every earlier release sold out";
  }
  if (rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast") {
    const days = rung.options.days ?? SELLING_FAST_DEFAULT_DAYS;
    return `Selling fast for ${days}+ days, no count`;
  }
  if (rung.triggerValue === "final_x") return "State final X";
  if (rung.triggerValue === "sold_out") return "State sold out";
  if (rung.triggerKind === "page_remaining") return "The page shows remaining";
  return rung.claimTemplate;
}

function withDetail(detail: string): Pick<PresentedRung, "detail" | "narrowDetail"> {
  return { detail, narrowDetail: detail };
}

/** The record's sub-lines, on the live rung they describe. Both widths show them. */
function rungCopy(rung: LadderRung, clientName?: string): Pick<PresentedRung, "detail" | "narrowDetail" | "note" | "mark" | "accent"> {
  if (rung.triggerKind === "state" && rung.triggerValue === "on_sale") return withDetail("only the latest release that has gone live");
  if (rung.triggerKind === "state" && rung.triggerValue === "selling_fast") {
    return { ...withDetail("day 0 · 2+ earlier sold out → the roll-call is preferred"), mark: "new" };
  }
  if (rung.triggerKind === "state_days" && rung.triggerValue === "selling_fast") {
    const days = rung.options.days ?? SELLING_FAST_DEFAULT_DAYS;
    const alt = rung.options.alt ?? "final X {release} tickets";
    const daysLine = days === SELLING_FAST_DEFAULT_DAYS
      ? withDetail("the default")
      : withDetail(`${clientName?.trim() || "This client"}: ${days} days (default ${SELLING_FAST_DEFAULT_DAYS})`);
    return { ...daysLine, note: `"${alt}" is the other option` };
  }
  if (rung.triggerKind === "count_pct" && rung.triggerValue === "50") return withDetail("when a count and a capacity exist");
  if (rung.triggerValue === "final_x") return { note: "X from the page or the count, never typed" };
  if (rung.triggerKind === "roll_call" || rung.triggerValue === "roll_call") {
    return {
      ...withDetail("roll-call · preferred over the % rung and over rung 2"),
      note: "two lines · the names from the releases, in order · line 2 is the live release's highest met rung — never lower than selling fast",
      accent: true,
    };
  }
  if (rung.triggerKind === "velocity") return withDetail("sales velocity · needs two counts · window and count per client");
  if (rung.triggerKind === "price_rise_date") {
    return {
      ...withDetail("price increase on a date"),
      note: "qualifier \"LAST CHANCE AT £{n}\" when the release has a price",
    };
  }
  if (rung.triggerKind === "lineup_add") return { note: "refreshes the lineup slot and every ALONGSIDE: list" };
  return {};
}

/** AB5's live ladder: Puzzle's wording, the record's sub-lines, every claim in quotes. */
export function presentLadder(rungs: readonly LadderRung[], clientName?: string): PresentedRung[] {
  return rungs.map((rung) => ({
    trigger: triggerLabel(rung),
    claim: claimCell(rung),
    ...rungCopy(rung, clientName),
  }));
}
