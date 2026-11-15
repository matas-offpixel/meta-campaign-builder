/**
 * Header and tab-name normalisers shared by the Google build-sheet
 * importers. No xlsx import, so client code can use them too.
 */

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
