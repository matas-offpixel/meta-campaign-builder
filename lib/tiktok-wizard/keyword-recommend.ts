import type { TikTokInterestKeywordMode } from "../tiktok/audience.ts";

export const TIKTOK_SEMANTIC_FALLBACK_NOTE =
  "Semantic recommend returned nothing for this advertiser — showing fuzzy matches";

export async function recommendWithSemanticFallback<T>(input: {
  mode: TikTokInterestKeywordMode;
  fetch: (mode: TikTokInterestKeywordMode) => Promise<T[]>;
}): Promise<{
  keywords: T[];
  usedMode: TikTokInterestKeywordMode;
  semanticFallback: boolean;
}> {
  const first = await input.fetch(input.mode);
  if (input.mode !== "SEMANTIC_RECOMMEND" || first.length > 0) {
    return {
      keywords: first,
      usedMode: input.mode,
      semanticFallback: false,
    };
  }
  const second = await input.fetch("FUZZ_MATCH");
  return {
    keywords: second,
    usedMode: "FUZZ_MATCH",
    semanticFallback: true,
  };
}
