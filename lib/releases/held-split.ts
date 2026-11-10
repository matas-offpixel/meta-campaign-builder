/**
 * The two held Puzzle claims the rung-1 split rewrites in place.
 * Approved, scheduled, live and done rows are never in this list:
 * only state "held" with one of the two exact claims.
 */

export const GENERAL_SALE_HELD_CLAIM = "General sale live · selling fast";
export const GENERAL_SALE_LIVE_CLAIM = "General sale live";
export const PRESALE_HELD_CLAIM = "Presale live · selling fast";
export const PRESALE_ENDED_WHY =
  "Ended — General sale went live Fri 30 Oct, so the presale is no longer the release to push.";

export const GENERAL_SALE_TRIGGER = {
  kind: "state",
  value: "on_sale",
  template: "{release} live",
} as const;

export type HeldWarning = {
  id: string;
  claim: string;
  state: string;
  trigger?: Record<string, unknown> | null;
  why?: string | null;
};

export type WarningRow = {
  id: string;
  claim: string;
  state: string;
  trigger: Record<string, unknown> | null;
  why: string | null;
};

/** Approved, scheduled, live and done are never rewritten. Only held rows change. */
const SETTLED = new Set(["approved", "scheduled", "live", "done"]);

export function rewriteHeldWarnings(rows: readonly WarningRow[]): WarningRow[] {
  return rows.map((row) => {
    if (row.state !== "held" || SETTLED.has(row.state)) return row;
    if (row.claim === GENERAL_SALE_HELD_CLAIM) {
      return { ...row, claim: GENERAL_SALE_LIVE_CLAIM, trigger: { ...GENERAL_SALE_TRIGGER } };
    }
    if (row.claim === PRESALE_HELD_CLAIM) {
      return { ...row, state: "locked", why: PRESALE_ENDED_WHY };
    }
    return row;
  });
}

/**
 * A new proposal is a new held row. An approved, scheduled, live or done row
 * is returned as the same object, and so is every other existing row.
 */
export function applyEngineProposal(
  rows: readonly WarningRow[],
  proposal: { claim: string; trigger: Record<string, unknown> | null } | null,
): WarningRow[] {
  const next = rows.map((row) => row);
  if (!proposal) return next;
  if (rows.some((row) => row.claim === proposal.claim)) return next;
  next.push({
    id: "proposed",
    claim: proposal.claim,
    state: "held",
    trigger: proposal.trigger,
    why: null,
  });
  return next;
}

export type HeldSplitPlan = {
  generalSale: { id: string; claim: string; trigger: typeof GENERAL_SALE_TRIGGER }[];
  presale: { id: string; state: "locked"; why: string }[];
};

export function planHeldSplit(rows: readonly HeldWarning[]): HeldSplitPlan {
  const input = rows.map((row) => ({
    id: row.id,
    claim: row.claim,
    state: row.state,
    trigger: row.trigger ?? null,
    why: row.why ?? null,
  }));
  const rewritten = rewriteHeldWarnings(input);
  const generalSale: HeldSplitPlan["generalSale"] = [];
  const presale: HeldSplitPlan["presale"] = [];
  rewritten.forEach((row, index) => {
    if (row === input[index]) return;
    if (row.claim === GENERAL_SALE_LIVE_CLAIM) {
      generalSale.push({ id: row.id, claim: row.claim, trigger: GENERAL_SALE_TRIGGER });
    } else if (row.state === "locked") {
      presale.push({ id: row.id, state: "locked", why: PRESALE_ENDED_WHY });
    }
  });
  return { generalSale, presale };
}
