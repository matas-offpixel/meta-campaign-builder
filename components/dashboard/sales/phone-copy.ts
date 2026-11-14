/**
 * Dashboard v2 on a phone (docs/design-record/2026-11-14-dashboard-v2-phone.html):
 * the words below 640 px, word for word from the record. Desktop words stay
 * in tile-copy.ts.
 */

import type { AllShowBar, FreshnessStamp, SalesMetricId, SalesPeriod, SalesTile, TrajectoryTile } from "@/lib/dashboard/sales-vs-spend";

import { periodSpan } from "./tile-copy";

/** MB3: the six key figures, in order. Pace and Projected come from the trajectory. */
export const KEY_TILE_IDS: readonly SalesMetricId[] = ["spend", "sold", "costPerTicket", "registrations"];
/** MB4: the other eight, in N7's order. */
export const MORE_TILE_IDS: readonly SalesMetricId[] = [
  "tickets",
  "checkoutActions",
  "costPerCheckout",
  "lpv",
  "costPerLpv",
  "clicks",
  "cpc",
  "costPerRegistration",
];
/** An umbrella has no Total sold, Sales or Cost per ticket and no trajectory: its key figures are these. */
export const UMBRELLA_KEY_TILE_IDS: readonly SalesMetricId[] = ["spend", "registrations", "costPerRegistration"];

export const MORE_FIGURES_HINT = "sales, checkouts, LPVs, clicks, costs";
export const CHART_HOW = "Swipe for earlier dates · press and hold for a day.";
export const CHART_DOT = "A dot is a real Internal Count; between counts the line is a straight estimate.";
export const INDEX_LABEL = "Index to own peak";
export const TRAJECTORY_KEY = "Dark: sold. Mid: holds at the last 7 days' pace. Light: like your best finish. Dashed: capacity.";

export function moreFiguresLabel(open: boolean, count: number): { action: string; hint: string } {
  return open ? { action: "Fewer figures", hint: `${count} more shown` } : { action: `More figures (${count})`, hint: MORE_FIGURES_HINT };
}

/** MB2: one muted line, "Counts 12 Nov · Spend 13 Nov · Signups 13 Nov". */
export function stampLine(stamps: readonly FreshnessStamp[]): string {
  return stamps.map((s) => s.narrow).join(" · ");
}

/**
 * MB3 / MB4: a tile's one-line span on a phone. The full subline (N3, N7)
 * moves to a press and hold on the tile.
 */
export function phoneSpan(
  id: SalesMetricId,
  period: SalesPeriod,
  countLabel: string,
  tile: Pick<SalesTile, "narrowDetail" | "title">,
): string {
  const span = periodSpan(period);
  const launch = period === "launch";
  switch (id) {
    case "spend":
      return span;
    case "sold":
      return tile.narrowDetail.replace(/^to date · /, "") || `Internal Counts, ${countLabel}`;
    case "costPerTicket":
      if (!launch) return span;
      return /each show's last count/.test(tile.title) ? "spend to each show's last count" : `spend to the ${countLabel} count`;
    case "registrations":
      return launch ? "show pages, to date" : span;
    case "tickets":
      return launch ? `since launch, to ${countLabel}` : span;
    case "checkoutActions":
      return `${span} · actions`;
    case "costPerCheckout":
    case "costPerLpv":
    case "cpc":
      return "Meta spend only";
    case "costPerRegistration":
      return "inside signup windows";
    default:
      return span;
  }
}

/** MB3: Projected's span, short for "up to 77% of 14,000 · each show capped at its capacity". */
export function projectedSpan(tile: TrajectoryTile): string {
  const share = /up to (\d+%)/.exec(tile.detail);
  return share ? `on show day · up to ${share[1]}` : "on show day";
}

/** MB7: "Sales trajectory · capacity 2,000 each" when every show with a capacity has the same one. */
export function trajectoryTitle(bars: readonly AllShowBar[]): string {
  const caps = [...new Set(bars.map((b) => b.allocation).filter((c): c is number => c != null))];
  return caps.length === 1 ? `Sales trajectory · capacity ${caps[0].toLocaleString("en-GB")} each` : "Sales trajectory";
}

/** MB7: the show's name without its date, and the figures in short ("1,870 → sells out"). */
export function phoneBar(bar: AllShowBar): { name: string; figures: string } {
  return { name: bar.label.replace(/ · \d{1,2} \w{3}$/, ""), figures: bar.caption.replace(/ at this pace$/, "") };
}

/** MB7: "Campaigns · 29 · 7 spending". */
export function campaignsRow(rows: readonly { delivery: string }[]): string {
  const spending = rows.filter((r) => r.delivery === "Spending").length;
  return `Campaigns · ${rows.length} · ${spending} spending`;
}
