/**
 * lib/ticketing/fourthefans/history.ts
 *
 * Daily sales history via GET /events/{event_id}/sales?from=&to=
 * Uses the same bearer auth and api-base resolution as `fourthefansGet`.
 */

import { fourthefansGet } from "./client.ts";

export interface FourthefansHistoryDay {
  date: string;
  /** Daily delta from the API (not cumulative). */
  tickets_sold: number;
  /** Daily delta revenue in major currency units (e.g. GBP), unless API sends cents (see parser). */
  revenue: number;
}

function normalizeYmd(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1]! : null;
}

function parseUnknownNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Parse `/events/{id}/sales` JSON. Accepts 200 + `{ sales: [] }` as success (empty array).
 */
export function parseFourthefansSalesHistoryPayload(
  payload: unknown,
): FourthefansHistoryDay[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const sales = root.sales;
  if (!Array.isArray(sales)) return [];

  const out: FourthefansHistoryDay[] = [];
  for (const item of sales) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const date =
      normalizeYmd(o.date) ??
      normalizeYmd(o.day) ??
      normalizeYmd(o.date_string);
    if (!date) continue;

    const ticketsRaw =
      o.tickets_sold ?? o.tickets ?? o.quantity_sold ?? o.ticket_count;
    const revenueRaw =
      o.revenue ?? o.total_revenue ?? o.gross_revenue ?? o.sales_total;

    const tickets = Math.max(0, Math.round(parseUnknownNumber(ticketsRaw)));
    const revenue = parseUnknownNumber(revenueRaw);

    out.push({ date, tickets_sold: tickets, revenue });
  }

  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export interface FetchFourthefansHistoryArgs {
  /** External WordPress / listing id (numeric in API path). */
  eventId: number;
  /** Inclusive YYYY-MM-DD (UTC calendar day). */
  from: string;
  /** Inclusive YYYY-MM-DD (UTC calendar day). */
  to: string;
  /**
   * Resolved REST base, same shape as `fourthefansGet` `apiBase`
   * (e.g. https://4thefans.book.tickets/wp-json/agency/v1).
   */
  baseUrl: string;
  token: string;
}

/**
 * GET /events/{event_id}/sales?from=&to=
 *
 * Returns **daily deltas** sorted by date. Empty `sales` → [] (success).
 */
export async function fetchFourthefansHistory(
  args: FetchFourthefansHistoryArgs,
): Promise<FourthefansHistoryDay[]> {
  const endpoint = `/events/${encodeURIComponent(String(args.eventId))}/sales`;
  const payload = await fourthefansGet<unknown>(args.token, endpoint, {
    query: {
      from: args.from,
      to: args.to,
    },
    apiBase: args.baseUrl,
  });
  return parseFourthefansSalesHistoryPayload(payload);
}

/** Merge daily deltas from multiple listings by calendar day (sum tickets + revenue). */
export function mergeFourthefansDailyDeltas(
  batches: FourthefansHistoryDay[][],
): FourthefansHistoryDay[] {
  const byDate = new Map<string, { tickets: number; revenue: number }>();
  for (const batch of batches) {
    for (const row of batch) {
      const cur = byDate.get(row.date) ?? { tickets: 0, revenue: 0 };
      cur.tickets += row.tickets_sold;
      cur.revenue += row.revenue;
      byDate.set(row.date, cur);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      tickets_sold: v.tickets,
      revenue: v.revenue,
    }));
}

/**
 * Convert sorted daily deltas to cumulative tickets + gross revenue cents.
 * Revenue deltas are assumed major currency units (e.g. GBP); stored as cents.
 */
export function cumulativeFourthefansSnapshotsFromDeltas(
  deltas: FourthefansHistoryDay[],
): Array<{
  date: string;
  tickets_sold: number;
  gross_revenue_cents: number;
}> {
  let runTickets = 0;
  let runRevenueGbp = 0;
  const out: Array<{
    date: string;
    tickets_sold: number;
    gross_revenue_cents: number;
  }> = [];
  for (const d of deltas) {
    runTickets += d.tickets_sold;
    runRevenueGbp += d.revenue;
    out.push({
      date: d.date,
      tickets_sold: runTickets,
      gross_revenue_cents: Math.round(runRevenueGbp * 100),
    });
  }
  return out;
}
