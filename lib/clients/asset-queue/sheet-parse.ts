/**
 * sheet-parse.ts
 *
 * Parses raw Google Sheets row arrays into typed AssetSheetRow objects and
 * produces a SHA-256 row hash for deduplication across scrapes.
 *
 * Joe's 4theFans sheet layout (columns A–G):
 *   A: Nation      (England / Scotland / All)
 *   B: Location    (venue name or "All")
 *   C: Funnel      (TOFU / MOFU / BOFU)
 *   D: Media type  (Graphic / Video)  ← asset TYPE, not the name
 *   E: Asset       (descriptive name, e.g. "Brighton UGC FPV Videos")
 *   F: Link        (Dropbox share URL)
 *   G: Notes
 *
 * Empty header rows and rows with no asset name are skipped silently.
 */

import { createHash } from "crypto";

export interface AssetSheetRow {
  nation: string;
  location: string;
  funnel: string;
  /** "Graphic" | "Video" or whatever Joe writes in column D */
  mediaType: string;
  /** Descriptive asset name from column E (e.g. "Brighton UGC FPV Videos") */
  assetName: string;
  dropboxUrl: string;
  notes: string;
  /** sha256 used for upsert deduplication */
  rowHash: string;
}

const HEADER_KEYWORDS = new Set(["nation", "location", "funnel", "asset"]);

function normalise(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().replace(/\s+/g, " ");
}

function isHeaderRow(cells: string[]): boolean {
  const first = cells[0]?.toLowerCase() ?? "";
  return HEADER_KEYWORDS.has(first);
}

/** Deterministic SHA-256 over the meaningful columns of a row. */
function hashRow(
  clientId: string,
  nation: string,
  location: string,
  funnel: string,
  assetName: string,
  dropboxUrl: string,
): string {
  const payload = JSON.stringify({ clientId, nation, location, funnel, assetName, dropboxUrl });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Parses a 2-D array of cell values into typed rows.
 *
 * @param clientId  Used in hash so the same sheet shared across clients produces distinct hashes.
 * @param rawRows   Array of row arrays (from Sheets API or papaparse CSV).
 */
export function parseSheetRows(clientId: string, rawRows: unknown[][]): AssetSheetRow[] {
  const results: AssetSheetRow[] = [];

  for (const raw of rawRows) {
    const cells = (raw as unknown[]).map(normalise);

    if (cells.every((c) => c === "")) continue;
    if (isHeaderRow(cells)) continue;

    const nation     = normalise(cells[0]);
    const location   = normalise(cells[1]);
    const funnel     = normalise(cells[2]);
    const mediaType  = normalise(cells[3]); // column D: "Graphic" | "Video"
    const assetName  = normalise(cells[4]); // column E: descriptive name
    const dropboxUrl = normalise(cells[5]); // column F: Dropbox link
    const notes      = normalise(cells[6]); // column G: notes

    // Rows without a real asset name or Dropbox link are meaningless
    if (!assetName && !dropboxUrl) continue;

    const rowHash = hashRow(clientId, nation, location, funnel, assetName, dropboxUrl);

    results.push({ nation, location, funnel, mediaType, assetName, dropboxUrl, notes, rowHash });
  }

  return results;
}

/**
 * Given a set of already-known hashes (from DB), returns only the rows that
 * are genuinely new.
 */
export function filterNewRows(rows: AssetSheetRow[], knownHashes: Set<string>): AssetSheetRow[] {
  return rows.filter((r) => !knownHashes.has(r.rowHash));
}
