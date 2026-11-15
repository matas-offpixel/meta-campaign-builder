/**
 * Channel limits for MML copy. A line over its limit is cut at the last
 * word that fits. A first word that is already over the limit is dropped.
 * Nothing longer than the limit is returned.
 */

export const COPY_LIMITS = {
  metaHeadline: 40,
  metaDescription: 30,
  metaPrimaryMax: 5,
  tiktokMin: 1,
  tiktokMax: 100,
  googleHeadline: 30,
  googleHeadlineMax: 15,
  googleDescription: 90,
  googleDescriptionMax: 4,
} as const;

export function fitLimit(text: string, max: number): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const space = slice.lastIndexOf(" ");
  if (space <= 0) return null;
  const cut = slice.slice(0, space).trim();
  return cut.length > 0 && cut.length <= max ? cut : null;
}

export function fitTikTok(text: string): string | null {
  const fitted = fitLimit(text, COPY_LIMITS.tiktokMax);
  if (!fitted || fitted.length < COPY_LIMITS.tiktokMin) return null;
  return fitted;
}
