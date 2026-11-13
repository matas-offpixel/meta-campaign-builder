/**
 * lib/internal-counts/checks.ts
 *
 * The arithmetic a parsed block must pass before anything is written
 * (D8, HD1). Every blocking check has to pass, or the block goes to the
 * review list and writes nothing:
 *
 *   - each outlet row sums to its TOTAL
 *   - each tier column sums to the column totals row
 *   - the totals row sums to its TOTAL
 *   - tier £ = count × price, to the penny, for every tier whose price
 *     doesn't look wrong
 *   - the tier £ add up to the £ total
 *
 * A price "looks wrong" when it equals that column's top-row count, or is
 * above £150. IPC on 12 Nov repeats its Skiddle counts in the price row.
 * Those counts are still stored; the show's revenue is withheld and a
 * review item says why.
 */

import type { ParsedBlock } from "./parse.ts";

export const PRICE_CEILING_PENCE = 150_00;

export interface BlockCheck {
  /** Any entry here means the block writes nothing. */
  blocking: string[];
  /** Tier positions (1-based) whose price looks wrong. */
  priceLooksWrong: number[];
  /** True when any price looks wrong: counts are stored, revenue isn't. */
  revenueWithheld: boolean;
}

const sum = (xs: Array<number | null>): number => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function priceLooksWrong(block: ParsedBlock, tierIndex: number): boolean {
  const price = block.tiers[tierIndex].pricePence;
  if (price === null || price < 0) return false;
  if (price > PRICE_CEILING_PENCE) return true;
  const top = block.outlets[0]?.cells[tierIndex] ?? null;
  return top !== null && top > 0 && price === top * 100;
}

function pounds(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function checkCounts(block: ParsedBlock, blocking: string[]): void {
  const totals = block.totals;
  if (!totals) return;
  for (const row of block.outlets) {
    if (row.total === null) {
      blocking.push(`${row.outlet} has no TOTAL.`);
    } else if (sum(row.cells) !== row.total) {
      blocking.push(`${row.outlet} tiers add up to ${sum(row.cells)}, but its TOTAL is ${row.total}.`);
    }
  }
  block.tiers.forEach((tier, i) => {
    const columnSum = sum(block.outlets.map((r) => r.cells[i]));
    const printed = totals.cells[i] ?? 0;
    if (columnSum !== printed) {
      blocking.push(`Tier ${tier.key} outlets add up to ${columnSum}, but its column total is ${printed}.`);
    }
  });
  if (totals.total === null) {
    blocking.push("The totals row has no TOTAL.");
  } else if (sum(totals.cells) !== totals.total) {
    blocking.push(`The totals row adds up to ${sum(totals.cells)}, but its TOTAL is ${totals.total}.`);
  }
}

function checkRevenue(block: ParsedBlock, wrong: number[], blocking: string[]): void {
  const totals = block.totals;
  if (!totals) return;
  block.tiers.forEach((tier, i) => {
    if (wrong.includes(tier.position)) return;
    const count = totals.cells[i] ?? 0;
    const revenue = block.tierRevenuePence[i] ?? 0;
    const price = tier.pricePence;
    if (price === null) {
      if (count !== 0) blocking.push(`Tier ${tier.key} has ${count} sold but no price.`);
      else if (revenue !== 0) blocking.push(`Tier ${tier.key} has no sales but ${pounds(revenue)}.`);
      return;
    }
    // Every tier, "-£1.00" included: DJ EZ's 89 "VIP Free" at -£1.00 are -£89.00 on the sheet.
    if (count * price !== revenue) {
      blocking.push(
        `Tier ${tier.key}: ${count} × ${pounds(price)} is ${pounds(count * price)}, but the sheet says ${pounds(revenue)}.`,
      );
    }
  });
  const tierSum = sum(block.tierRevenuePence);
  if (block.totalRevenuePence === null) {
    blocking.push("The TIER TOTALS row has no £ total.");
  } else if (tierSum !== block.totalRevenuePence) {
    blocking.push(`Tier £ add up to ${pounds(tierSum)}, but the £ total is ${pounds(block.totalRevenuePence)}.`);
  }
}

export function checkBlock(block: ParsedBlock): BlockCheck {
  const blocking = [...block.problems];
  const priceWrong = block.tiers.filter((_, i) => priceLooksWrong(block, i)).map((t) => t.position);
  checkCounts(block, blocking);
  checkRevenue(block, priceWrong, blocking);
  return { blocking, priceLooksWrong: priceWrong, revenueWithheld: priceWrong.length > 0 };
}

/** Paid and comp totals for a block. Comps never count as sold. */
export function soldAndComps(block: ParsedBlock): { paid: number; comps: number; total: number } {
  let paid = 0;
  let comps = 0;
  block.tiers.forEach((tier, i) => {
    const n = block.totals?.cells[i] ?? 0;
    if (tier.comp) comps += n;
    else paid += n;
  });
  return { paid, comps, total: paid + comps };
}

/** Paid revenue in pence, or null when it's withheld. */
export function paidRevenuePence(block: ParsedBlock, check: BlockCheck): number | null {
  if (check.revenueWithheld) return null;
  return block.tiers.reduce((acc, tier, i) => (tier.comp ? acc : acc + (block.tierRevenuePence[i] ?? 0)), 0);
}
