import type { AudienceSettings, InterestGroup, InterestSuggestion } from "./types";
import { MOCK_PAGES } from "./mock-data";

// Realistic Meta interest-targetable entities grouped by theme.
// Each entry has a unique id, a name matching what you'd find in Meta Ads Manager,
// and a plausible audience size.

const INTEREST_POOL: Record<string, InterestSuggestion[]> = {
  "Music Adjacent": [
    { id: "sg_m1", name: "Resident Advisor", audienceSize: 1500000, path: ["Media", "Music Media"] },
    { id: "sg_m2", name: "Mixmag", audienceSize: 2800000, path: ["Media", "Music Media"] },
    { id: "sg_m3", name: "Boiler Room", audienceSize: 5200000, path: ["Media", "Music Media"] },
    { id: "sg_m4", name: "Beatport", audienceSize: 1100000, path: ["Media", "Music Platforms"] },
    { id: "sg_m5", name: "DJ Mag", audienceSize: 3200000, path: ["Media", "Music Media"] },
    { id: "sg_m6", name: "SoundCloud", audienceSize: 45000000, path: ["Media", "Music Platforms"] },
    { id: "sg_m7", name: "Bandcamp", audienceSize: 2100000, path: ["Media", "Music Platforms"] },
    { id: "sg_m8", name: "Ableton", audienceSize: 3800000, path: ["Technology", "Music Production"] },
    { id: "sg_m9", name: "Native Instruments", audienceSize: 1200000, path: ["Technology", "Music Production"] },
    { id: "sg_m10", name: "Awakenings Festival", audienceSize: 280000, path: ["Events", "Festivals"] },
    { id: "sg_m11", name: "Sonar Festival", audienceSize: 350000, path: ["Events", "Festivals"] },
    { id: "sg_m12", name: "Dekmantel", audienceSize: 150000, path: ["Events", "Festivals"] },
    { id: "sg_m13", name: "Warehouse Project", audienceSize: 220000, path: ["Events", "Club Events"] },
    { id: "sg_m14", name: "Berghain", audienceSize: 620000, path: ["Places", "Nightclubs"] },
    { id: "sg_m15", name: "Fabric (club)", audienceSize: 410000, path: ["Places", "Nightclubs"] },
  ],
  "Fashion & Streetwear": [
    { id: "sg_f1", name: "Carhartt WIP", audienceSize: 4200000, path: ["Shopping", "Clothing"] },
    { id: "sg_f2", name: "Stüssy", audienceSize: 5800000, path: ["Shopping", "Clothing"] },
    { id: "sg_f3", name: "Palace Skateboards", audienceSize: 1800000, path: ["Shopping", "Clothing"] },
    { id: "sg_f4", name: "Nike Sportswear", audienceSize: 180000000, path: ["Shopping", "Clothing"] },
    { id: "sg_f5", name: "Dr. Martens", audienceSize: 8500000, path: ["Shopping", "Footwear"] },
    { id: "sg_f6", name: "ASOS", audienceSize: 32000000, path: ["Shopping", "Fashion"] },
    { id: "sg_f7", name: "Depop", audienceSize: 6200000, path: ["Shopping", "Fashion"] },
    { id: "sg_f8", name: "Acne Studios", audienceSize: 1900000, path: ["Shopping", "Designer"] },
    { id: "sg_f9", name: "COS (fashion brand)", audienceSize: 2400000, path: ["Shopping", "Fashion"] },
    { id: "sg_f10", name: "Veja", audienceSize: 1600000, path: ["Shopping", "Footwear"] },
  ],
  "Lifestyle & Nightlife": [
    { id: "sg_l1", name: "Nightclub", audienceSize: 89000000, path: ["Activities", "Nightlife"] },
    { id: "sg_l2", name: "Music festival", audienceSize: 120000000, path: ["Activities", "Events"] },
    { id: "sg_l3", name: "Backpacking", audienceSize: 42000000, path: ["Travel", "Adventure"] },
    { id: "sg_l4", name: "Hostelworld", audienceSize: 3800000, path: ["Travel", "Accommodation"] },
    { id: "sg_l5", name: "Skyscanner", audienceSize: 18000000, path: ["Travel", "Flights"] },
    { id: "sg_l6", name: "Time Out", audienceSize: 7500000, path: ["Media", "Lifestyle"] },
    { id: "sg_l7", name: "Easyjet", audienceSize: 12000000, path: ["Travel", "Airlines"] },
    { id: "sg_l8", name: "Ryanair", audienceSize: 15000000, path: ["Travel", "Airlines"] },
    { id: "sg_l9", name: "Airbnb", audienceSize: 95000000, path: ["Travel", "Accommodation"] },
    { id: "sg_l10", name: "Designmynight", audienceSize: 850000, path: ["Activities", "Nightlife"] },
  ],
  "Activities & Culture": [
    { id: "sg_a1", name: "Yoga", audienceSize: 210000000, path: ["Fitness", "Yoga"] },
    { id: "sg_a2", name: "CrossFit", audienceSize: 28000000, path: ["Fitness", "Training"] },
    { id: "sg_a3", name: "Running", audienceSize: 185000000, path: ["Fitness", "Sports"] },
    { id: "sg_a4", name: "Contemporary art", audienceSize: 42000000, path: ["Culture", "Art"] },
    { id: "sg_a5", name: "Tate Modern", audienceSize: 2800000, path: ["Culture", "Museums"] },
    { id: "sg_a6", name: "Photography", audienceSize: 320000000, path: ["Hobbies", "Creative"] },
    { id: "sg_a7", name: "Cycling", audienceSize: 140000000, path: ["Fitness", "Sports"] },
    { id: "sg_a8", name: "Skateboarding", audienceSize: 48000000, path: ["Sports", "Action Sports"] },
    { id: "sg_a9", name: "Vinyl Records", audienceSize: 8200000, path: ["Hobbies", "Music"] },
    { id: "sg_a10", name: "Film photography", audienceSize: 5600000, path: ["Hobbies", "Creative"] },
  ],
  "Media & Entertainment": [
    { id: "sg_e1", name: "Vice (magazine)", audienceSize: 12000000, path: ["Media", "Publications"] },
    { id: "sg_e2", name: "Dazed", audienceSize: 2400000, path: ["Media", "Publications"] },
    { id: "sg_e3", name: "i-D (magazine)", audienceSize: 1800000, path: ["Media", "Publications"] },
    { id: "sg_e4", name: "The Face (magazine)", audienceSize: 650000, path: ["Media", "Publications"] },
    { id: "sg_e5", name: "Netflix", audienceSize: 420000000, path: ["Entertainment", "Streaming"] },
    { id: "sg_e6", name: "Spotify", audienceSize: 280000000, path: ["Entertainment", "Music"] },
    { id: "sg_e7", name: "YouTube Music", audienceSize: 120000000, path: ["Entertainment", "Music"] },
    { id: "sg_e8", name: "Podcast", audienceSize: 180000000, path: ["Entertainment", "Audio"] },
    { id: "sg_e9", name: "MUBI", audienceSize: 1200000, path: ["Entertainment", "Film"] },
    { id: "sg_e10", name: "Criterion Collection", audienceSize: 950000, path: ["Entertainment", "Film"] },
  ],
  "Behaviours & Tech": [
    { id: "sg_b1", name: "iPhone", audienceSize: 850000000, path: ["Technology", "Mobile"] },
    { id: "sg_b2", name: "Frequent travellers", audienceSize: 320000000, path: ["Behaviours", "Travel"] },
    { id: "sg_b3", name: "Online shopping", audienceSize: 650000000, path: ["Behaviours", "Shopping"] },
    { id: "sg_b4", name: "Apple Music", audienceSize: 85000000, path: ["Technology", "Apps"] },
    { id: "sg_b5", name: "Early technology adopters", audienceSize: 180000000, path: ["Behaviours", "Technology"] },
    { id: "sg_b6", name: "Engaged shoppers", audienceSize: 420000000, path: ["Behaviours", "Shopping"] },
    { id: "sg_b7", name: "Uber", audienceSize: 95000000, path: ["Technology", "Apps"] },
    { id: "sg_b8", name: "Revolut", audienceSize: 8500000, path: ["Finance", "Banking"] },
  ],
  "Beauty & Wellness": [
    { id: "sg_w1", name: "Glossier", audienceSize: 4800000, path: ["Shopping", "Beauty"] },
    { id: "sg_w2", name: "The Ordinary (skincare)", audienceSize: 6200000, path: ["Shopping", "Beauty"] },
    { id: "sg_w3", name: "Aesop (brand)", audienceSize: 2100000, path: ["Shopping", "Beauty"] },
    { id: "sg_w4", name: "Lush (company)", audienceSize: 8900000, path: ["Shopping", "Beauty"] },
    { id: "sg_w5", name: "Meditation", audienceSize: 180000000, path: ["Wellness", "Mindfulness"] },
    { id: "sg_w6", name: "Headspace", audienceSize: 12000000, path: ["Wellness", "Apps"] },
    { id: "sg_w7", name: "Gymshark", audienceSize: 15000000, path: ["Shopping", "Activewear"] },
  ],
};

// Genre to interest group affinity: which themed pools are most relevant per genre
const GENRE_AFFINITY: Record<string, string[]> = {
  "Techno":               ["Music Adjacent", "Fashion & Streetwear", "Lifestyle & Nightlife", "Behaviours & Tech"],
  "Hard Techno":          ["Music Adjacent", "Fashion & Streetwear", "Activities & Culture", "Behaviours & Tech"],
  "Melodic Techno":       ["Music Adjacent", "Lifestyle & Nightlife", "Beauty & Wellness", "Media & Entertainment"],
  "Tech House":           ["Music Adjacent", "Fashion & Streetwear", "Lifestyle & Nightlife", "Activities & Culture"],
  "Deep House":           ["Music Adjacent", "Lifestyle & Nightlife", "Beauty & Wellness", "Media & Entertainment"],
  "Minimal":              ["Music Adjacent", "Media & Entertainment", "Activities & Culture", "Fashion & Streetwear"],
  "Electronic":           ["Music Adjacent", "Media & Entertainment", "Activities & Culture", "Behaviours & Tech"],
  "Drum & Bass":          ["Music Adjacent", "Fashion & Streetwear", "Activities & Culture", "Behaviours & Tech"],
  "Trance":               ["Music Adjacent", "Lifestyle & Nightlife", "Behaviours & Tech", "Beauty & Wellness"],
  "Afro House":           ["Music Adjacent", "Lifestyle & Nightlife", "Fashion & Streetwear", "Beauty & Wellness"],
  "Disco / Funk":         ["Music Adjacent", "Lifestyle & Nightlife", "Fashion & Streetwear", "Media & Entertainment"],
  "Breakbeat":            ["Music Adjacent", "Fashion & Streetwear", "Activities & Culture", "Media & Entertainment"],
  "Lo-Fi House":          ["Music Adjacent", "Fashion & Streetwear", "Activities & Culture", "Beauty & Wellness"],
  "Progressive House":    ["Music Adjacent", "Lifestyle & Nightlife", "Media & Entertainment", "Behaviours & Tech"],
  "Organic House":        ["Music Adjacent", "Beauty & Wellness", "Lifestyle & Nightlife", "Activities & Culture"],
  "Electro":              ["Music Adjacent", "Fashion & Streetwear", "Activities & Culture", "Behaviours & Tech"],
  "Ambient / Downtempo":  ["Music Adjacent", "Beauty & Wellness", "Media & Entertainment", "Activities & Culture"],
  "Nu Disco / Indie Dance":["Music Adjacent","Fashion & Streetwear","Lifestyle & Nightlife","Media & Entertainment"],
  "Bass Music":           ["Music Adjacent", "Fashion & Streetwear", "Activities & Culture", "Behaviours & Tech"],
};

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/**
 * Generate themed interest groups based on the audiences the user has selected.
 * Prioritises the first page group (primary audience) for genre affinity mapping.
 */
export function generateInterestGroupsFromAudiences(
  audiences: AudienceSettings
): InterestGroup[] {
  // Determine dominant genres from page groups (prioritise first group)
  const genreCounts: Record<string, number> = {};
  audiences.pageGroups.forEach((group, groupIdx) => {
    const weight = groupIdx === 0 ? 3 : 1; // first group gets 3× weight
    group.pageIds.forEach((pid) => {
      const page = MOCK_PAGES.find((p) => p.id === pid);
      if (page?.genre) {
        genreCounts[page.genre] = (genreCounts[page.genre] || 0) + weight;
      }
      if (page?.subgenre) {
        genreCounts[page.subgenre] = (genreCounts[page.subgenre] || 0) + weight;
      }
    });
  });

  // Rank genres by weight
  const rankedGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([genre]) => genre);

  if (rankedGenres.length === 0) {
    // Fallback: return a generic set
    return Object.entries(INTEREST_POOL).slice(0, 4).map(([category, pool]) => ({
      id: crypto.randomUUID(),
      name: category,
      interests: pickRandom(pool, Math.min(pool.length, 4)),
    }));
  }

  // Determine which themed pools to use based on genre affinity
  const poolScores: Record<string, number> = {};
  rankedGenres.forEach((genre, i) => {
    const affinityPools = GENRE_AFFINITY[genre] || Object.keys(INTEREST_POOL).slice(0, 3);
    affinityPools.forEach((pool, j) => {
      const genreWeight = rankedGenres.length - i;
      const affinityWeight = affinityPools.length - j;
      poolScores[pool] = (poolScores[pool] || 0) + genreWeight * affinityWeight;
    });
  });

  const rankedPools = Object.entries(poolScores)
    .sort((a, b) => b[1] - a[1])
    .map(([pool]) => pool);

  // Build interest groups from top pools
  const groups: InterestGroup[] = [];
  const usedIds = new Set<string>();

  // Always include Music Adjacent first
  if (INTEREST_POOL["Music Adjacent"]) {
    const available = INTEREST_POOL["Music Adjacent"].filter((i) => !usedIds.has(i.id));
    const selected = pickRandom(available, Math.min(available.length, 5));
    selected.forEach((i) => usedIds.add(i.id));
    groups.push({
      id: crypto.randomUUID(),
      name: "Music & Venues",
      interests: selected,
    });
  }

  // Add top affinity pools
  const poolsToUse = rankedPools.filter((p) => p !== "Music Adjacent").slice(0, 4);
  poolsToUse.forEach((poolName) => {
    const pool = INTEREST_POOL[poolName];
    if (!pool) return;
    const available = pool.filter((i) => !usedIds.has(i.id));
    const count = Math.min(available.length, 3 + Math.floor(Math.random() * 2));
    const selected = pickRandom(available, count);
    selected.forEach((i) => usedIds.add(i.id));
    if (selected.length > 0) {
      groups.push({
        id: crypto.randomUUID(),
        name: poolName,
        interests: selected,
      });
    }
  });

  return groups;
}

/**
 * Suggest an age range based on selected page audiences.
 * Uses genre heuristics to estimate target demographic.
 */
export function suggestAgeRange(audiences: AudienceSettings): { min: number; max: number } {
  const genres: string[] = [];
  audiences.pageGroups.forEach((group) => {
    group.pageIds.forEach((pid) => {
      const page = MOCK_PAGES.find((p) => p.id === pid);
      if (page?.genre) genres.push(page.genre);
    });
  });

  if (genres.length === 0) return { min: 18, max: 45 };

  // Genre → typical age range (lower, upper)
  const genreAges: Record<string, [number, number]> = {
    "Hard Techno":    [20, 34],
    "Techno":         [22, 38],
    "Tech House":     [21, 35],
    "Melodic Techno": [24, 40],
    "Deep House":     [25, 42],
    "Minimal":        [24, 40],
    "Drum & Bass":    [18, 32],
    "Electronic":     [22, 38],
    "Trance":         [24, 42],
    "Afro House":     [25, 42],
    "Lo-Fi House":    [20, 34],
    "Disco / Funk":   [26, 45],
    "Breakbeat":      [22, 36],
    "Progressive House": [25, 42],
    "Organic House":  [26, 44],
    "Electro":        [22, 36],
    "Bass Music":     [18, 30],
    "Ambient / Downtempo": [26, 48],
  };

  let totalMin = 0, totalMax = 0, count = 0;
  genres.forEach((g) => {
    const range = genreAges[g];
    if (range) {
      totalMin += range[0];
      totalMax += range[1];
      count++;
    }
  });

  if (count === 0) return { min: 18, max: 45 };

  return {
    min: Math.round(totalMin / count),
    max: Math.round(totalMax / count),
  };
}
