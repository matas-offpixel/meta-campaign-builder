import type { VizDeltaTone, VizLineKind } from "./tokens.ts";

export type WindowPace = {
  spent: number;
  planned: number;
  currency: "GBP";
  lineKind: VizLineKind;
  tone: VizDeltaTone;
};

export type WindowPaceState = "no-reads" | "on" | "above" | "below" | "junk-window";

export function windowPaceState(input: {
  empty?: boolean;
  spent?: number;
  planned?: number;
  tone?: VizDeltaTone;
}): WindowPaceState {
  if (input.empty) return "junk-window";
  const spent = input.spent ?? 0;
  const planned = input.planned ?? 0;
  if (spent <= 0) return "no-reads";
  if (input.tone === "above") return "above";
  if (input.tone === "below") return "below";
  return "on";
}

/** Fill from start to today, proportional to spent / planned. Never a percentage in copy. */
export function paceFillRatio(spent: number, planned: number): number {
  if (planned <= 0 || spent <= 0) return 0;
  return Math.min(1, spent / planned);
}

function formatGbp(amount: number): string {
  return `£${Math.round(amount).toLocaleString("en-GB")}`;
}

/** J3: "£2,588 spent since launch · plan said £3,300 by today" — sums, never a percentage. */
export function formatPaceSentence(spent: number, planned: number): string {
  return `${formatGbp(spent)} spent since launch · plan said ${formatGbp(planned)} by today`;
}
