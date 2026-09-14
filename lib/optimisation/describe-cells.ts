/**
 * Phase 1 describe. Groups launched_ad_sets and names the numbers.
 * Does not rank. Does not write. Tune the gate once there is data.
 *
 * Gate starting values (2026-09-14): n ≥ 5 ad sets AND ≥ 3 distinct
 * campaigns AND ≥ £500 cumulative daily budget. Budget is
 * initial_daily_budget_pence × inclusive UTC days since launched_at
 * (budget-days since launch), accrued to now regardless of ad set
 * state. A paused ad set still counts. Never labelled spend.
 */

export const DESCRIBE_MIN_AD_SETS = 5;
export const DESCRIBE_MIN_CAMPAIGNS = 3;
export const DESCRIBE_MIN_BUDGET_PENCE = 50_000;

export type DescribeLaunchedRow = {
  clientId: string;
  metaAdsetId: string;
  draftId: string | null;
  metaCampaignId: string | null;
  sourceType: string | null;
  objective: string | null;
  phaseAtLaunch: string | null;
  advantagePlusEffective: boolean | null;
  descriptorSource: string | null;
  initialDailyBudgetPence: number | null;
  launchedAt: string;
};

export type DescribeDecisionPoint = {
  metaAdsetId: string;
  metric: string | null;
  metricValue: number | null;
  decidedAt: string;
};

export type DescribeCellKey = {
  clientId: string;
  sourceType: string;
  objective: string;
  phaseAtLaunch: string;
  advantagePlusEffective: boolean | null;
};

export type DescribeCell = {
  key: DescribeCellKey;
  n: number;
  nLaunch: number;
  nBackfill: number;
  campaignCount: number;
  budgetPence: number;
  metricName: string | null;
  metricN: number;
  metricMedian: number | null;
  metricMin: number | null;
  metricMax: number | null;
  reportable: boolean;
  draftIds: string[];
  adSetsByDraft: Record<string, number>;
  latestLaunchedAtByDraft: Record<string, string>;
  metaAdsetIds: string[];
};

function inclusiveUtcDays(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 1;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
}

function cellKeyOf(row: DescribeLaunchedRow): string {
  return [
    row.clientId || "unknown",
    row.sourceType ?? "unknown",
    row.objective ?? "unknown",
    row.phaseAtLaunch ?? "unknown",
    row.advantagePlusEffective === true
      ? "a+"
      : row.advantagePlusEffective === false
        ? "no-a+"
        : "a+-unset",
  ].join("|");
}

function parseKey(key: string): DescribeCellKey {
  const [clientId, sourceType, objective, phaseAtLaunch, aPlus] = key.split("|");
  return {
    clientId: clientId || "unknown",
    sourceType: sourceType || "unknown",
    objective: objective || "unknown",
    phaseAtLaunch: phaseAtLaunch || "unknown",
    advantagePlusEffective:
      aPlus === "a+" ? true : aPlus === "no-a+" ? false : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function latestMetricByAdSet(
  points: DescribeDecisionPoint[],
): Map<string, { metric: string; value: number }> {
  const latest = new Map<string, DescribeDecisionPoint>();
  for (const point of points) {
    if (point.metricValue == null || !Number.isFinite(point.metricValue)) continue;
    if (!point.metric?.trim()) continue;
    const prev = latest.get(point.metaAdsetId);
    if (!prev || point.decidedAt > prev.decidedAt) latest.set(point.metaAdsetId, point);
  }
  const out = new Map<string, { metric: string; value: number }>();
  for (const [id, point] of latest) {
    out.set(id, { metric: point.metric!.trim(), value: point.metricValue! });
  }
  return out;
}

export function buildDescribeCells(
  rows: DescribeLaunchedRow[],
  points: DescribeDecisionPoint[],
  now: Date = new Date(),
): DescribeCell[] {
  const grouped = new Map<string, DescribeLaunchedRow[]>();
  for (const row of rows) {
    const key = cellKeyOf(row);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const metrics = latestMetricByAdSet(points);
  const cells: DescribeCell[] = [];

  for (const [rawKey, members] of grouped) {
    const adSetsByDraft: Record<string, number> = {};
    const latestLaunchedAtByDraft: Record<string, string> = {};
    for (const row of members) {
      if (!row.draftId) continue;
      adSetsByDraft[row.draftId] = (adSetsByDraft[row.draftId] ?? 0) + 1;
      const prevLaunch = latestLaunchedAtByDraft[row.draftId];
      if (!prevLaunch || row.launchedAt > prevLaunch) {
        latestLaunchedAtByDraft[row.draftId] = row.launchedAt;
      }
    }
    const draftIds = Object.keys(adSetsByDraft);
    const campaignIds = [
      ...new Set(
        members
          .map((row) => row.metaCampaignId || row.draftId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const nLaunch = members.filter((row) => row.descriptorSource === "launch").length;
    const nBackfill = members.filter(
      (row) => row.descriptorSource === "backfill_from_launch_summary",
    ).length;
    let budgetPence = 0;
    for (const row of members) {
      const daily = row.initialDailyBudgetPence ?? 0;
      budgetPence += daily * inclusiveUtcDays(row.launchedAt, now);
    }

    const cellMetrics = members
      .map((row) => metrics.get(row.metaAdsetId))
      .filter((item): item is { metric: string; value: number } => item != null);
    const metricCounts = new Map<string, number>();
    for (const item of cellMetrics) {
      metricCounts.set(item.metric, (metricCounts.get(item.metric) ?? 0) + 1);
    }
    let metricName: string | null = null;
    let metricWins = 0;
    for (const [name, count] of metricCounts) {
      if (count > metricWins) {
        metricName = name;
        metricWins = count;
      }
    }
    const values = cellMetrics
      .filter((item) => item.metric === metricName)
      .map((item) => item.value);
    const n = members.length;
    const campaignCount = campaignIds.length;
    const reportable =
      n >= DESCRIBE_MIN_AD_SETS &&
      campaignCount >= DESCRIBE_MIN_CAMPAIGNS &&
      budgetPence >= DESCRIBE_MIN_BUDGET_PENCE;

    cells.push({
      key: parseKey(rawKey),
      n,
      nLaunch,
      nBackfill,
      campaignCount,
      budgetPence,
      metricName,
      metricN: cellMetrics.length,
      metricMedian: median(values),
      metricMin: values.length ? Math.min(...values) : null,
      metricMax: values.length ? Math.max(...values) : null,
      reportable,
      draftIds,
      adSetsByDraft,
      latestLaunchedAtByDraft,
      metaAdsetIds: members.map((row) => row.metaAdsetId),
    });
  }

  // Order by n, descending, then the group key. An order, not a verdict.
  cells.sort((a, b) => {
    if (a.n !== b.n) return b.n - a.n;
    return cellKeyString(a.key).localeCompare(cellKeyString(b.key));
  });
  return cells;
}

function cellKeyString(key: DescribeCellKey): string {
  return [
    key.clientId,
    key.sourceType,
    key.objective,
    key.phaseAtLaunch,
    key.advantagePlusEffective === true
      ? "a+"
      : key.advantagePlusEffective === false
        ? "no-a+"
        : "a+-unset",
  ].join("|");
}

function formatMoneyRange(min: number, max: number): string {
  const fmt = (n: number) => (Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2));
  return `${fmt(min)}–${fmt(max)}`;
}

function formatKey(key: DescribeCellKey): string {
  const aPlus =
    key.advantagePlusEffective === true
      ? "a+"
      : key.advantagePlusEffective === false
        ? "no a+"
        : "a+ unset";
  return `${key.sourceType} · ${key.objective} · ${key.phaseAtLaunch} · ${aPlus}`;
}

function formatBudgetPence(pence: number): string {
  const pounds = pence / 100;
  return Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
}

export function formatDescribeCellLine(cell: DescribeCell): string {
  const head = formatKey(cell.key);
  const provenance = `n_launch=${cell.nLaunch} · n_backfill=${cell.nBackfill}`;
  const budget = `budget ${formatBudgetPence(cell.budgetPence)} (budget-days since launch)`;
  const metricN = `metric n=${cell.metricN}`;
  if (!cell.reportable) {
    const campaigns =
      cell.campaignCount === 1 ? "1 campaign" : `${cell.campaignCount} campaigns`;
    return `${head} — not enough data — n=${cell.n}, ${campaigns} · ${provenance} · ${budget} · ${metricN}`;
  }
  const range =
    cell.metricName && cell.metricMin != null && cell.metricMax != null
      ? `${cell.metricName} ${formatMoneyRange(cell.metricMin, cell.metricMax)}`
      : "no metric yet";
  return `${head} — ${cell.n} ad sets, ${cell.campaignCount} campaigns, ${provenance}, ${budget}, ${range}, ${metricN}`;
}

export function formatEmptyDescribeTable(): string {
  return "not enough data — n=0";
}

export function formatDescribeUnreadable(): string {
  return "cells unreadable";
}

export function describeLineForDraft(cells: DescribeCell[], draftId: string): string {
  const cell = cellForDraft(cells, draftId);
  if (!cell) return "not enough data";
  return formatDescribeCellLine(cell);
}

/**
 * Majority cell for a draft. Split drafts take the cell with more of
 * their ad sets. Equal counts take the more recent launched_at.
 * When launched_at ties (one launch run stamps new Date() on every
 * ad set), the first cell in the n-then-key order stays — Meta create
 * order if the stamps differ by milliseconds, sort position if they
 * do not. Neither is a preference.
 */
export function cellForDraft(cells: DescribeCell[], draftId: string): DescribeCell | null {
  let picked: DescribeCell | null = null;
  let count = 0;
  for (const cell of cells) {
    const n = cell.adSetsByDraft[draftId] ?? 0;
    if (n > count) {
      picked = cell;
      count = n;
      continue;
    }
    if (n === count && n > 0 && picked) {
      const nextLaunch = cell.latestLaunchedAtByDraft[draftId] ?? "";
      const pickedLaunch = picked.latestLaunchedAtByDraft[draftId] ?? "";
      if (nextLaunch > pickedLaunch) picked = cell;
    }
  }
  return picked;
}
