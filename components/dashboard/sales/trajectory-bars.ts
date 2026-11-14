import type { AllShowBar } from "@/lib/dashboard/sales-vs-spend";

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return number.format(Math.round(value));
}

/** Shared axis: the largest capacity in the bars. Not a default of 2,000. */
export function trajectoryAxisMax(bars: readonly AllShowBar[]): number {
  return Math.max(0, ...bars.map((bar) => bar.allocation ?? 0));
}

export function capacityTicks(max: number, step: number): number[] {
  if (max <= 0) return [0];
  const ticks = [0];
  for (let value = step; value < max - 1e-9; value += step) ticks.push(value);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}

export type BarOutcome = { text: string; sellout: "at this pace" | "if best" | null };

export function barOutcome(bar: AllShowBar): BarOutcome {
  if (bar.allocation == null) return { text: "Set capacity on the event", sellout: null };
  if (bar.sold == null) return { text: "No ticket counts yet", sellout: null };
  const sold = formatCount(bar.sold);
  const cap = bar.allocation;
  if (bar.low != null && bar.low >= cap) return { text: `${sold} →`, sellout: "at this pace" };
  if (bar.high != null && bar.high >= cap && bar.low != null) {
    return { text: `${sold} → ${formatCount(bar.low)}–${formatCount(cap)} ·`, sellout: "if best" };
  }
  if (bar.low != null && bar.high != null) return { text: `${sold} → ${formatCount(bar.low)}–${formatCount(bar.high)}`, sellout: null };
  return { text: sold, sellout: null };
}

export type TrajectorySums = {
  sold: number;
  capacity: number;
  holds: number;
  high: number;
  shows: number;
};

/** Shows with a count and a capacity. Others stay on the chart and out of the sums. */
export function trajectorySums(bars: readonly AllShowBar[]): TrajectorySums {
  const counted = bars.filter((bar) => bar.sold != null && bar.allocation != null);
  const cap = (bar: AllShowBar, value: number | null) => Math.min(value ?? bar.sold ?? 0, bar.allocation ?? 0);
  return {
    sold: counted.reduce((sum, bar) => sum + (bar.sold ?? 0), 0),
    capacity: counted.reduce((sum, bar) => sum + (bar.allocation ?? 0), 0),
    holds: counted.reduce((sum, bar) => sum + cap(bar, bar.low), 0),
    high: counted.reduce((sum, bar) => sum + cap(bar, bar.high ?? bar.low), 0),
    shows: counted.length,
  };
}

export function shareOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}
