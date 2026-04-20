/**
 * lib/tiktok/parsers/shared.ts
 *
 * Shared parsing primitives for TikTok manual XLSX/CSV report exports.
 *
 * The team drops up to seven sheets at a time into the dashboard import
 * dropzone (campaign totals, per-ad, geo, demographic, interest, search
 * term). We auto-detect each file's shape from its header row and route
 * the rows through the matching per-shape parser. Everything in this
 * module is shape-agnostic — header detection, the canonical metric
 * column list, and the cell-coercion primitives that every parser uses.
 *
 * Number coercion preserves TikTok's display scale: "1.23%" → 1.23 (not
 * 0.0123) and "£1.23" → 1.23 (currency is captured separately via
 * {@link parseCurrencyFromCell}). The "<5" masking token TikTok emits
 * on low-volume rows coerces to `null` and is preserved verbatim in
 * `impressions_raw` so the UI can render the original cell.
 */

import type { TikTokMetricBlock } from "@/lib/types/tiktok";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical metric column list.
//
// Maps the 16 numeric XLSX header strings to their `TikTokMetricBlock` field
// in the same order. `impressions_raw` is the one synthetic field on the
// block — it preserves "<5" and never appears as a column header, so it's
// not in this list.
//
// TikTok occasionally tweaks its export header wording (e.g. "Video views
// at 25%" vs "Video views (P25)"); each entry below carries an `aliases`
// array so the parser stays resilient when a header drifts. Detection /
// row mapping looks up by header → field; column order in the file is
// not significant once we have the index map.
// ─────────────────────────────────────────────────────────────────────────────

export type TikTokMetricField = keyof Omit<TikTokMetricBlock, "impressions_raw">;

interface MetricColumnSpec {
  /** Canonical XLSX header — what a fresh export emits today. */
  header: string;
  /** Field on TikTokMetricBlock this column maps to. */
  field: TikTokMetricField;
  /**
   * Alternate headers TikTok has shipped historically. Matched
   * case-insensitively after whitespace normalisation.
   */
  aliases?: readonly string[];
}

export const TIKTOK_METRIC_COLUMNS: readonly MetricColumnSpec[] = [
  { header: "Cost", field: "cost", aliases: ["Spend"] },
  { header: "Impressions", field: "impressions" },
  { header: "CPM", field: "cpm" },
  {
    header: "Clicks (destination)",
    field: "clicks_destination",
    aliases: ["Clicks(destination)", "Destination clicks"],
  },
  {
    header: "CPC (destination)",
    field: "cpc_destination",
    aliases: ["CPC(destination)"],
  },
  {
    header: "CTR (destination)",
    field: "ctr_destination",
    aliases: ["CTR(destination)"],
  },
  {
    header: "2-second video views",
    field: "video_views_2s",
    aliases: ["2s video views"],
  },
  {
    header: "6-second video views",
    field: "video_views_6s",
    aliases: ["6s video views"],
  },
  {
    header: "Video views at 25%",
    field: "video_views_p25",
    aliases: ["Video views (P25)", "P25 video views"],
  },
  {
    header: "Video views at 50%",
    field: "video_views_p50",
    aliases: ["Video views (P50)", "P50 video views"],
  },
  {
    header: "Video views at 75%",
    field: "video_views_p75",
    aliases: ["Video views (P75)", "P75 video views"],
  },
  {
    header: "Video views at 100%",
    field: "video_views_p100",
    aliases: ["Video views (P100)", "P100 video views"],
  },
  {
    header: "Average play time per user",
    field: "avg_play_time_per_user",
    aliases: ["Avg play time per user"],
  },
  {
    header: "Average play time per video view",
    field: "avg_play_time_per_video_view",
    aliases: ["Avg play time per video view"],
  },
  {
    header: "Interactive add-on impressions",
    field: "interactive_addon_impressions",
    aliases: ["Interactive addon impressions"],
  },
  {
    header: "Interactive add-on destination clicks",
    field: "interactive_addon_destination_clicks",
    aliases: ["Interactive addon destination clicks"],
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Header / file-type detection
// ─────────────────────────────────────────────────────────────────────────────

export type TikTokFileType =
  | "campaign"
  | "ad"
  | "geo"
  | "demographic"
  | "interest"
  | "search_term";

/**
 * Normalise a header cell for comparison: trim, collapse internal whitespace,
 * lower-case. TikTok's exports are inconsistent about non-breaking spaces
 * and trailing whitespace, so we strip aggressively.
 */
export function normaliseHeader(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/\u00a0/g, " ") // non-breaking space → regular space
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Returns true when `headers` contains every name in `needles` (after
 * normalisation). Order doesn't matter; presence does.
 */
export function headersInclude(
  headers: readonly string[],
  needles: readonly string[],
): boolean {
  const set = new Set(headers.map(normaliseHeader));
  return needles.every((n) => set.has(normaliseHeader(n)));
}

/**
 * Matches an "<age-bucket> - <gender>" cell from TikTok's combined
 * Audience-pivot demographic export. Examples: "18-24 - Male",
 * "25-34 - Female", "65+ - Unknown". Used by {@link detectFileType}
 * to disambiguate the leftmost-"Audience" case.
 */
const AGE_GENDER_CELL_RE = /^(?:\d+[-–]\d+|\d+\+)\s*-\s*[A-Za-z]+$/;

/**
 * Detects which TikTok report shape a file is from based on its header
 * row (and optionally the first data row). Returns null when the
 * headers don't match any known shape — the import route surfaces the
 * file's name in the `skipped` array and carries on so a single bad
 * file doesn't kill the whole batch.
 *
 * Detection is presence-based, not order-based: we look for the
 * distinctive first column(s) per shape. The one exception is the
 * leftmost-"Audience" path: TikTok exports both geo and demographic
 * breakdowns with a generic "Audience" first column (rather than
 * "Country" / "Age"+"Gender"), so when we see that we peek at the
 * first data cell — an "<age-bucket> - <gender>" shape (e.g.
 * "18-24 - Male") wins demographic; anything else (region / country
 * names like "England", "Unknown", "United Kingdom") wins geo. This
 * runs before the existing interest fallback so true interest exports
 * (leftmost "Interest", or "Audience" without an age-gender first
 * row but with an interest taxonomy label) still classify correctly.
 */
export function detectFileType(
  headerRow: readonly unknown[],
  firstDataRow?: readonly unknown[],
): TikTokFileType | null {
  const headers = headerRow.map((cell) => String(cell ?? ""));
  const norm = new Set(headers.map(normaliseHeader));
  const leftmost = normaliseHeader(headers[0]);

  if (norm.has("ad name")) return "ad";
  if (norm.has("campaign name") && norm.has("primary status")) return "campaign";
  if (norm.has("country") || norm.has("region") || norm.has("city")) {
    return "geo";
  }
  if (norm.has("age") && norm.has("gender")) return "demographic";

  if (leftmost === "audience") {
    const firstCell = firstDataRow?.[0];
    if (firstCell != null) {
      const value = String(firstCell).trim();
      if (AGE_GENDER_CELL_RE.test(value)) return "demographic";
      if (value !== "") return "geo";
    }
    // Couldn't sample the first row — fall through to the interest
    // fallback below so we don't regress files we used to detect.
  }

  if (norm.has("audience") || norm.has("interest")) return "interest";
  if (norm.has("search term")) return "search_term";

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cell coercion
// ─────────────────────────────────────────────────────────────────────────────

const MASKED_TOKEN_RE = /^<\s*5$/;
const NULL_TOKENS = new Set(["", "--", "—", "n/a", "na"]);

/**
 * Coerce a TikTok cell into a number while preserving display scale.
 *
 *   "<5"        → null  (caller handles `impressions_raw` if relevant)
 *   "--" / ""   → null
 *   "1,234.56"  → 1234.56
 *   "£1,234.56" → 1234.56
 *   "1.23%"     → 1.23   (NOT 0.0123 — keep the display number)
 *   "  3 "      → 3
 *   number      → number
 */
export function parseNumberCell(cell: unknown): number | null {
  if (cell == null) return null;
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? cell : null;
  }
  const raw = String(cell).trim();
  if (raw === "") return null;
  if (MASKED_TOKEN_RE.test(raw)) return null;
  if (NULL_TOKENS.has(raw.toLowerCase())) return null;

  // Strip currency symbols, percent sign, thousands separators. Keep the
  // sign and decimal point.
  const cleaned = raw
    .replace(/[\u00a3$€¥]/g, "") // £ $ € ¥
    .replace(/[A-Za-z]/g, "") // ISO codes like "GBP "
    .replace(/[,\s]/g, "")
    .replace(/%$/, "");

  if (cleaned === "" || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns true when a raw cell carries TikTok's "<5" low-volume mask.
 * Callers use this to populate `impressions_raw` while {@link parseNumberCell}
 * handles the numeric coercion to null.
 */
export function isMaskedCell(cell: unknown): boolean {
  if (cell == null) return false;
  return MASKED_TOKEN_RE.test(String(cell).trim());
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "£": "GBP",
  $: "USD",
  "€": "EUR",
  "¥": "JPY",
};

/**
 * Extracts the ISO 4217 currency code from a symbol- or code-prefixed cell.
 * TikTok exports the campaign currency on every monetary cell; we sample
 * the first non-null cell to capture it. Defaults to "GBP" — the only
 * currency Matas's clients have shipped to date — when no symbol or code
 * is present.
 */
export function parseCurrencyFromCell(cell: unknown): string {
  if (cell == null) return "GBP";
  const raw = String(cell).trim();
  if (raw === "") return "GBP";

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(symbol)) return code;
  }

  // Three-letter code anywhere in the cell (e.g. "GBP 1,234.56").
  const match = raw.match(/\b([A-Z]{3})\b/);
  if (match) return match[1];

  return "GBP";
}

/**
 * Coerce a TikTok status / source cell:
 *   "--" → null
 *   ""   → null
 *   else → trimmed string (whitespace-collapsed)
 *
 * Used by the campaign and ad parsers for `primary_status`,
 * `secondary_status`, `secondary_source`, `primary_source`,
 * `attribution_source`.
 */
export function parseStatusCell(cell: unknown): string | null {
  if (cell == null) return null;
  const raw = String(cell).trim();
  if (raw === "") return null;
  if (NULL_TOKENS.has(raw.toLowerCase())) return null;
  return raw.replace(/\s+/g, " ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Header → column index map
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a normalised lookup from header string → column index. Used by
 * the per-shape parsers to grab cells by their canonical header without
 * caring about column order, missing optional columns, or alias drift.
 */
export function buildHeaderIndex(
  headerRow: readonly unknown[],
): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < headerRow.length; i += 1) {
    const key = normaliseHeader(headerRow[i]);
    if (key && !(key in map)) map[key] = i;
  }
  return map;
}

/**
 * Resolve a column index for a header (and its aliases). Returns -1 when
 * the header is missing — parsers default the corresponding metric to null.
 */
export function findColumnIndex(
  headerIndex: Record<string, number>,
  spec: MetricColumnSpec,
): number {
  const candidates = [spec.header, ...(spec.aliases ?? [])];
  for (const name of candidates) {
    const norm = normaliseHeader(name);
    if (norm in headerIndex) return headerIndex[norm];
  }
  return -1;
}

/**
 * Materialise a `TikTokMetricBlock` from a row plus the header index map.
 * Missing columns coerce to `null`. The "<5" mask on the impressions cell
 * is preserved verbatim in `impressions_raw`; every other masked cell
 * just becomes `null` (TikTok only masks impressions on the breakdown
 * exports we've seen).
 */
export function parseMetricBlock(
  row: readonly unknown[],
  headerIndex: Record<string, number>,
): TikTokMetricBlock {
  const cellAt = (field: TikTokMetricField): unknown => {
    const spec = TIKTOK_METRIC_COLUMNS.find((c) => c.field === field);
    if (!spec) return null;
    const idx = findColumnIndex(headerIndex, spec);
    return idx >= 0 ? row[idx] : null;
  };

  const impressionsRaw = cellAt("impressions");

  return {
    cost: parseNumberCell(cellAt("cost")),
    impressions: parseNumberCell(impressionsRaw),
    impressions_raw: isMaskedCell(impressionsRaw)
      ? String(impressionsRaw).trim()
      : null,
    cpm: parseNumberCell(cellAt("cpm")),
    clicks_destination: parseNumberCell(cellAt("clicks_destination")),
    cpc_destination: parseNumberCell(cellAt("cpc_destination")),
    ctr_destination: parseNumberCell(cellAt("ctr_destination")),
    video_views_2s: parseNumberCell(cellAt("video_views_2s")),
    video_views_6s: parseNumberCell(cellAt("video_views_6s")),
    video_views_p25: parseNumberCell(cellAt("video_views_p25")),
    video_views_p50: parseNumberCell(cellAt("video_views_p50")),
    video_views_p75: parseNumberCell(cellAt("video_views_p75")),
    video_views_p100: parseNumberCell(cellAt("video_views_p100")),
    avg_play_time_per_user: parseNumberCell(cellAt("avg_play_time_per_user")),
    avg_play_time_per_video_view: parseNumberCell(
      cellAt("avg_play_time_per_video_view"),
    ),
    interactive_addon_impressions: parseNumberCell(
      cellAt("interactive_addon_impressions"),
    ),
    interactive_addon_destination_clicks: parseNumberCell(
      cellAt("interactive_addon_destination_clicks"),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filename → date range
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TikTok export filenames embed the report date range as
 * `_YYYYMMDD_YYYYMMDD_` (e.g. `Campaign_20260101_20260131_GMT+0.xlsx`).
 *
 * Returns `{ start, end }` as ISO date strings (`YYYY-MM-DD`) or null
 * when no range is found. The import route uses this as a fallback —
 * the user always also supplies the range explicitly via the form, so a
 * miss here is non-fatal.
 */
export function extractDateRangeFromFilename(
  filename: string,
): { start: string; end: string } | null {
  const match = filename.match(/(\d{8})[_-](\d{8})/);
  if (!match) return null;
  const start = formatYmd(match[1]);
  const end = formatYmd(match[2]);
  if (!start || !end) return null;
  return { start, end };
}

function formatYmd(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  const monthN = Number(m);
  const dayN = Number(d);
  if (monthN < 1 || monthN > 12) return null;
  if (dayN < 1 || dayN > 31) return null;
  return `${y}-${m}-${d}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Row filters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Skip totals / "X of Y results" rows and blank lines that TikTok appends
 * to most exports. Pass the leftmost cell value of each row.
 */
const SKIP_ROW_PATTERNS: readonly RegExp[] = [
  /^total$/i,
  /^total of \d+ results?$/i,
  /^summary$/i,
  /^grand total$/i,
];

export function isSkippableRow(firstCell: unknown): boolean {
  if (firstCell == null) return true;
  const value = String(firstCell).trim();
  if (value === "") return true;
  return SKIP_ROW_PATTERNS.some((re) => re.test(value));
}
