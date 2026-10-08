/**
 * lib/google-search/workbook.ts
 *
 * Shared xlsx helpers for Google build sheets, and which kind of build
 * sheet a workbook is. The Search importer (`xlsx-import.ts`) and the
 * video importer read tabs and headers through these, so a header or tab
 * name normalises the same way in both.
 *
 * Kind, by tab name:
 *   - search: a keywords tab (`4 Keywords`), not counting a negatives tab.
 *   - video:  a placements tab (`4 Placements`) and no keywords tab.
 *   - unknown: neither. The Search importer still runs and reports what
 *     it found, as before.
 */

import * as XLSX from "xlsx";

export type GoogleWorkbookKind = "search" | "video" | "unknown";

export interface GoogleWorkbookDetection {
  kind: GoogleWorkbookKind;
  /** Sheet names in workbook order, for messages. */
  tabs: string[];
}

/** Lowercase, alphanumerics only: `Max CPC cap (£)` → `maxcpccap`. */
export function headerKey(raw: unknown): string {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Whole lowercase tokens of a tab name: `5 Ad Copy & Creative` → [5, ad, copy, creative]. */
export function sheetTokens(name: string): string[] {
  return String(name)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
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

export function detectWorkbookKind(workbook: XLSX.WorkBook): GoogleWorkbookDetection {
  const tabs = [...workbook.SheetNames];
  if (tabs.some(isKeywordsTab)) return { kind: "search", tabs };
  if (tabs.some(isPlacementsTab)) return { kind: "video", tabs };
  return { kind: "unknown", tabs };
}

export function videoWorkbookMessage(tabs: string[]): string {
  return (
    `This is a YouTube video build sheet (tabs: ${tabs.join(", ")}). ` +
    "The Search importer reads keyword sheets only, so nothing was imported. Video plans are not supported yet."
  );
}

export function readWorkbook(buffer: Uint8Array | ArrayBuffer): XLSX.WorkBook {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return XLSX.read(view, { type: "array" });
}

export function detectWorkbookKindFromBuffer(buffer: Uint8Array | ArrayBuffer): GoogleWorkbookDetection {
  return detectWorkbookKind(readWorkbook(buffer));
}
