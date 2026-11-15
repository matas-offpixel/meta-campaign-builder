/**
 * lib/d2c/stats-ingest/opens.ts
 *
 * E5: "Opens use Mailchimp's bot-filtered rate where its report gives
 * one. Otherwise they're estimated with this client's own ratio, from
 * sends that have both, and marked 'est.'. A raw open rate (Apple Mail
 * Privacy and scanners included) is never shown as the open rate."
 *
 * Pure. The raw count is an input here and is never returned as the
 * open figure.
 */

export interface OpenCounts {
  delivered: number | null;
  opens_unique_raw: number | null;
  opens_unique_filtered: number | null;
  open_rate_filtered: number | null;
}

export interface ResolvedOpens {
  /** Bot-filtered unique opens, or the estimate. Null when neither is possible. */
  opens: number | null;
  /** 0..1 of delivered. */
  rate: number | null;
  /** true when this is the client-ratio estimate ("est."). */
  estimated: boolean;
}

/**
 * The client's filtered ÷ raw unique-open ratio, over its email sends
 * that carry both (raw > 0). Null when no send has both.
 */
export function clientOpenRatio(rows: readonly OpenCounts[]): number | null {
  let filtered = 0;
  let raw = 0;
  for (const r of rows) {
    if (r.opens_unique_filtered == null || r.opens_unique_raw == null || r.opens_unique_raw <= 0) continue;
    filtered += r.opens_unique_filtered;
    raw += r.opens_unique_raw;
  }
  return raw > 0 ? filtered / raw : null;
}

export function resolveOpens(row: OpenCounts, ratio: number | null): ResolvedOpens {
  const delivered = row.delivered != null && row.delivered > 0 ? row.delivered : null;
  if (row.opens_unique_filtered != null) {
    const rate =
      row.open_rate_filtered != null
        ? row.open_rate_filtered
        : delivered
          ? row.opens_unique_filtered / delivered
          : null;
    return { opens: row.opens_unique_filtered, rate, estimated: false };
  }
  if (ratio != null && row.opens_unique_raw != null) {
    const opens = Math.round(row.opens_unique_raw * ratio);
    return { opens, rate: delivered ? opens / delivered : null, estimated: true };
  }
  return { opens: null, rate: null, estimated: false };
}
