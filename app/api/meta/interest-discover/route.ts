/**
 * POST /api/meta/interest-discover
 *
 * Cluster-specific interest discovery that uses selected page audiences as the
 * primary fan signal.  Unlike the old approach of generating generic terms and
 * then re-clustering results, each output cluster has its OWN search terms
 * tailored to that category domain — so the same page context will produce
 * genuinely different suggestions in "Music & Nightlife" vs "Fashion & Streetwear".
 *
 * Pipeline per cluster:
 *   1. generateTerms(pages, campaignName)  →  4-7 cluster-specific search queries
 *   2. Search Meta /search?type=adinterest for each query (parallel)
 *   3. Deduplicate globally (first cluster wins for a given interest ID)
 *   4. Return clusters ordered by relevance, up to 5 interests each
 *
 * Dev logging: console.info prints the per-cluster seed payload so you can
 * inspect why clusters differ or not.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

const KNOWN_CITIES = [
  "London", "Berlin", "Amsterdam", "Manchester", "Glasgow", "Edinburgh",
  "Bristol", "Leeds", "Liverpool", "Ibiza", "Lisbon", "Barcelona", "Paris",
  "Budapest", "Prague", "Vienna", "Brussels", "Dublin", "Copenhagen",
  "New York", "Chicago", "Los Angeles", "Miami", "Detroit", "Toronto",
  "Melbourne", "Sydney",
];

const STOPWORDS = new Set([
  "the", "and", "for", "a", "an", "of", "in", "at", "to", "with",
  "2024", "2025", "2026", "vol", "issue", "part", "ep", "ft", "feat",
]);

const MUSIC_CATEGORIES = new Set([
  "Musician/Band", "DJ", "Club", "Festival", "Concert Tour",
  "Record Label", "Music Production Studio", "Performance & Event Venue",
  "Radio Station",
]);

function findCity(name: string): string | null {
  for (const city of KNOWN_CITIES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(name)) return city;
  }
  return null;
}

function campaignKeywords(campaignName?: string): string[] {
  if (!campaignName) return [];
  return campaignName
    .split(/[\s\-_]+/)
    .map((w) => w.replace(/[^a-z0-9]/gi, ""))
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 3);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageContextItem {
  name: string;
  category?: string;
  instagramUsername?: string;
}

interface RawInterest {
  id: string;
  name: string;
  audience_size?: number;
  path?: string[];
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
  /** Short description of what types of interests this cluster surfaces */
  description: string;
  interests: ClusteredInterest[];
}

export interface DiscoverResponse {
  clusters: DiscoverCluster[];
  /** Per-cluster seed payloads — useful for debugging why clusters differ */
  clusterSeeds: Record<string, string[]>;
  /** Flat list of all search terms used (across all clusters), deduplicated */
  searchTermsUsed: string[];
  totalFound: number;
}

// ── Cluster definitions ───────────────────────────────────────────────────────

interface ClusterDef {
  label: string;
  description: string;
  /**
   * Generates search terms SPECIFIC to this cluster from the page context.
   * Different clusters receive different terms from the same pages, ensuring
   * genuinely varied suggestions.
   */
  generateTerms: (pages: PageContextItem[], campaignName?: string) => string[];
}

const CLUSTER_DEFS: ClusterDef[] = [
  // ── A. Music & Nightlife ───────────────────────────────────────────────────
  // "Fans of [pages] are likely into these music scenes, artists, venues, clubs,
  //  and nightlife brands"
  {
    label: "Music & Nightlife",
    description: "artists, DJs, clubs, festivals, venues, music communities",
    generateTerms: (pages, campaignName) => {
      const t = new Set<string>();

      for (const p of pages) {
        // Short page names → artist / venue / brand search terms
        const words = p.name.trim().split(/\s+/);
        if (words.length <= 2 && p.name.length >= 3) t.add(p.name.trim());

        // Category → genre / scene terms (avoid overlapping with other clusters)
        switch (p.category) {
          case "Club":
          case "DJ":
            t.add("Techno"); t.add("Electronic dance music");
            t.add("Underground music"); t.add("Clubbing");
            break;
          case "Musician/Band":
            t.add("Electronic music"); t.add("Live music"); t.add("Music concerts");
            break;
          case "Festival":
            t.add("Music festivals"); t.add("Outdoor festivals");
            break;
          case "Record Label":
            t.add("Record labels"); t.add("Music industry");
            break;
          case "Performance & Event Venue":
            t.add("Music venues"); t.add("Live entertainment");
            break;
        }

        // City → city music scene
        const city = findCity(p.name);
        if (city) {
          t.add(`${city} nightclub`);
          t.add(`${city} music`);
        }

        // IG handle as a search signal
        if (p.instagramUsername) {
          const cleaned = p.instagramUsername.replace(/[_.-]+/g, " ").trim();
          if (cleaned.length >= 4 && cleaned.toLowerCase() !== p.name.toLowerCase().trim()) {
            t.add(cleaned);
          }
        }
      }

      for (const kw of campaignKeywords(campaignName)) t.add(kw);

      t.add("Electronic music"); t.add("Music festivals"); t.add("Nightclub");
      return [...t].slice(0, 8);
    },
  },

  // ── B. Fashion & Streetwear ────────────────────────────────────────────────
  // "Fans of [pages] are likely into these fashion and streetwear interests"
  {
    label: "Fashion & Streetwear",
    description: "fashion labels, streetwear brands, style communities, youth culture aesthetics",
    generateTerms: (pages) => {
      const t = new Set<string>();

      const hasClubMusic = pages.some((p) =>
        ["Club", "DJ", "Musician/Band", "Festival"].includes(p.category ?? ""),
      );
      const cities = pages.map((p) => findCity(p.name)).filter(Boolean) as string[];

      // Music/club pages → rave + club culture aesthetics
      if (hasClubMusic) {
        t.add("Club culture fashion"); t.add("Rave fashion"); t.add("Festival fashion");
      }

      // City fashion scenes
      for (const city of cities.slice(0, 2)) {
        t.add(`${city} fashion`); t.add(`${city} streetwear`);
      }

      t.add("Streetwear"); t.add("Urban fashion"); t.add("Sneakers");
      t.add("Street style"); t.add("Youth fashion");
      return [...t].slice(0, 8);
    },
  },

  // ── C. Lifestyle & Nightlife ───────────────────────────────────────────────
  // "Fans of [pages] are likely into these nightlife and lifestyle interests"
  {
    label: "Lifestyle & Nightlife",
    description: "nightlife behaviour, premium lifestyle, bars, city social culture, luxury signals",
    generateTerms: (pages) => {
      const t = new Set<string>();

      const cities = pages.map((p) => findCity(p.name)).filter(Boolean) as string[];
      for (const city of cities.slice(0, 2)) {
        t.add(`${city} nightlife`); t.add(`${city} bars`); t.add(`${city} restaurants`);
      }

      t.add("Nightlife"); t.add("Bar culture"); t.add("Premium lifestyle");
      t.add("Social nightlife"); t.add("Luxury lifestyle"); t.add("Going out");
      return [...t].slice(0, 8);
    },
  },

  // ── D. Activities & Culture ────────────────────────────────────────────────
  // "Fans of [pages] are likely into these activities and cultural interests"
  {
    label: "Activities & Culture",
    description: "arts, design, creative culture, exhibitions, experiences, city activities",
    generateTerms: (pages) => {
      const t = new Set<string>();

      const cities = pages.map((p) => findCity(p.name)).filter(Boolean) as string[];
      for (const city of cities.slice(0, 1)) {
        t.add(`${city} arts`); t.add(`${city} culture`); t.add(`${city} events`);
      }

      t.add("Contemporary art"); t.add("Arts and culture"); t.add("Creative arts");
      t.add("Street art"); t.add("Cultural events"); t.add("Urban experiences");
      return [...t].slice(0, 8);
    },
  },

  // ── E. Media & Entertainment ───────────────────────────────────────────────
  // "Fans of [pages] are likely into these media and entertainment interests"
  {
    label: "Media & Entertainment",
    description: "magazines, media brands, creators, publishers, streaming behaviour",
    generateTerms: (pages, campaignName) => {
      const t = new Set<string>();

      // Well-known music/culture media brands — strong fan signals
      t.add("Resident Advisor"); t.add("Mixmag"); t.add("Boiler Room");
      t.add("Music media"); t.add("Entertainment news"); t.add("Music streaming");

      // IG-connected pages → social media signal
      const hasIg = pages.some((p) => p.instagramUsername);
      if (hasIg) t.add("Social media influencer");

      // Music category pages → music press
      const hasMusicPage = pages.some((p) => MUSIC_CATEGORIES.has(p.category ?? ""));
      if (hasMusicPage) t.add("Music journalism");

      for (const kw of campaignKeywords(campaignName)) t.add(kw);

      return [...t].slice(0, 8);
    },
  },
];

// ── Meta interest search ──────────────────────────────────────────────────────

async function searchMeta(token: string, query: string): Promise<RawInterest[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adinterest");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");

  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as { data?: RawInterest[]; error?: unknown };
    if (!res.ok || json.error) return [];
    return json.data ?? [];
  } catch {
    return [];
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

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
    return NextResponse.json(
      { error: "Provide at least one page or a campaign name" },
      { status: 400 },
    );
  }

  // ── Per-cluster seed generation ───────────────────────────────────────────
  const clusterSeeds: Record<string, string[]> = {};
  for (const def of CLUSTER_DEFS) {
    clusterSeeds[def.label] = def.generateTerms(pages, campaignName);
  }

  // Dev log — inspect per-cluster seeds
  console.info(
    `[interest-discover] ${pages.length} pages, campaign="${campaignName ?? ""}":`,
    Object.entries(clusterSeeds)
      .map(([label, terms]) => `\n  ${label}: [${terms.join(", ")}]`)
      .join(""),
  );

  // ── Search Meta for each cluster's terms (parallel batches) ───────────────
  // Global deduplicate: first cluster to claim an interest ID wins.
  const globalSeen = new Set<string>();
  const clusterResults = new Map<string, ClusteredInterest[]>();

  for (const def of CLUSTER_DEFS) {
    const terms = clusterSeeds[def.label];
    const allResults: ClusteredInterest[] = [];

    // Search 4 terms at a time
    const BATCH = 4;
    for (let i = 0; i < terms.length; i += BATCH) {
      const batch = terms.slice(i, i + BATCH);
      const batchResults = await Promise.all(batch.map((t) => searchMeta(token, t)));

      for (let j = 0; j < batch.length; j++) {
        for (const item of batchResults[j]) {
          if (!globalSeen.has(item.id)) {
            globalSeen.add(item.id);
            allResults.push({
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

    clusterResults.set(def.label, allResults);
  }

  // ── Build response clusters ───────────────────────────────────────────────
  const clusters: DiscoverCluster[] = CLUSTER_DEFS
    .map((def) => ({
      label: def.label,
      description: def.description,
      interests: (clusterResults.get(def.label) ?? [])
        .sort((a, b) => (b.audienceSize ?? 0) - (a.audienceSize ?? 0))
        .slice(0, 5),
    }))
    .filter((c) => c.interests.length > 0);

  console.info(
    `[interest-discover] done — ${globalSeen.size} unique interests across ${clusters.length} clusters`,
    clusters.map((c) => `${c.label}:${c.interests.length}`).join(", "),
  );

  const searchTermsUsed = [...new Set(Object.values(clusterSeeds).flat())];

  return NextResponse.json({
    clusters,
    clusterSeeds,
    searchTermsUsed,
    totalFound: globalSeen.size,
  } satisfies DiscoverResponse);
}
