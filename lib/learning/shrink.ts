/**
 * Shrinkage and confidence for stored learnings.
 *
 *   shrunk_index = (n · index + k · pool_index) / (n + k)
 *
 * n is the row's funded ads (≥ £5). k = 10 is the number of funded ads at
 * which a row's own index and its pool's carry equal weight. Ten is the
 * `strong` bar below: a tag only speaks mostly for itself once it has as
 * much evidence as we call strong, and a 3-ad row (the thin bar) is still
 * ~77% pool. A larger k would flatten real client differences at the n
 * one client's events produce; a smaller k would let one lucky ad rank a
 * tag.
 *
 * Pools: client → vertical, but → all when the vertical row is itself
 * thin; vertical → all; all → 1 (the scope's own norm). A missing pool
 * index falls back along the same chain.
 *
 * Confidence counts results as well as ads and spend. Purchases are
 * sparse: a tag can clear the ad and spend bars on ticket-sale ads with
 * two purchases, and its cost per purchase is then one or two sales
 * either way. A row is thin unless its ads have at least
 * THIN_MIN_RESULTS (10) results in scope: purchases in ticket_sale,
 * registrations in registration. Callers with no stage result (funnel
 * rates) omit it.
 */

import { THIN_MIN_AD_SETS, THIN_MIN_SPEND_GBP } from "../analysis/interest-performance.ts";

export const SHRINK_K = 10;
export const STRONG_MIN_FUNDED = 10;
export const STRONG_MIN_SPEND_GBP = 500;
export const THIN_MIN_RESULTS = 10;

export type Confidence = "thin" | "ok" | "strong";

export function confidenceOf(fundedAds: number, spendGbp: number, results?: number): Confidence {
  if (fundedAds < THIN_MIN_AD_SETS || spendGbp < THIN_MIN_SPEND_GBP) return "thin";
  if (results !== undefined && results < THIN_MIN_RESULTS) return "thin";
  if (fundedAds >= STRONG_MIN_FUNDED && spendGbp >= STRONG_MIN_SPEND_GBP) return "strong";
  return "ok";
}

/**
 * client_funnel_benchmarks.confidence is numeric 0–1 (migration 158).
 * The label is stored as these values and read back by `confidenceLabel`.
 */
export const CONFIDENCE_SCORE: Readonly<Record<Confidence, number>> = { thin: 0, ok: 0.5, strong: 1 };

export function confidenceLabel(score: number | null | undefined): Confidence | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= CONFIDENCE_SCORE.strong) return "strong";
  if (score >= CONFIDENCE_SCORE.ok) return "ok";
  return "thin";
}

export type PoolRow = { index: number | null; confidence: Confidence; fundedAds: number } | null | undefined;

/** The pool a row shrinks toward: the first pool in the chain with an index that is not thin, else the last with an index, else 1. */
export function choosePool(chain: readonly PoolRow[]): { index: number; fundedAds: number } {
  const withIndex = chain.filter((row): row is NonNullable<PoolRow> => row != null && row.index != null);
  const pick = withIndex.find((row) => row.confidence !== "thin") ?? withIndex[withIndex.length - 1];
  return pick ? { index: pick.index!, fundedAds: pick.fundedAds } : { index: 1, fundedAds: 0 };
}

export function shrinkIndex(
  n: number,
  index: number | null,
  pool: { index: number; fundedAds: number },
  k = SHRINK_K,
): { shrunkIndex: number | null; nEffective: number } {
  if (index == null) return { shrunkIndex: null, nEffective: n };
  return {
    shrunkIndex: (n * index + k * pool.index) / (n + k),
    // The pool lends at most k observations, and never more than it has.
    nEffective: n + Math.min(k, pool.fundedAds),
  };
}
