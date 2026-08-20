export interface TikTokGenrePreset {
  id: string;
  label: string;
  seeds: string[];
}

export const TIKTOK_GENRE_PRESETS: TikTokGenrePreset[] = [
  {
    id: "electronic-music",
    label: "Electronic music",
    seeds: [
      "Electronic music",
      "tech house",
      "house music",
      "techno music",
      "disco music",
    ],
  },
];

export interface TikTokPresetKeywordRow {
  id: string;
  name: string;
  audienceSize: number | null;
  seeds: string[];
}

export async function expandTikTokPresetKeywords(
  seeds: string[],
  fetchSeed: (seed: string) => Promise<
    Array<{ id: string; name: string; audienceSize?: number | null }>
  >,
): Promise<{
  rows: TikTokPresetKeywordRow[];
  failedSeeds: string[];
  requested: number;
}> {
  const trimmed = [...new Set(seeds.map((seed) => seed.trim()).filter(Boolean))];
  const settled = await Promise.allSettled(
    trimmed.map((seed) => fetchSeed(seed)),
  );
  const byId = new Map<string, TikTokPresetKeywordRow>();
  const failedSeeds: string[] = [];
  settled.forEach((result, index) => {
    const seed = trimmed[index];
    if (result.status === "rejected") {
      failedSeeds.push(seed);
      return;
    }
    for (const item of result.value) {
      const existing = byId.get(item.id);
      if (existing) {
        if (!existing.seeds.includes(seed)) existing.seeds.push(seed);
        continue;
      }
      byId.set(item.id, {
        id: item.id,
        name: item.name,
        audienceSize: item.audienceSize ?? null,
        seeds: [seed],
      });
    }
  });
  return {
    rows: [...byId.values()],
    failedSeeds,
    requested: trimmed.length,
  };
}

export function tikTokHashtagPresetQuery(seeds: string[]): {
  keywords: string[];
  operator: "OR";
} {
  return {
    keywords: seeds.map((seed) => seed.trim()).filter(Boolean).slice(0, 10),
    operator: "OR",
  };
}
