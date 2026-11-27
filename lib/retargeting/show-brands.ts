/**
 * lib/retargeting/show-brands.ts — which of a client's Pages are the
 * promoter's brand Pages for one show (Matas, 27 Nov: "Match promoter Pages
 * by the show's venue/brand (Electric Bristol for EBR, NX for NX, Electric
 * Studios for ES), not every Page the client owns"). One client can run
 * several brands (Electric Brixton's business holds EBR, NX and ES shows),
 * so a show takes only its own brand's Pages, matched by name. A brand with
 * no matching Page reads "not matched"; there's never a fallback to every
 * Page the client owns. A show whose code prefix isn't in the map takes the
 * Pages named as its client is (Puzzle, Deep House Bible).
 *
 * Pure. Relative imports only (node:test).
 */

export type ShowBrand = { prefix: string; brand: string; matches: RegExp };

/** The one map: event-code prefix → the brand whose Pages are the show's promoter Pages. */
export const SHOW_BRANDS: readonly ShowBrand[] = [
  { prefix: "EBR", brand: "Electric Bristol", matches: /\belectric\s+bristol\b/i },
  { prefix: "ES", brand: "Electric Studios", matches: /\belectric\s+studios\b/i },
  { prefix: "NX", brand: "NX", matches: /^nx\b/i },
];

const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The show's brand from its code's letters ("EBR26-KREAM" → EBR); null when the prefix isn't in the map. */
export function showBrandOf(code: string | null | undefined): ShowBrand | null {
  const letters = /^[A-Za-z]+/.exec((code ?? "").trim())?.[0]?.toUpperCase() ?? "";
  return SHOW_BRANDS.find((row) => row.prefix === letters) ?? null;
}

/** Whether a Page (by its name) is one of the show's brand Pages. */
export function isShowBrandPage(code: string | null | undefined, clientName: string | null | undefined, pageName: string | null | undefined): boolean {
  if (!pageName) return false;
  const brand = showBrandOf(code);
  if (brand) return brand.matches.test(pageName.trim());
  return Boolean(norm(clientName)) && norm(pageName) === norm(clientName);
}
