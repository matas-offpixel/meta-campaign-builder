/**
 * lib/google-search/workbook.ts
 *
 * Shared xlsx helpers for Google build sheets, and which kind of build
 * sheet a workbook is. The Search importer (`xlsx-import.ts`) and the
 * video importer (`lib/google-video/xlsx-import.ts`) read tabs, headers
 * and cells through these, so both normalise the same way.
 *
 * Kind:
 *   - search: a keywords tab (`4 Keywords`, not a negatives tab) with at
 *     least one keyword row.
 *   - video:  a placements tab (`4 Placements`), or a campaign settings
 *     tab whose rows mention Video / YouTube / CPV / in-stream. Checked
 *     after search, so a Keywords tab with rows wins.
 *   - search, again: an empty keywords tab and no video signal. The
 *     Search importer reports "Parsed 0 campaigns" with the tabs read.
 *   - unknown: none of the above. The route refuses it with the tabs
 *     found and the tabs each kind needs.
 */

import * as XLSX from "xlsx";

import { headerKey, sheetTokens } from "./header-key.ts";

export { headerKey, sheetTokens };

export type GoogleWorkbookKind = "search" | "video" | "unknown";

export interface GoogleWorkbookDetection {
  kind: GoogleWorkbookKind;
  /** Sheet names in workbook order, for messages. */
  tabs: string[];
  /** The tab the Search importer reads as Keywords, if any. */
  keywordsTab: string | null;
  /** Rows on that tab with a keyword in the Keyword column. */
  keywordRows: number;
}

export function cell(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function numericOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function rawRows(sheet: XLSX.WorkSheet | null | undefined): unknown[][] {
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
}

/**
 * Rows below the first row holding every required header, keyed by
 * `headerKey`. Blank rows are skipped. No header row → [].
 */
export function recordsFromRawRowsWithHeaderScan(
  raw: unknown[][],
  requiredHeaders: string[],
): Record<string, unknown>[] {
  if (raw.length === 0) return [];
  let headerIdx = -1;
  for (let i = 0; i < raw.length; i += 1) {
    const keys = (raw[i] ?? []).map((c) => headerKey(c));
    if (requiredHeaders.every((h) => keys.includes(headerKey(h)))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];
  const headerKeys = (raw[headerIdx] ?? []).map((c) => headerKey(c));
  const records: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < raw.length; i += 1) {
    const row = raw[i] ?? [];
    if (row.every((c) => c == null || c === "")) continue;
    const record: Record<string, unknown> = {};
    for (let j = 0; j < headerKeys.length; j += 1) {
      const key = headerKeys[j];
      if (key) record[key] = row[j];
    }
    records.push(record);
  }
  return records;
}

export function isNegativesTab(name: string): boolean {
  return headerKey(name).includes("negative");
}

export function isKeywordsTab(name: string): boolean {
  return !isNegativesTab(name) && headerKey(name).includes("keyword");
}

export function isPlacementsTab(name: string): boolean {
  const tokens = sheetTokens(name);
  return tokens.includes("placement") || tokens.includes("placements");
}

export function isCampaignSettingsTab(name: string): boolean {
  const tokens = sheetTokens(name);
  return (
    (tokens.includes("campaign") || tokens.includes("campaigns")) &&
    (tokens.includes("setting") || tokens.includes("settings"))
  );
}

const VIDEO_SETTING = /\b(video|youtube|cpv|in-?stream)\b/i;

function mentionsVideo(sheet: XLSX.WorkSheet | undefined): boolean {
  return rawRows(sheet).some((row) => row.some((c) => VIDEO_SETTING.test(cell(c))));
}

function countKeywordRows(sheet: XLSX.WorkSheet | undefined): number {
  return recordsFromRawRowsWithHeaderScan(rawRows(sheet), ["keyword"]).filter(
    (r) => cell(r.keyword) !== "",
  ).length;
}

export function detectWorkbookKind(workbook: XLSX.WorkBook): GoogleWorkbookDetection {
  const tabs = [...workbook.SheetNames];
  const keywordsTab = tabs.find(isKeywordsTab) ?? null;
  const keywordRows = keywordsTab ? countKeywordRows(workbook.Sheets[keywordsTab]) : 0;
  const base = { tabs, keywordsTab, keywordRows };
  if (keywordRows > 0) return { kind: "search", ...base };
  const video =
    tabs.some(isPlacementsTab) ||
    tabs.some((t) => isCampaignSettingsTab(t) && mentionsVideo(workbook.Sheets[t]));
  if (video) return { kind: "video", ...base };
  if (keywordsTab) return { kind: "search", ...base };
  return { kind: "unknown", ...base };
}

export const SEARCH_TABS = {
  required: ["Keywords"],
  optional: ["Campaigns", "RSAs", "Negatives", "Budget & Phasing", "Assets & Extensions"],
} as const;

export const VIDEO_TABS = {
  required: ["Placements"],
  optional: ["Campaign Settings", "Targeting & Exclusions", "Ad Copy & Creative"],
} as const;

function tabList(tabs: string[]): string {
  return tabs.length > 0 ? tabs.join(", ") : "none";
}

export function unknownWorkbookMessage(tabs: string[]): string {
  return (
    `Not a Google Search or YouTube video build sheet. Tabs found: ${tabList(tabs)}. ` +
    `Search needs a ${SEARCH_TABS.required.join(", ")} tab (optional: ${SEARCH_TABS.optional.join(", ")}). ` +
    `Video needs a ${VIDEO_TABS.required.join(", ")} tab (optional: ${VIDEO_TABS.optional.join(", ")}).`
  );
}

/** Appended to the Search importer's "Parsed 0 campaigns" message. */
export function tabsReadSuffix(detection: Pick<GoogleWorkbookDetection, "tabs" | "keywordsTab">): string {
  const read = detection.keywordsTab
    ? `"${detection.keywordsTab}" was read as the Keywords tab.`
    : "No tab was read as the Keywords tab.";
  return `Tabs found: ${tabList(detection.tabs)}. ${read}`;
}

export function readWorkbook(buffer: Uint8Array | ArrayBuffer): XLSX.WorkBook {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return XLSX.read(view, { type: "array" });
}

export function detectWorkbookKindFromBuffer(buffer: Uint8Array | ArrayBuffer): GoogleWorkbookDetection {
  return detectWorkbookKind(readWorkbook(buffer));
}
