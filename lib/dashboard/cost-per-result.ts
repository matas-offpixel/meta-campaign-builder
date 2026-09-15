/**
 * lib/dashboard/cost-per-result.ts
 *
 * The Daily Tracker's one safe divide, behind the CPT / CPL / CPR
 * columns on every row — dated days and the collapsed
 * pre-general-sale bucket alike.
 *
 * The bucket is why this is shared rather than local to the table.
 * Its numerator and denominator are both nullable in a way a dated
 * row's never are: a bucket spanning forty days can hold a column
 * that no day in the range ever wrote. Dividing that would print
 * "£0.00" where the honest answer is "—", so the null cases are part
 * of the contract and get tested against the bucket's own totals.
 */

/**
 * `numerator / denominator`, or `null` when the pair can't produce a
 * meaningful rate. A zero denominator is an absence, not a division:
 * zero registrations means there is no cost per registration yet.
 */
export function costPerResult(
  numerator: number | null,
  denominator: number | null,
): number | null {
  if (numerator == null) return null;
  if (denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}
