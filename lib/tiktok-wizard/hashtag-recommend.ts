export const TIKTOK_HASHTAG_UNAVAILABLE_NOTE =
  "TikTok returned no hashtag recommendations. Two common causes: hashtag targeting is not enabled on this ad account, or the seeds do not match TikTok's single-token hashtag index (multi-word terms such as “electronic music” are not looked up).";

export function isPlausibleTikTokRecommendSeed(seed: string): boolean {
  const trimmed = seed.trim();
  return trimmed.length >= 2 && !/\s/.test(trimmed);
}

export function tikTokHashtagUnavailableNote(input: {
  failed: boolean;
  rowCount: number;
  keywords: string[];
}): string | null {
  if (input.failed || input.rowCount > 0) return null;
  if (!input.keywords.some(isPlausibleTikTokRecommendSeed)) return null;
  return TIKTOK_HASHTAG_UNAVAILABLE_NOTE;
}
