/**
 * sheet-parse.ts
 *
 * Parses raw Google Sheets row arrays into typed AssetSheetRow objects and
 * produces a SHA-256 row hash for deduplication across scrapes.
 *
 * Joe's 4theFans sheet layout (columns A–G):
 *   A: Nation      (England / Scotland / All)
 *   B: Location    (venue name or "All")
 *   C: Funnel      (TOFU / MOFU / BOFU, optionally comma-separated)
 *   D: Media type  (Graphic / Video)  ← asset TYPE, not the name
 *   E: Asset       (descriptive name, e.g. "Brighton UGC FPV Videos")
 *   F: Link        (Dropbox share URL)
 *   G: Notes
 *
 * Column C may contain comma-separated funnels ("TOFU, MOFU, BOFU").
 * `funnel` (single) is set to the highest-intent value (BOFU > MOFU > TOFU).
 * `funnels` holds the full parsed array.
 *
 * Empty header rows and rows with no asset name are skipped silently.
 */

import { createHash } from "crypto";

export interface AssetSheetRow {
  nation: string;
  location: string;
  /** Highest-intent funnel (BOFU > MOFU > TOFU) for single Anthropic call */
  funnel: string;
  /** All funnel labels from the cell (may be more than one) */
  funnels: string[];
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

/** Priority for funnel selection — higher number = higher intent */
const FUNNEL_PRIORITY: Record<string, number> = { BOFU: 3, MOFU: 2, TOFU: 1 };

function normalise(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().replace(/\s+/g, " ");
}

function isHeaderRow(cells: string[]): boolean {
  const first = cells[0]?.toLowerCase() ?? "";
  return HEADER_KEYWORDS.has(first);
}

/**
 * Parses a funnel cell that may contain comma-separated values.
 *
 * Returns `funnel` (highest-intent known label) and `funnels` (all parsed labels).
 * Unknown/raw values are kept as-is in both fields.
 */
export function parseMultiFunnel(raw: string): { funnel: string; funnels: string[] } {
  const parts = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const known = parts.filter((p) => p === "TOFU" || p === "MOFU" || p === "BOFU");

  if (known.length === 0) {
    // Unknown label (or empty) — preserve raw value
    const single = raw.trim();
    return { funnel: single, funnels: single ? [single] : [] };
  }

  // Pick the highest-intent label
  const best = known.reduce<string>((a, b) =>
    (FUNNEL_PRIORITY[a] ?? 0) >= (FUNNEL_PRIORITY[b] ?? 0) ? a : b,
  known[0]);

  // Deduplicate while preserving order
  const funnels = [...new Set(known)];
  return { funnel: best, funnels };
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
    const funnelRaw  = normalise(cells[2]);
    const mediaType  = normalise(cells[3]); // column D: "Graphic" | "Video"
    const assetName  = normalise(cells[4]); // column E: descriptive name
    const dropboxUrl = normalise(cells[5]); // column F: Dropbox link
    const notes      = normalise(cells[6]); // column G: notes

    // Rows without a real asset name or Dropbox link are meaningless
    if (!assetName && !dropboxUrl) continue;

    const { funnel, funnels } = parseMultiFunnel(funnelRaw);

    // Hash uses the highest-intent funnel for stability across re-scrapes
    const rowHash = hashRow(clientId, nation, location, funnel, assetName, dropboxUrl);

    results.push({ nation, location, funnel, funnels, mediaType, assetName, dropboxUrl, notes, rowHash });
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
