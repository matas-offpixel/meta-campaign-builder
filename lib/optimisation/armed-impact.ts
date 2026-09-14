/**
 * What the loop did, and what the metric did — next to each other.
 * Never multiplied. A CPR move after a +15% is not evidence the
 * +15% caused it. There is no control group.
 */

import type { DecisionRowView } from "./automation-ui.ts";

/** Series window. Write sum is all applied rows in the same scan. */
export const IMPACT_SERIES_DAYS = 7;

export type ArmedImpact = {
  writeCount: number;
  netDailyBudgetPence: number | null;
  currentDailyBudgetPence: number | null;
  metric: string | null;
  metricWindow: string | null;
  metricFirst: number | null;
  metricLatest: number | null;
  metricSeries: number[];
  resultFirst: number | null;
  resultLatest: number | null;
  resultPresentCount: number;
  resultSeries: Array<number | null>;
  /** Distinct ad-set keys in the latest write map. Campaign-scope writes are 0. */
  adSetCount: number;
  writeByAdSetPence: Record<string, number>;
  writeCampaignPence: number | null;
};

export type ImpactInput = {
  metric: string | null;
  metricWindow: string | null;
  seriesSince: Date;
};

function isWrite(row: DecisionRowView): boolean {
  return row.applied === true && row.dryRun === false;
}

function latestWriteMap(
  writes: readonly DecisionRowView[],
): Map<string, DecisionRowView> {
  const campaignWrites = writes.filter((row) => row.scope === "campaign");
  const pool = campaignWrites.length > 0 ? campaignWrites : writes;
  const latest = new Map<string, DecisionRowView>();
  for (const row of pool) {
    const key =
      row.scope === "campaign" ? "campaign" : (row.adsetId ?? row.decidedAt);
    const existing = latest.get(key);
    if (!existing || row.decidedAt >= existing.decidedAt) {
      latest.set(key, row);
    }
  }
  return latest;
}

function currentDailyFromWrites(writes: readonly DecisionRowView[]): number | null {
  if (writes.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const row of latestWriteMap(writes).values()) {
    if (row.budgetAfterPence == null) continue;
    sum += row.budgetAfterPence;
    any = true;
  }
  return any ? sum : null;
}

function adSetCountFromWrites(writes: readonly DecisionRowView[]): number {
  if (writes.length === 0) return 0;
  let n = 0;
  for (const key of latestWriteMap(writes).keys()) {
    if (key !== "campaign") n += 1;
  }
  return n;
}

function writeOverlay(writes: readonly DecisionRowView[]): {
  writeByAdSetPence: Record<string, number>;
  writeCampaignPence: number | null;
} {
  const writeByAdSetPence: Record<string, number> = {};
  let writeCampaignPence: number | null = null;
  if (writes.length === 0) return { writeByAdSetPence, writeCampaignPence };
  for (const [key, row] of latestWriteMap(writes)) {
    if (row.budgetAfterPence == null) continue;
    if (key === "campaign") writeCampaignPence = row.budgetAfterPence;
    else writeByAdSetPence[key] = row.budgetAfterPence;
  }
  return { writeByAdSetPence, writeCampaignPence };
}

export function impactFromRows(
  rows: readonly DecisionRowView[],
  input: ImpactInput,
): ArmedImpact {
  const writes = rows.filter(isWrite);
  let net = 0;
  let netAny = false;
  for (const row of writes) {
    if (row.budgetAfterPence == null || row.budgetBeforePence == null) continue;
    net += row.budgetAfterPence - row.budgetBeforePence;
    netAny = true;
  }

  const sinceMs = input.seriesSince.getTime();
  const wantMetric = input.metric;
  const seriesRows = rows
    .filter((row) => {
      const at = new Date(row.decidedAt).getTime();
      if (Number.isNaN(at) || at < sinceMs) return false;
      if (wantMetric && row.metric && row.metric !== wantMetric) return false;
      return true;
    })
    .slice()
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));

  const metricValues = seriesRows
    .map((row) => row.metricValue)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const resultSeries = seriesRows.map((row) =>
    row.resultCount != null && Number.isFinite(row.resultCount) ? row.resultCount : null,
  );
  const resultPresent = resultSeries.filter((value): value is number => value != null);

  return {
    writeCount: writes.length,
    netDailyBudgetPence: writes.length === 0 || !netAny ? null : net,
    currentDailyBudgetPence: currentDailyFromWrites(writes),
    metric: input.metric,
    metricWindow: input.metricWindow,
    metricFirst: metricValues[0] ?? null,
    metricLatest: metricValues.length > 0 ? (metricValues[metricValues.length - 1] ?? null) : null,
    metricSeries: metricValues,
    resultFirst: resultPresent[0] ?? null,
    resultLatest: resultPresent.length > 0 ? (resultPresent[resultPresent.length - 1] ?? null) : null,
    resultPresentCount: resultPresent.length,
    resultSeries,
    adSetCount: adSetCountFromWrites(writes),
    ...writeOverlay(writes),
  };
}

function formatMoney(pence: number, currency: string): string {
  const amount = pence / 100;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatBudgetImpactLine(impact: ArmedImpact, currency: string): string {
  if (impact.writeCount === 0) return "no writes yet";
  const writes = impact.writeCount === 1 ? "1 write" : `${impact.writeCount} writes`;
  const net = impact.netDailyBudgetPence ?? 0;
  const signed =
    net > 0
      ? `+${formatMoney(net, currency)}/day`
      : net < 0
        ? `−${formatMoney(Math.abs(net), currency)}/day`
        : `${formatMoney(0, currency)}/day`;
  if (impact.currentDailyBudgetPence == null) {
    return `${signed} · ${writes}`;
  }
  return `${signed} · ${writes} · daily budget now ${formatMoney(impact.currentDailyBudgetPence, currency)}`;
}

function formatPoint(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}

function formatRange(first: number | null, latest: number | null): string | null {
  if (first == null && latest == null) return null;
  if (first != null && latest != null && first !== latest) {
    return `${formatPoint(first)} → ${formatPoint(latest)}`;
  }
  const only = latest ?? first;
  return only == null ? null : formatPoint(only);
}

export function formatMetricImpactLine(impact: ArmedImpact): string | null {
  const range = formatRange(impact.metricFirst, impact.metricLatest);
  if (range == null || !impact.metric) return null;
  const window = impact.metricWindow ? ` · ${impact.metricWindow}` : "";
  return `${impact.metric}${window} ${range}`;
}

export function formatResultImpactLine(impact: ArmedImpact): string | null {
  if (impact.resultPresentCount === 0) return null;
  const range = formatRange(impact.resultFirst, impact.resultLatest);
  if (range == null) return null;
  return `results ${range}`;
}
