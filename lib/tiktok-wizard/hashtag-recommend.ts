export const TIKTOK_HASHTAG_UNAVAILABLE_NOTE =
  "TikTok returned no hashtag recommendations for this advertiser — hashtag targeting may not be enabled on this ad account.";

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
