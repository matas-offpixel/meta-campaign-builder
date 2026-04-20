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
const COL_AUDIENCE = "audience";

function normaliseGender(value: unknown): TikTokGender {
  if (value == null) return "Unknown";
  const trimmed = String(value).trim().toLowerCase();
  if (trimmed === "male" || trimmed === "m") return "Male";
  if (trimmed === "female" || trimmed === "f") return "Female";
  return "Unknown";
}

/**
 * Split a TikTok combined-pivot Audience cell of the form
 * `<age-bucket> - <gender>` (e.g. "18-24 - Male", "65+ - Female") into
 * its two parts. Returns null when the cell doesn't carry the dash
 * separator so the caller can skip the row safely.
 */
function splitAudienceCell(
  value: string,
): { age_bucket: string; gender: TikTokGender } | null {
  const parts = value.split(/\s+-\s+/);
  if (parts.length < 2) return null;
  const age = parts[0].trim();
  const gender = parts.slice(1).join(" - ").trim();
  if (!age || !gender) return null;
  return { age_bucket: age, gender: normaliseGender(gender) };
}

/**
 * Parse a demographic-breakdown sheet (rows include the header row at
 * index 0). Skips blank/total rows.
 *
 * Two header layouts are supported:
 *   - Classic two-column pivot: separate `Age` + `Gender` columns.
 *   - Combined Audience pivot: a single `Audience` column whose cells
 *     read "<age-bucket> - <gender>" (e.g. "18-24 - Male"). Split in
 *     {@link splitAudienceCell}; rows whose cell doesn't carry the
 *     separator are silently dropped (they're typically the geo rows
 *     in the same combined export, routed elsewhere by detection).
 *
 * Age is taken verbatim from the source cell ("13-17", "18-24", "65+",
 * …); TikTok's bucket labels are stable so the UI just renders them.
 */
export function parseDemographicSheet(
  rows: readonly (readonly unknown[])[],
): TikTokDemographicRow[] {
  if (rows.length < 2) return [];
  const [headerRow, ...dataRows] = rows;
  const headerIndex = buildHeaderIndex(headerRow);
  const ageCol = headerIndex[COL_AGE];
  const genderCol = headerIndex[COL_GENDER];
  const audienceCol = headerIndex[COL_AUDIENCE];

  const useCombined =
    (ageCol == null || genderCol == null) && audienceCol != null;
  if (!useCombined && (ageCol == null || genderCol == null)) return [];

  const out: TikTokDemographicRow[] = [];

  for (const row of dataRows) {
    if (useCombined) {
      const audienceCell = row[audienceCol as number];
      if (isSkippableRow(audienceCell)) continue;
      const split = splitAudienceCell(String(audienceCell).trim());
      if (!split) continue;
      const metric = parseMetricBlock(row, headerIndex);
      out.push({
        ...metric,
        age_bucket: split.age_bucket,
        gender: split.gender,
      });
      continue;
    }

    const ageCell = row[ageCol as number];
    if (isSkippableRow(ageCell)) continue;
    const metric = parseMetricBlock(row, headerIndex);
    out.push({
      ...metric,
      age_bucket: String(ageCell).trim(),
      gender: normaliseGender(row[genderCol as number]),
    });
  }

  return out;
}
