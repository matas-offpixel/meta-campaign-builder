/**
 * lib/tiktok/parsers/demographic.ts
 *
 * Demographic-breakdown XLSX parser. Each row is one (age bucket × gender)
 * cell from TikTok's pivot. Genders other than Male / Female / Unknown
 * coerce to "Unknown" so downstream code only deals with the typed union.
 */

import type {
  TikTokDemographicRow,
  TikTokGender,
} from "@/lib/types/tiktok";

import {
  buildHeaderIndex,
  isSkippableRow,
  parseMetricBlock,
} from "./shared.ts";

const COL_AGE = "age";
const COL_GENDER = "gender";

function normaliseGender(value: unknown): TikTokGender {
  if (value == null) return "Unknown";
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed === "male" || trimmed === "m") return "Male";
  if (trimmed === "female" || trimmed === "f") return "Female";
  return "Unknown";
}

/**
 * Parse a demographic-breakdown sheet (rows include the header row at
 * index 0). Skips blank/total rows.
 *
 * Age is taken verbatim from the cell ("13–17", "18–24", "65+", …) since
 * TikTok's bucket labels are stable and the UI just renders them as-is.
 */
export function parseDemographicSheet(
  rows: readonly (readonly unknown[])[],
): TikTokDemographicRow[] {
  if (rows.length < 2) return [];
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  const ageCol = headerIndex[COL_AGE];
  const genderCol = headerIndex[COL_GENDER];
  if (ageCol == null || genderCol == null) return [];

  const out: TikTokDemographicRow[] = [];

  for (const row of dataRows) {
    const ageCell = row[ageCol];
    if (isSkippableRow(ageCell)) continue;

    const metric = parseMetricBlock(row, headerIndex);
    out.push({
      ...metric,
      age_bucket: String(ageCell).trim(),
      gender: normaliseGender(row[genderCol]),
    });
  }

  return out;
}
