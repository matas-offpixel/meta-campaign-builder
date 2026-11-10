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
};

export type HeldSplitPlan = {
  generalSale: { id: string; claim: string; trigger: typeof GENERAL_SALE_TRIGGER }[];
  presale: { id: string; state: "locked"; why: string }[];
};

export function planHeldSplit(rows: readonly HeldWarning[]): HeldSplitPlan {
  const generalSale: HeldSplitPlan["generalSale"] = [];
  const presale: HeldSplitPlan["presale"] = [];
  for (const row of rows) {
    if (row.state !== "held") continue;
    if (row.claim === GENERAL_SALE_HELD_CLAIM) {
      generalSale.push({ id: row.id, claim: GENERAL_SALE_LIVE_CLAIM, trigger: GENERAL_SALE_TRIGGER });
    } else if (row.claim === PRESALE_HELD_CLAIM) {
      presale.push({ id: row.id, state: "locked", why: PRESALE_ENDED_WHY });
    }
  }
  return { generalSale, presale };
}
