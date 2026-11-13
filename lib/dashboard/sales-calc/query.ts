/**
 * lib/dashboard/sales-calc/query.ts
 *
 * The `show` and `period` query params (D7), checked against the model so
 * a stale or hand-edited link falls back to the defaults instead of an
 * empty view.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { SALES_PERIODS, type SalesDashboardModel, type SalesPeriod } from "../sales-vs-spend.ts";

export function pickShow(model: Pick<SalesDashboardModel, "views" | "initialShowId">, show: string | undefined): string {
  const id = show?.toLowerCase();
  return id && model.views[id] ? id : model.initialShowId;
}

export function pickPeriod(period: string | undefined): SalesPeriod | undefined {
  return SALES_PERIODS.some((p) => p.id === period) ? (period as SalesPeriod) : undefined;
}
