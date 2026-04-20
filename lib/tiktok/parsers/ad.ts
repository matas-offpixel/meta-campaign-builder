/**
 * lib/tiktok/parsers/ad.ts
 *
 * Ad-level XLSX parser. One row per ad (creative). The status / source
 * fields coerce TikTok's "--" placeholders to `null` via parseStatusCell
 * so downstream code can branch on truthiness without string equality.
 */

import type { TikTokAdRow } from "@/lib/types/tiktok";

import {
  buildHeaderIndex,
  isSkippableRow,
  parseCurrencyFromCell,
  parseMetricBlock,
  parseNumberCell,
  parseStatusCell,
} from "./shared.ts";

const COL_AD_NAME = "ad name";
const COL_PRIMARY_STATUS = "primary status";
const COL_SECONDARY_STATUS = "secondary status";
const COL_REACH = "reach";
const COL_COST_PER_1000_REACHED = "cost per 1,000 people reached";
const COL_COST_PER_1000_REACHED_ALT = "cost per 1000 reached";
const COL_FREQUENCY = "frequency";
const COL_CLICKS_ALL = "clicks (all)";
const COL_CTR_ALL = "ctr (all)";
const COL_SECONDARY_SOURCE = "secondary source";
const COL_PRIMARY_SOURCE = "primary source";
const COL_ATTRIBUTION_SOURCE = "attribution source";
const COL_COST = "cost";

function pickCell(
  row: readonly unknown[],
  headerIndex: Record<string, number>,
  ...keys: readonly string[]
): unknown {
  for (const key of keys) {
    const idx = headerIndex[key];
    if (idx != null && idx >= 0) return row[idx];
  }
  return null;
}

/**
 * Parse an ad-level sheet (rows include the header row at index 0).
 *
 * Skips blank/total rows; returns one `TikTokAdRow` per surviving data
 * row in original order. The import route is free to re-sort downstream.
 */
export function parseAdSheet(
  rows: readonly (readonly unknown[])[],
): TikTokAdRow[] {
  if (rows.length < 2) return [];
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  const nameCol = headerIndex[COL_AD_NAME];
  if (nameCol == null) return [];

  const out: TikTokAdRow[] = [];

  for (const row of dataRows) {
    const firstCell = row[nameCol];
    if (isSkippableRow(firstCell)) continue;

    const metric = parseMetricBlock(row, headerIndex);
    const costCell = row[headerIndex[COL_COST] ?? -1];

    out.push({
      ...metric,
      ad_name: String(firstCell).trim(),
      primary_status:
        parseStatusCell(pickCell(row, headerIndex, COL_PRIMARY_STATUS)) ?? "",
      secondary_status:
        parseStatusCell(pickCell(row, headerIndex, COL_SECONDARY_STATUS)) ??
        "",
      reach: parseNumberCell(pickCell(row, headerIndex, COL_REACH)),
      cost_per_1000_reached: parseNumberCell(
        pickCell(
          row,
          headerIndex,
          COL_COST_PER_1000_REACHED,
          COL_COST_PER_1000_REACHED_ALT,
        ),
      ),
      frequency: parseNumberCell(pickCell(row, headerIndex, COL_FREQUENCY)),
      clicks_all: parseNumberCell(pickCell(row, headerIndex, COL_CLICKS_ALL)),
      ctr_all: parseNumberCell(pickCell(row, headerIndex, COL_CTR_ALL)),
      secondary_source: parseStatusCell(
        pickCell(row, headerIndex, COL_SECONDARY_SOURCE),
      ),
      primary_source: parseStatusCell(
        pickCell(row, headerIndex, COL_PRIMARY_SOURCE),
      ),
      attribution_source: parseStatusCell(
        pickCell(row, headerIndex, COL_ATTRIBUTION_SOURCE),
      ),
      currency: parseCurrencyFromCell(costCell),
    });
  }

  return out;
}
