/**
 * lib/tiktok/parsers/campaign.ts
 *
 * Campaign-totals XLSX parser. Most exports we've seen contain a single
 * data row (one campaign per file) — when the export carries multiple
 * campaigns, the import route is responsible for filtering down to the
 * one selected by the user; this parser just returns the first valid
 * row it finds. Returns null when the sheet has no data rows after
 * skipping headers / totals.
 */

import type { TikTokCampaignTotals } from "@/lib/types/tiktok";

import {
  buildHeaderIndex,
  isSkippableRow,
  parseCurrencyFromCell,
  parseMetricBlock,
  parseNumberCell,
  parseStatusCell,
} from "./shared.ts";

const COL_CAMPAIGN_NAME = "campaign name";
const COL_PRIMARY_STATUS = "primary status";
const COL_REACH = "reach";
const COL_COST_PER_1000_REACHED = "cost per 1,000 people reached";
const COL_COST_PER_1000_REACHED_ALT = "cost per 1000 reached";
const COL_FREQUENCY = "frequency";
const COL_CLICKS_ALL = "clicks (all)";
const COL_CTR_ALL = "ctr (all)";
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
 * Parse a campaign totals sheet (rows include the header row at index 0).
 *
 * Skips blank, total, and summary rows. Returns the first surviving row
 * coerced to `TikTokCampaignTotals`, or null when nothing usable found.
 *
 * `objective` / `budget_mode` / `budget_amount` are intentionally not
 * read here — TikTok's XLSX export omits them, so the import route
 * collects them from the form (or backfills via API once OAuth lands).
 */
export function parseCampaignSheet(
  rows: readonly (readonly unknown[])[],
): TikTokCampaignTotals | null {
  if (rows.length < 2) return null;
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  const nameCol = headerIndex[COL_CAMPAIGN_NAME];
  if (nameCol == null) return null;

  for (const row of dataRows) {
    const firstCell = row[nameCol];
    if (isSkippableRow(firstCell)) continue;

    const metric = parseMetricBlock(row, headerIndex);
    const costCell = row[headerIndex[COL_COST] ?? -1];

    return {
      ...metric,
      campaign_name: String(firstCell).trim(),
      primary_status:
        parseStatusCell(pickCell(row, headerIndex, COL_PRIMARY_STATUS)) ?? "",
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
      currency: parseCurrencyFromCell(costCell),
      objective: null,
      budget_mode: null,
      budget_amount: null,
    };
  }

  return null;
}
