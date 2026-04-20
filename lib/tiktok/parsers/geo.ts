/**
 * lib/tiktok/parsers/geo.ts
 *
 * Geo-breakdown XLSX parser. Region type (country / region / city) is
 * inferred from the leftmost column header — TikTok exports each level
 * as a separate file rather than a discriminator column.
 */

import type {
  TikTokGeoRegionType,
  TikTokGeoRow,
} from "@/lib/types/tiktok";

import {
  buildHeaderIndex,
  isSkippableRow,
  normaliseHeader,
  parseMetricBlock,
} from "./shared.ts";

function inferRegionType(
  firstHeader: unknown,
): { name: string; type: TikTokGeoRegionType } | null {
  const norm = normaliseHeader(firstHeader);
  if (norm === "country") return { name: "Country", type: "country" };
  if (norm === "region") return { name: "Region", type: "region" };
  if (norm === "city") return { name: "City", type: "city" };
  // TikTok also exports geo breakdowns under a generic "Audience" first
  // column (the same header used for the demographic pivot). Detection
  // in `shared.ts#detectFileType` already disambiguates by sampling the
  // first data row; once routed here we treat the cell as a region label
  // and persist `region_type: "region"` since UK exports almost always
  // sit at the region level (England / Scotland / Wales / NI).
  if (norm === "audience") return { name: "Audience", type: "region" };
  return null;
}

/**
 * Parse a geo-breakdown sheet (rows include the header row at index 0).
 *
 * Returns one row per geo (country / region / city). The leftmost
 * column's header drives `region_type`; values are taken from that
 * same column. Blank, total and summary rows are skipped.
 */
export function parseGeoSheet(
  rows: readonly (readonly unknown[])[],
): TikTokGeoRow[] {
  if (rows.length < 2) return [];
  const [headerRow, ...dataRows] = rows;
  const region = inferRegionType(headerRow[0]);
  if (!region) return [];
  const headerIndex = buildHeaderIndex(headerRow);

  const out: TikTokGeoRow[] = [];

  for (const row of dataRows) {
    const firstCell = row[0];
    if (isSkippableRow(firstCell)) continue;

    const metric = parseMetricBlock(row, headerIndex);
    out.push({
      ...metric,
      region_name: String(firstCell).trim(),
      region_type: region.type,
    });
  }

  return out;
}
