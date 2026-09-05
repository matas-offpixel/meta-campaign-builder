import { formatCurrency } from "../dashboard/currency.ts";
import { funnelCostLabel, type FunnelCostCell } from "../dashboard/event-funnel.ts";

/**
 * Channel-row live facts. Amount cells go through the existing money
 * formatter; named empty states stay `funnelCostLabel` (already their words).
 */
export function channelLiveCostLabel(
  cell: FunnelCostCell,
  unit: "thousand" | "click",
): string {
  if (cell.kind === "amount") {
    return `${formatCurrency(cell.value, { dp: 2 })} per ${unit}`;
  }
  return funnelCostLabel(cell);
}
