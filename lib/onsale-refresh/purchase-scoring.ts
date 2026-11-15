/**
 * P4 PR C — how P5 scores the Purchase campaign lines (docs/design-record/2026-11-14-purchase-campaigns.html,
 * PC6, HP5). Pure; scoring.ts reads the ad-days and stores the outcome.
 *
 *   Purchase campaign, applied: its first 14 days (to the show if sooner).
 *     Right if its cost per purchase came in at or below the main
 *     campaign's over the same days, with 3 or more purchases; under 3 is
 *     "no verdict" — recorded, not counted towards a hit rate.
 *   Which pick won, the same 14 days inside the Purchase campaign: the
 *     pick whose copy had the lower cost per purchase, each with 3 or more;
 *     otherwise no verdict, and the spend split CBO gave the two is stored.
 *     "Both picks" or no purchase pick records no test.
 *   Purchase campaign, shadow or rejected: right if the event still met the
 *     bar at the end of the next full week (the refresh's own read of that
 *     week: the purchase line Proposed).
 *   Scale up: right if, on the next full week, its cost per purchase stayed
 *     within 20 % of what it was before the step, with 3 or more purchases.
 *   Scale down: right if it came in lower than before, with 3 or more.
 *   Copy an audience: right if the copied ad set's cost per purchase in the
 *     Purchase campaign is at or below the campaign's after 7 days.
 * The 3-purchase minimum on a scale or a copy is unknown (data short), as
 * R6 treats it; "no verdict" is the Purchase campaign's and the pick's.
 */

import { addDaysIso } from "./schedule.ts";

export type PcOutcome = "right" | "wrong" | "unknown" | "no_verdict";
export type PcJudgement = { outcome: PcOutcome; reason: string; figures: Record<string, unknown> };

export type PcRow = { meta_campaign_id: string | null; meta_adset_id: string | null; date: string; spend: number | string | null; purchases?: number | string | null };

export const PURCHASE_KINDS = new Set(["purchase_campaign", "scale_purchase", "copy_audience"]);
export const PC6 = { minPurchases: 3, scaleHold: 1.2, windowDays: 14, copyDays: 7 } as const;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;
const londonDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

type Line = { kind: string; state: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null; applied_at: string | null };

/** The Purchase campaign's own progress (PR B's applied_result.purchase, or the earlier attempt's). */
export function purchaseProgress(line: Pick<Line, "applied_result">): { campaignId?: string; adSets?: Record<string, { id: string; role: string; name: string }> } {
  const result = line.applied_result ?? {};
  return ((result.purchase ?? (result.previous as Record<string, unknown> | undefined)?.purchase) ?? {}) as { campaignId?: string };
}

/** The window a Purchase line is judged on, when it isn't the standard next full week; null = scoring.ts's week. */
export function purchaseWindow(line: Line): { from: string; to: string } | null {
  if (line.state !== "applied" || !line.applied_at) return null;
  const day = londonDay(line.applied_at);
  if (line.kind === "purchase_campaign") {
    const end = typeof line.write?.endDay === "string" ? line.write.endDay : null;
    const to = addDaysIso(day, PC6.windowDays - 1);
    return { from: day, to: end && end < to ? end : to };
  }
  if (line.kind === "copy_audience") return { from: addDaysIso(day, 1), to: addDaysIso(day, PC6.copyDays) };
  return null;
}

/** The campaigns whose ad-days a Purchase line needs: the Purchase campaign and the main campaign. */
export function purchaseCampaignIds(line: Line): string[] {
  const purchase = line.kind === "purchase_campaign" ? purchaseProgress(line).campaignId : typeof line.write?.purchaseCampaignId === "string" ? line.write.purchaseCampaignId : null;
  const main = typeof line.write?.mainCampaignId === "string" ? line.write.mainCampaignId : null;
  return [purchase, main].filter((id): id is string => Boolean(id));
}

function totals(rows: readonly PcRow[], filter: (row: PcRow) => boolean) {
  let spend = 0;
  let purchases = 0;
  for (const row of rows) {
    if (!filter(row)) continue;
    spend += num(row.spend);
    purchases += num(row.purchases);
  }
  return { spend: round2(spend), purchases, cpp: purchases > 0 ? round2(spend / purchases) : null };
}

/** The pick test (PC6): the lower cost per purchase wins when each copy has 3+; else no verdict; CBO's spend split stored either way. */
export function pickVerdict(line: Line, rows: readonly PcRow[]): { verdict: "purchase_pick" | "checkout_pick" | "no_verdict" | "no_test"; split: Record<string, number>; figures: Record<string, unknown> } {
  const copies = Object.values(purchaseProgress(line).adSets ?? {});
  const purchaseCopy = copies.find((copy) => copy.role === "purchase");
  const checkoutCopy = copies.find((copy) => copy.role === "checkout");
  if (!purchaseCopy || !checkoutCopy || line.write?.noPurchasePick === true) return { verdict: "no_test", split: {}, figures: {} };
  const p = totals(rows, (row) => row.meta_adset_id === purchaseCopy.id);
  const c = totals(rows, (row) => row.meta_adset_id === checkoutCopy.id);
  const both = p.spend + c.spend;
  const split = both > 0 ? { purchase_pick: round2(p.spend / both), checkout_pick: round2(c.spend / both) } : { purchase_pick: 0, checkout_pick: 0 };
  const figures = { purchasePick: p, checkoutPick: c };
  if (p.purchases < PC6.minPurchases || c.purchases < PC6.minPurchases) return { verdict: "no_verdict", split, figures };
  return { verdict: p.cpp! <= c.cpp! ? "purchase_pick" : "checkout_pick", split, figures };
}

export function judgePurchaseLine(line: Line, rows: readonly PcRow[], ctx: { nextWeekState?: string | null }): PcJudgement {
  const purchaseId = purchaseCampaignIds(line)[0] ?? null;
  const mainId = typeof line.write?.mainCampaignId === "string" ? line.write.mainCampaignId : null;
  if (line.kind === "purchase_campaign") {
    if (line.state !== "applied") {
      // Shadow or rejected: did the signal hold at the end of the next full week?
      if (ctx.nextWeekState == null) return { outcome: "unknown", reason: "No refresh read that week.", figures: {} };
      const held = ctx.nextWeekState === "proposed" || ctx.nextWeekState === "platform_proposed";
      return { outcome: held ? "right" : "wrong", reason: held ? "The purchase signal still met the bar." : "The purchase signal fell under the bar.", figures: { state: ctx.nextWeekState } };
    }
    if (!purchaseId || !mainId) return { outcome: "unknown", reason: "The Purchase campaign or the main campaign isn't on the line.", figures: {} };
    const purchase = totals(rows, (row) => row.meta_campaign_id === purchaseId);
    const main = totals(rows, (row) => row.meta_campaign_id === mainId);
    const pick = pickVerdict(line, rows);
    const figures = { purchase, main, pick };
    if (purchase.purchases < PC6.minPurchases) return { outcome: "no_verdict", reason: `${purchase.purchases} purchase${purchase.purchases === 1 ? "" : "s"} in its first 14 days; a verdict needs 3.`, figures };
    if (main.cpp == null) return { outcome: "right", reason: "It bought; the main campaign didn't.", figures };
    const right = purchase.cpp! <= main.cpp;
    return { outcome: right ? "right" : "wrong", reason: right ? "Its cost per purchase came in at or below the main campaign's." : "Its cost per purchase came in above the main campaign's.", figures };
  }
  if (line.kind === "scale_purchase") {
    const before = Number((line.write?.before as { cpp?: number } | undefined)?.cpp);
    const direction = line.write?.direction;
    if (!purchaseId || !Number.isFinite(before) || before <= 0) return { outcome: "unknown", reason: "No cost per purchase before the step.", figures: {} };
    if (line.state !== "applied") return { outcome: "unknown", reason: "Not applied: there's no week after a step to compare.", figures: {} };
    const after = totals(rows, (row) => row.meta_campaign_id === purchaseId);
    const figures = { before, after };
    if (after.purchases < PC6.minPurchases) return { outcome: "unknown", reason: "Fewer than 3 purchases in the week.", figures };
    const right = direction === "down" ? after.cpp! < before : after.cpp! <= before * PC6.scaleHold;
    return { outcome: right ? "right" : "wrong", reason: right ? (direction === "down" ? "Its cost per purchase came in lower than before the step." : "Its cost per purchase held within 20 %.") : direction === "down" ? "Its cost per purchase didn't come down." : "Its cost per purchase rose more than 20 %.", figures };
  }
  if (line.kind === "copy_audience") {
    if (line.state !== "applied") return { outcome: "unknown", reason: "Not applied: no copy ran.", figures: {} };
    const copyId = typeof line.applied_result?.adsetId === "string" ? line.applied_result.adsetId : null;
    if (!purchaseId || !copyId) return { outcome: "unknown", reason: "The copied ad set isn't on the line.", figures: {} };
    const copy = totals(rows, (row) => row.meta_adset_id === copyId);
    const campaign = totals(rows, (row) => row.meta_campaign_id === purchaseId);
    const figures = { copy, campaign };
    if (copy.purchases < PC6.minPurchases || campaign.cpp == null) return { outcome: "unknown", reason: "Fewer than 3 purchases on the copy after 7 days.", figures };
    const right = copy.cpp! <= campaign.cpp;
    return { outcome: right ? "right" : "wrong", reason: right ? "The copy bought at or below the Purchase campaign's cost." : "The copy bought above the Purchase campaign's cost.", figures };
  }
  return { outcome: "unknown", reason: "No rule for this kind.", figures: {} };
}

/** PC6's per-client tally of which pick won: "purchase pick", "checkout pick" or "no verdict", beside R6's hit rates. */
export function pickTally(outcomes: readonly { client_id: string | null; kind: string; figures: Record<string, unknown> | null }[]): Map<string, { purchase_pick: number; checkout_pick: number; no_verdict: number }> {
  const tally = new Map<string, { purchase_pick: number; checkout_pick: number; no_verdict: number }>();
  for (const row of outcomes) {
    if (row.kind !== "purchase_campaign") continue;
    const verdict = (row.figures?.pick as { verdict?: string } | undefined)?.verdict;
    if (verdict !== "purchase_pick" && verdict !== "checkout_pick" && verdict !== "no_verdict") continue;
    const key = row.client_id ?? "";
    const entry = tally.get(key) ?? { purchase_pick: 0, checkout_pick: 0, no_verdict: 0 };
    entry[verdict] += 1;
    tally.set(key, entry);
  }
  return tally;
}
