/**
 * POST /api/meta/interest-discover
 *
 * Smart interest discovery that infers fan behaviour from page context rather
 * than relying on literal keyword matching.
 *
 * Input: selected pages (name, category, instagramUsername) + optional campaign name.
 * Process:
 *   1. Generate rich search terms from page names, categories, IG handles.
 *   2. Search Meta's ad-interest database for each term (up to 15 unique terms).
 *   3. Cluster results by interest category / path into themed buckets.
 *   4. Return up to 5 results per bucket.
 *
 * This is separate from the manual /interest-search endpoint, which takes a
 * single user-typed query and returns raw results.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Category → inferred fan interest terms ───────────────────────────────────
// These are NOT exact Meta interest IDs — they are search queries that tend
// to return relevant targetable interests from Meta's database.
const CATEGORY_INTEREST_TERMS: Record<string, string[]> = {
  "Musician/Band":              ["Electronic music", "Music festival", "Live music", "Music fans", "Concerts"],
  "Club":                       ["Nightclub", "Electronic music", "Clubbing", "Underground music", "Rave"],
  "DJ":                         ["DJ", "Electronic dance music", "Techno", "House music", "Dance music"],
  "Bar":                        ["Nightlife", "Bar hopping", "Cocktails", "Going out"],
  "Restaurant/Cafe":            ["Dining out", "Food culture", "Brunch"],
  "Festival":                   ["Music festival", "Outdoor festivals", "Summer festival"],
  "Concert Tour":               ["Concerts", "Live music", "Music tours", "Music ticketing"],
  "Entertainment":              ["Nightlife", "Entertainment", "Events"],
  "Arts/Entertainment":         ["Arts and culture", "Creative arts", "Cultural events"],
  "Event Planner/Event Services":["Event planning", "Event tickets", "Concerts and events"],
  "Performance & Event Venue":  ["Music venues", "Live entertainment", "Concerts"],
  "Record Label":               ["Music", "Record labels", "Music industry"],
  "Music Production Studio":    ["Music production", "Electronic music", "Audio engineering"],
  "Radio Station":              ["Radio", "Music discovery", "Music streaming"],
  "Media/News Company":         ["Media", "Entertainment news", "Pop culture"],
  "Clothing":                   ["Fashion", "Streetwear", "Urban fashion"],
  "Fashion Designer":           ["Fashion", "Luxury fashion", "Designer clothing"],
  "Photographer":               ["Photography", "Visual arts", "Creative photography"],
  "Art":                        ["Art", "Contemporary art", "Street art"],
  "Gym/Physical Fitness":       ["Fitness", "Gym", "Health and wellness"],
  "Sports":                     ["Sports", "Athletic lifestyle"],
};

// Known UK/EU nightlife & music cities for location-aware term generation
const KNOWN_CITIES = [
  "London", "Berlin", "Amsterdam", "Manchester", "Glasgow", "Edinburgh",
  "Bristol", "Leeds", "Liverpool", "Ibiza", "Lisbon", "Barcelona", "Paris",
  "Budapest", "Prague", "Vienna", "Brussels", "Dublin", "Copenhagen",
  "New York", "Chicago", "Los Angeles", "Miami", "Detroit",
];

// ── Cluster assignment from Meta interest paths ───────────────────────────────
const CLUSTER_PATTERNS: Array<[RegExp, string]> = [
  [/music|concert|DJ|dance|electronic|hip.?hop|jazz|techno|house|drum.?bass|rave|nightclub|clubbing|festival|funk|soul|punk|rock|indie|pop/i, "Music & Nightlife"],
  [/venue|ticket|event|entertainment|performance|show|stage|tour/i, "Venues & Events"],
  [/fashion|streetwear|clothing|apparel|style|outfit|sneaker|designer|luxury|wear/i, "Fashion & Streetwear"],
  [/art|culture|creative|photography|film|cinema|gallery|museum|design/i, "Culture & Arts"],
  [/lifestyle|travel|food|drink|wellness|fitness|yoga|health|beauty|self.care/i, "Lifestyle & Wellbeing"],
  [/media|creator|YouTube|Instagram|influencer|social.?media|blog|podcast|brand/i, "Media & Creators"],
  [/tech|gaming|digital|app|startup|software|internet/i, "Tech & Digital"],
];

function assignCluster(interest: { name: string; path?: string[] }): string {
  const text = [interest.name, ...(interest.path ?? [])].join(" ");
  for (const [pattern, label] of CLUSTER_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return "General Interests";
}

// ── Search term generation from page context ──────────────────────────────────

export interface PageContextItem {
  name: string;
  category?: string;
  instagramUsername?: string;
}

function generateSearchTerms(pages: PageContextItem[], campaignName?: string): string[] {
  const terms = new Set<string>();

  for (const page of pages) {
    // 1. Category-based interest terms (inferred fan behaviour)
    if (page.category) {
      const catTerms = CATEGORY_INTEREST_TERMS[page.category] ?? [];
      for (const t of catTerms.slice(0, 3)) terms.add(t);
    }

    // 2. Page name — use as-is if it's a short well-known name (≤3 words)
    const nameWords = page.name.trim().split(/\s+/);
    if (nameWords.length <= 3 && page.name.length >= 3) {
      terms.add(page.name.trim());
    }

    // 3. Location extraction — infer city-specific nightlife terms
    const cityMatch = page.name.match(
      new RegExp(`\\b(${KNOWN_CITIES.join("|")})\\b`, "i"),
    );
    if (cityMatch) {
      terms.add(`${cityMatch[0]} nightlife`);
      terms.add(`${cityMatch[0]} music scene`);
    }

    // 4. Instagram username — strip underscores/dots for natural language
    if (page.instagramUsername) {
      const cleaned = page.instagramUsername
        .replace(/[_\-.]+/g, " ")
        .trim();
      if (cleaned.length >= 4 && cleaned !== page.name.trim()) {
        terms.add(cleaned);
      }
    }
  }

  // 5. Campaign name keyword extraction
  if (campaignName) {
    const stopWords = new Set([
      "the", "and", "for", "a", "an", "of", "in", "at", "to", "with",
      "2024", "2025", "2026", "vol", "issue", "part", "ep", "ft",
    ]);
    const campaignTerms = campaignName
      .split(/[\s\-_]+/)
      .map((w) => w.replace(/[^a-z0-9]/gi, ""))
      .filter((w) => w.length >= 4 && !stopWords.has(w.toLowerCase()));
    for (const t of campaignTerms.slice(0, 4)) terms.add(t);
  }

  // 6. Always include broad fallback terms for music/event campaigns
  terms.add("Music festivals");
  terms.add("Nightlife");
  terms.add("Electronic music");

  return Array.from(terms).slice(0, 18);
}

// ── Meta interest search ──────────────────────────────────────────────────────

interface RawInterest {
  id: string;
  name: string;
  audience_size?: number;
  path?: string[];
  topic?: string;
}

interface ClusteredInterest {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string[];
  searchTerm: string;
}

export interface DiscoverCluster {
  label: string;
  interests: ClusteredInterest[];
}

export interface DiscoverResponse {
  clusters: DiscoverCluster[];
  searchTermsUsed: string[];
  totalFound: number;
}

async function searchMeta(token: string, query: string): Promise<RawInterest[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adinterest");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "15");

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as { data?: RawInterest[]; error?: unknown };
    if (!res.ok || json.error) return [];
    return json.data ?? [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_ACCESS_TOKEN is not configured on the server" },
      { status: 500 },
    );
  }

  let body: { pageContext?: unknown; campaignName?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pages = (Array.isArray(body.pageContext) ? body.pageContext : []) as PageContextItem[];
  const campaignName = typeof body.campaignName === "string" ? body.campaignName : undefined;

  if (pages.length === 0 && !campaignName) {
    return NextResponse.json({ error: "Provide at least one page or a campaign name" }, { status: 400 });
  }

  const searchTerms = generateSearchTerms(pages, campaignName);
  console.info(
    `[interest-discover] ${pages.length} pages → ${searchTerms.length} search terms:`,
    searchTerms.join(", "),
  );

  // Search Meta for all terms in parallel (cap concurrent requests)
  const seen = new Map<string, ClusteredInterest>();
  const BATCH = 5;
  for (let i = 0; i < searchTerms.length; i += BATCH) {
    const batch = searchTerms.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((t) => searchMeta(token, t)));
    for (let j = 0; j < batch.length; j++) {
      for (const item of results[j]) {
        if (!seen.has(item.id)) {
          seen.set(item.id, {
            id: item.id,
            name: item.name,
            audienceSize: item.audience_size,
            path: item.path,
            searchTerm: batch[j],
          });
        }
      }
    }
  }

  // Cluster the results
  const clusterMap = new Map<string, ClusteredInterest[]>();
  for (const interest of seen.values()) {
    const label = assignCluster(interest);
    if (!clusterMap.has(label)) clusterMap.set(label, []);
    clusterMap.get(label)!.push(interest);
  }

  // Sort clusters by size, cap to 5 results each, order by audience size
  const CLUSTER_ORDER = [
    "Music & Nightlife",
    "Venues & Events",
    "Fashion & Streetwear",
    "Culture & Arts",
    "Lifestyle & Wellbeing",
    "Media & Creators",
    "Tech & Digital",
    "General Interests",
  ];

  const clusters: DiscoverCluster[] = [];
  for (const label of CLUSTER_ORDER) {
    const items = (clusterMap.get(label) ?? [])
      .sort((a, b) => (b.audienceSize ?? 0) - (a.audienceSize ?? 0))
      .slice(0, 5);
    if (items.length > 0) clusters.push({ label, interests: items });
    clusterMap.delete(label);
  }
  // Append any leftover clusters
  for (const [label, items] of clusterMap) {
    clusters.push({
      label,
      interests: items.sort((a, b) => (b.audienceSize ?? 0) - (a.audienceSize ?? 0)).slice(0, 5),
    });
  }

  console.info(
    `[interest-discover] ${seen.size} unique interests in ${clusters.length} clusters`,
  );

  return NextResponse.json({
    clusters,
    searchTermsUsed: searchTerms,
    totalFound: seen.size,
  } satisfies DiscoverResponse);
}
