/**
 * RT5 — Moves, holds and cuts (docs/design-record/2026-11-17-retargeting-campaign.html).
 *
 * The daily read, over the last 7 days, offers at most one Move or Cut.
 * The measure is cost per attributed purchase only. Frequency is how a
 * pool's size shows: a tier's room is the daily budget that would bring
 * its 7-day frequency to 4, its average daily spend × 4 ÷ its frequency;
 * at frequency 4 or more it has no room.
 *
 *   Cut:  a tier at frequency 6 or more is cut to budget × 4 ÷ frequency
 *         (down to the penny, never under the floor). What's freed goes to
 *         the cheapest tier that could receive it, else back to the plan.
 *         A cut is the read's one budget line.
 *   Move: the receiver is the cheapest tier with 3 or more attributed
 *         purchases and frequency under 4; the giver is the dearest tier.
 *         It moves only when the receiver costs no more than 0.75 × the
 *         giver. Half the giver's average daily spend, down to the penny,
 *         capped so the giver keeps the floor and the receiver stays within
 *         its room. R5's 20 % cap is checked by the caller (plan-guard).
 *   Hold: a cheaper tier passed over for frequency 4 or more: a note.
 *   No tier at 3 attributed purchases: "No move today: …".
 *
 * Pure. Money is in minor units (pence).
 */

import {
  BUDGET_KIND_LABEL,
  BUDGET_WRITE_BOTH,
  BUDGET_WRITE_ONE,
  cutDetail,
  cutNarrow,
  cutTitle,
  holdDetail,
  holdNarrow,
  holdTitle,
  moveDetail,
  moveNarrow,
  moveTitle,
  NO_MOVE_TODAY,
  TIERS,
  type Tier,
} from "./words.ts";

export const RT5 = {
  /** A receiver needs this many attributed purchases in the 7 days. */
  minPurchases: 3,
  /** Hold and room: frequency 4. */
  holdFrequency: 4,
  /** Cut: frequency 6 or more, back to 4. */
  cutFrequency: 6,
  /** The receiver costs no more than this × the giver. */
  ratio: 0.75,
  /** The giver keeps £1.00 a day. */
  floorMinor: 100,
  days: 7,
} as const;

export type TierFigures = {
  tier: Tier;
  adsetId: string;
  /** The ad set's daily budget now, pence. */
  budgetMinor: number;
  /** 7-day spend, pence. */
  spendMinor: number;
  /** 7-day attributed purchases. */
  purchases: number;
  /** 7-day frequency; null when Meta didn't return one. */
  frequency: number | null;
  /** The delivery estimate band, for the words. */
  pool: string | null;
};

export type BudgetNote = { kind: "hold"; label: string; tier: Tier; title: string; detail: string; narrow: string };

export type BudgetLine = {
  kind: "move" | "cut";
  label: string;
  title: string;
  detail: string;
  narrow: string;
  writeText: string;
  /**
   * What onsale-refresh's move apply reads (applyMove): from, to (null = back
   * to the plan) and `amountGbp`, which there is a week's move (R5's cap is
   * on the week; the daily write is amountGbp ÷ 7). RT5's moves are daily,
   * so amountGbp = dailyMinor × 7 ÷ 100 and the write is exactly dailyMinor.
   */
  write: { kind: "retargeting_move" | "retargeting_cut"; fromAdsetId: string; toAdsetId: string | null; amountGbp: number; dailyMinor: number; fromTier: Tier; toTier: Tier | null; fromAfterMinor: number; toAfterMinor: number | null };
};

export type BudgetRead = { line: BudgetLine | null; holds: BudgetNote[]; note: string | null };

/** Cost per attributed purchase, £, to the penny; null with no purchase. */
export function costOf(row: Pick<TierFigures, "spendMinor" | "purchases">): number | null {
  return row.purchases > 0 ? Math.round(row.spendMinor / row.purchases) / 100 : null;
}

/** The daily budget that brings the 7-day frequency to 4, pence (down to the penny); 0 at frequency 4 or more. */
export function roomMinor(row: Pick<TierFigures, "spendMinor" | "frequency">): number {
  if (row.frequency == null || !(row.frequency > 0) || row.frequency >= RT5.holdFrequency) return 0;
  return Math.floor(((row.spendMinor / RT5.days) * RT5.holdFrequency) / row.frequency);
}

const canReceive = (row: TierFigures) => row.purchases >= RT5.minPurchases && row.frequency != null && row.frequency < RT5.holdFrequency;

/** Tiers with 3+ attributed purchases, cheapest first (ties: hotter first). */
function ranked(rows: readonly TierFigures[]): TierFigures[] {
  const order = (tier: Tier) => TIERS.indexOf(tier);
  return rows
    .filter((row) => row.purchases >= RT5.minPurchases)
    .sort((a, b) => costOf(a)! - costOf(b)! || order(a.tier) - order(b.tier));
}

export function planBudget(rows: readonly TierFigures[], opts: { floorMinor?: number } = {}): BudgetRead {
  const floor = Math.max(RT5.floorMinor, opts.floorMinor ?? 0);

  // Cut first: it's the read's one budget line.
  const over = rows.filter((row) => row.frequency != null && row.frequency >= RT5.cutFrequency).sort((a, b) => b.frequency! - a.frequency!);
  for (const row of over) {
    const after = Math.max(floor, Math.floor((row.budgetMinor * RT5.holdFrequency) / row.frequency!));
    const freed = row.budgetMinor - after;
    if (freed <= 0) continue;
    const receiver = ranked(rows).find((other) => other.tier !== row.tier && canReceive(other) && other.budgetMinor + freed <= roomMinor(other)) ?? null;
    const detail = cutDetail({
      frequency: row.frequency!,
      pool: row.pool,
      beforeMinor: row.budgetMinor,
      afterMinor: after,
      freedMinor: freed,
      receiver: receiver ? { tier: receiver.tier, cost: costOf(receiver)!, frequency: receiver.frequency! } : null,
    });
    return {
      line: {
        kind: "cut",
        label: BUDGET_KIND_LABEL.cut,
        title: cutTitle(row.tier, receiver?.tier ?? null),
        detail,
        narrow: cutNarrow({ frequency: row.frequency!, beforeMinor: row.budgetMinor, afterMinor: after }),
        writeText: receiver ? BUDGET_WRITE_BOTH : BUDGET_WRITE_ONE,
        write: {
          kind: "retargeting_cut",
          fromAdsetId: row.adsetId,
          toAdsetId: receiver?.adsetId ?? null,
          amountGbp: (freed * RT5.days) / 100,
          dailyMinor: freed,
          fromTier: row.tier,
          toTier: receiver?.tier ?? null,
          fromAfterMinor: after,
          toAfterMinor: receiver ? receiver.budgetMinor + freed : null,
        },
      },
      holds: [],
      note: null,
    };
  }

  const list = ranked(rows);
  if (!list.length) return { line: null, holds: [], note: NO_MOVE_TODAY };

  // Hold: a cheaper tier passed over for frequency 4 or more isn't fed.
  const holds: BudgetNote[] = [];
  let receiver: TierFigures | null = null;
  for (const row of list) {
    if (canReceive(row)) {
      receiver = row;
      break;
    }
    if (row.frequency != null && row.frequency >= RT5.holdFrequency) {
      holds.push({ kind: "hold", label: BUDGET_KIND_LABEL.hold, tier: row.tier, title: holdTitle(row.tier), detail: holdDetail({ cost: costOf(row)!, frequency: row.frequency, pool: row.pool }), narrow: holdNarrow(row.tier, row.frequency) });
    }
  }
  if (!receiver) return { line: null, holds, note: null };

  // The giver: the dearest tier. Spend with no purchase counts as dearest once it passes the cheapest tier's cost.
  const cheapest = costOf(list[0]!)!;
  const dearness = (row: TierFigures): number | null => {
    const cost = costOf(row);
    if (cost != null) return cost;
    return row.spendMinor / 100 > cheapest ? Number.POSITIVE_INFINITY : null;
  };
  const giver = rows
    .filter((row) => row.tier !== receiver!.tier && row.spendMinor > 0 && dearness(row) != null)
    .sort((a, b) => dearness(b)! - dearness(a)! || TIERS.indexOf(b.tier) - TIERS.indexOf(a.tier))[0];
  if (!giver) return { line: null, holds, note: null };
  const receiverCost = costOf(receiver)!;
  if (!(receiverCost <= RT5.ratio * dearness(giver)!)) return { line: null, holds, note: null };

  const half = Math.floor(giver.spendMinor / (RT5.days * 2));
  const amount = Math.min(half, giver.budgetMinor - floor, roomMinor(receiver) - receiver.budgetMinor);
  if (amount <= 0) return { line: null, holds, note: null };
  const giverCost = costOf(giver);
  return {
    line: {
      kind: "move",
      label: BUDGET_KIND_LABEL.move,
      title: moveTitle(giver.tier, receiver.tier),
      detail: moveDetail({ giverCost, giverPurchases: giver.purchases, giverSpendMinor: giver.spendMinor, receiver: receiver.tier, receiverCost, receiverPurchases: receiver.purchases, frequency: receiver.frequency!, pool: receiver.pool, amountMinor: amount }),
      narrow: moveNarrow({ giverCost, receiverCost, amountMinor: amount }),
      writeText: BUDGET_WRITE_BOTH,
      write: {
        kind: "retargeting_move",
        fromAdsetId: giver.adsetId,
        toAdsetId: receiver.adsetId,
        amountGbp: (amount * RT5.days) / 100,
        dailyMinor: amount,
        fromTier: giver.tier,
        toTier: receiver.tier,
        fromAfterMinor: giver.budgetMinor - amount,
        toAfterMinor: receiver.budgetMinor + amount,
      },
    },
    holds,
    note: null,
  };
}
