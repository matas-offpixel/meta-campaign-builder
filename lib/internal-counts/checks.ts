/**
 * lib/internal-counts/checks.ts
 *
 * M4 of docs/design-record/2026-11-13-internal-counts-matching.html: the
 * sheet errors a parsed show block can carry.
 *
 * - Price looks wrong: a tier's price equals that column's top-row count
 *   (IPC on 12 Nov: 1ST £200.00 with 200 sold), or is above the event's
 *   highest ticket price (its dearest paid tier, or £150 when none is
 *   stored). The counts are still stored; that show's revenue from that
 *   sheet is held. One review item per show per sheet, however many tiers
 *   fire.
 * - −£1.00 is an unused tier: left out of counts and revenue, no review
 *   item. A comp tier (guest list, comps, free) still counts as comps,
 *   whatever its price: DJ EZ's 89 "VIP Free" at −£1.00 are comps.
 * - Sums don't add up when a show's tier counts don't sum to its total.
 *   That show's count from that sheet is held; the others are stored.
 */

import type { ParsedBlock } from "./parse.ts";

export const DEFAULT_PRICE_CEILING_PENCE = 150_00;

export interface PriceFlag {
  position: number;
  tierName: string;
  outlet: string;
  pricePence: number;
  /** The top-row count in that column (null when the cell is blank). */
  count: number | null;
  reason: "equals_count" | "above_ceiling";
  ceilingPence: number;
}

export interface BlockCheck {
  /** Layout problems: the sheet can't be read. */
  unreadable: string[];
  /** Set when the tier counts don't sum to the total: the show is held. */
  sum: { tiers: number; total: number } | null;
  /** A total with every tier empty or 0: comps can't be separated, so the show is held (design ruling on a57bca9). */
  noTiers: { total: number } | null;
  priceFlags: PriceFlag[];
  /** count × price ≠ the sheet's tier £ on a tier whose price wasn't flagged. */
  revenueMismatch: string[];
  /** Revenue from this sheet is held for the show. */
  revenueHeld: boolean;
}

const sum = (xs: Array<number | null>): number => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export function isUnusedTier(block: ParsedBlock, i: number): boolean {
  const t = block.tiers[i];
  return !t.comp && t.pricePence !== null && t.pricePence < 0;
}

/** Per tier, the sum of its outlet cells (the cells written to tier_channel_sales). */
export function columnSums(block: ParsedBlock): number[] {
  return block.tiers.map((_, i) => sum(block.outlets.map((r) => r.cells[i])));
}

function pounds(pence: number): string {
  return `${pence < 0 ? "-" : ""}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

export function priceFlags(block: ParsedBlock, ceilingPence = DEFAULT_PRICE_CEILING_PENCE): PriceFlag[] {
  const top = block.outlets[0];
  const flags: PriceFlag[] = [];
  block.tiers.forEach((tier, i) => {
    const price = tier.pricePence;
    if (price === null || price < 0) return;
    const count = top?.cells[i] ?? null;
    const base = { position: tier.position, tierName: tier.name, outlet: top?.outlet ?? "", pricePence: price, count, ceilingPence };
    if (count !== null && count > 0 && price === count * 100) flags.push({ ...base, reason: "equals_count" });
    else if (price > ceilingPence) flags.push({ ...base, reason: "above_ceiling" });
  });
  return flags;
}

/** The sheet gives a total but no tiers: a positive total with every tier cell and the totals row at 0 or blank (SCHAK, 22 Sep). */
export function hasNoTiers(block: ParsedBlock): boolean {
  const total = block.totals?.total;
  if (total === null || total === undefined || total <= 0) return false;
  return sum(columnSums(block)) === 0 && sum(block.totals?.cells ?? []) === 0;
}

function sumCheck(block: ParsedBlock): BlockCheck["sum"] {
  const total = block.totals?.total;
  if (total === null || total === undefined) return null;
  if (hasNoTiers(block)) return null;
  const grid = sum(columnSums(block));
  if (grid !== total) return { tiers: grid, total };
  const totalsRow = sum(block.totals?.cells ?? []);
  if (totalsRow !== total) return { tiers: totalsRow, total };
  return null;
}

function revenueCheck(block: ParsedBlock, flagged: Set<number>): string[] {
  const out: string[] = [];
  const totals = block.totals;
  if (!totals) return out;
  block.tiers.forEach((tier, i) => {
    if (flagged.has(tier.position) || isUnusedTier(block, i) || tier.comp) return;
    const count = totals.cells[i] ?? 0;
    const revenue = block.tierRevenuePence[i] ?? 0;
    const price = tier.pricePence;
    if (price === null) {
      if (count !== 0) out.push(`Tier ${tier.key} has ${count} sold but no price.`);
      return;
    }
    if (count * price !== revenue) {
      out.push(`Tier ${tier.key}: ${count} × ${pounds(price)} is ${pounds(count * price)}, but the sheet says ${pounds(revenue)}.`);
    }
  });
  if (block.totalRevenuePence !== null && sum(block.tierRevenuePence) !== block.totalRevenuePence) {
    out.push(`Tier £ add up to ${pounds(sum(block.tierRevenuePence))}, but the £ total is ${pounds(block.totalRevenuePence)}.`);
  }
  return out;
}

export function checkBlock(block: ParsedBlock, ceilingPence = DEFAULT_PRICE_CEILING_PENCE): BlockCheck {
  const unreadable = [...block.problems];
  // No tiers: there's no tier revenue to check; the write keeps revenue unknown (blockWrite), so no price item opens.
  const noTiers = !unreadable.length && hasNoTiers(block);
  const flags = noTiers ? [] : priceFlags(block, ceilingPence);
  const revenueMismatch = noTiers ? [] : revenueCheck(block, new Set(flags.map((f) => f.position)));
  return {
    unreadable,
    sum: unreadable.length ? null : sumCheck(block),
    noTiers: noTiers ? { total: block.totals!.total! } : null,
    priceFlags: flags,
    revenueMismatch,
    revenueHeld: flags.length > 0 || revenueMismatch.length > 0,
  };
}

/**
 * Paid and comp tickets. `total` is the show's count (the sheet's TOTAL, or
 * the figure Matas picked on a sum hold); comps and unused tiers come off it.
 */
/** comps is null when the sheet gives a total but no tiers: they can't be separated. */
export function soldAndComps(block: ParsedBlock, total?: number): { paid: number; comps: number | null; total: number } {
  if (hasNoTiers(block)) {
    const t = total ?? block.totals!.total!;
    return { paid: t, comps: null, total: t };
  }
  const cols = columnSums(block);
  let comps = 0;
  let unused = 0;
  block.tiers.forEach((tier, i) => {
    if (tier.comp) comps += cols[i];
    else if (isUnusedTier(block, i)) unused += cols[i];
  });
  const t = total ?? block.totals?.total ?? sum(cols);
  return { paid: t - comps - unused, comps, total: t };
}

/** Paid tiers' £ in pence as the sheet prints them (unused and comp tiers left out). */
export function paidRevenuePence(block: ParsedBlock): number {
  return block.tiers.reduce(
    (acc, tier, i) => (tier.comp || isUnusedTier(block, i) ? acc : acc + (block.tierRevenuePence[i] ?? 0)),
    0,
  );
}
