/**
 * lib/tiktok/parsers/interest.ts
 *
 * Interest / audience breakdown XLSX parser. Each row is one TikTok
 * interest taxonomy label; the parser tags it with a coarse vertical
 * bucket via {@link classifyVertical} so the dashboard can group
 * interests for display.
 */

import type { TikTokInterestRow } from "@/lib/types/tiktok";

import { classifyVertical } from "../verticals.ts";
import {
  buildHeaderIndex,
  isSkippableRow,
  parseMetricBlock,
} from "./shared.ts";

const COL_AUDIENCE = "audience";
const COL_INTEREST = "interest";

/**
 * Parse an interest-breakdown sheet (rows include the header row at
 * index 0). The leftmost label column may be titled "Audience" or
 * "Interest" depending on TikTok export version — both are accepted.
 */
export function parseInterestSheet(
  rows: readonly (readonly unknown[])[],
): TikTokInterestRow[] {
  if (rows.length < 2) return [];
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  const labelCol = headerIndex[COL_AUDIENCE] ?? headerIndex[COL_INTEREST];
  if (labelCol == null) return [];

  const out: TikTokInterestRow[] = [];

  for (const row of dataRows) {
    const labelCell = row[labelCol];
    if (isSkippableRow(labelCell)) continue;

    const audienceLabel = String(labelCell).trim();
    const metric = parseMetricBlock(row, headerIndex);
    out.push({
      ...metric,
      audience_label: audienceLabel,
      vertical: classifyVertical(audienceLabel),
    });
  }

  return out;
}
