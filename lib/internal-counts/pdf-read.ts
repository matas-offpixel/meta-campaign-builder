/**
 * lib/internal-counts/pdf-read.ts
 *
 * M1b of docs/design-record/2026-11-13-internal-counts-matching.html: an
 * email from the domain is a count when one of its PDFs reads as the counts
 * sheet. Each PDF is read on its own and gets one verdict:
 *
 *   sheet       blocks headed "SINCE LAST COUNT" with a "TIER TOTALS" row,
 *               and every block parses
 *   unreadable  either heading is there, but the sheet won't parse
 *               ("Couldn't read the {date} sheet")
 *   other       neither heading: not a counts sheet
 */

import { createHash } from "node:crypto";

import { extractPdfTextItems, type PdfTextItem } from "./pdf-text.ts";
import { parseInternalCountsItems, parseSheetDate, type ParsedSheet } from "./parse.ts";

export type PdfVerdict = "sheet" | "unreadable" | "other";

export interface ReadPdf {
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  verdict: PdfVerdict;
  sheet: ParsedSheet | null;
  /** The sheet's count date (the date most blocks carry), or the first dd/mm/yy in the PDF; null when there's none. */
  pdfDate: string | null;
}

export function pdfSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mostCommon(values: Array<string | null>): string | null {
  const tally = new Map<string, number>();
  for (const v of values) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** The verdict from the PDF's words and its parse. Pure, for tests. */
export function verdictFor(items: PdfTextItem[], sheet: ParsedSheet): { verdict: PdfVerdict; pdfDate: string | null } {
  const text = items.map((i) => i.str).join(" ");
  const since = /SINCE\s+LAST\s+COUNT/i.test(text);
  const tierTotals = /TIER\s+TOTALS/i.test(text);
  const parsed =
    sheet.blocks.length > 0 &&
    sheet.problems.length === 0 &&
    sheet.blocks.every((b) => b.problems.length === 0 && b.countDate !== null);
  const pdfDate =
    mostCommon(sheet.blocks.map((b) => b.countDate)) ??
    items.map((i) => parseSheetDate(i.str.trim())).find((d): d is string => d !== null) ??
    null;
  if (since && tierTotals && parsed) return { verdict: "sheet", pdfDate };
  if (since || tierTotals) return { verdict: "unreadable", pdfDate };
  return { verdict: "other", pdfDate: null };
}

export async function readPdf(filename: string, bytes: Uint8Array): Promise<ReadPdf> {
  const sha256 = pdfSha256(bytes);
  let items: PdfTextItem[];
  try {
    items = await extractPdfTextItems(bytes);
  } catch {
    return { filename, bytes, sha256, verdict: "other", sheet: null, pdfDate: null };
  }
  const sheet = parseInternalCountsItems(items);
  const { verdict, pdfDate } = verdictFor(items, sheet);
  return { filename, bytes, sha256, verdict, sheet: verdict === "other" ? null : sheet, pdfDate };
}

/** The PDF an email is read by: the first that reads as the sheet, else the first unreadable sheet, else none. */
export function chooseSheet(pdfs: ReadPdf[]): ReadPdf | null {
  return pdfs.find((p) => p.verdict === "sheet") ?? pdfs.find((p) => p.verdict === "unreadable") ?? null;
}
