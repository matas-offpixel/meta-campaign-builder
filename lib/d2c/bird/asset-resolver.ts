/**
 * lib/d2c/bird/asset-resolver.ts
 *
 * Looks up an existing poster/artwork in the Bird Media Library for a given
 * asset hint (brand name, event code). Used both for template approval (a
 * sample image) and at runtime (per-event artwork). Returns a public media URL
 * or null when nothing matches.
 *
 * All Bird traffic goes through ./client.ts.
 */

import { birdJson } from "./client.ts";

export interface BirdMediaQuery {
  apiKey: string;
  workspaceId: string;
  /** Free-text hint — brand name, event code, etc. */
  hint: string;
  /** Limit results scanned. */
  limit?: number;
}

interface BirdMediaItem {
  id?: string;
  name?: string;
  filename?: string;
  url?: string;
  mediaUrl?: string;
  contentType?: string;
  mimeType?: string;
}

interface BirdMediaResponse {
  results?: BirdMediaItem[];
  items?: BirdMediaItem[];
  data?: BirdMediaItem[];
}

function extractItems(resp: BirdMediaResponse): BirdMediaItem[] {
  return resp.results ?? resp.items ?? resp.data ?? [];
}

function itemUrl(item: BirdMediaItem): string | null {
  return item.url ?? item.mediaUrl ?? null;
}

function isImage(item: BirdMediaItem): boolean {
  const ct = (item.contentType ?? item.mimeType ?? "").toLowerCase();
  if (ct.startsWith("image/")) return true;
  const name = (item.filename ?? item.name ?? "").toLowerCase();
  return /\.(png|jpe?g|webp|gif)$/.test(name);
}

function scoreMatch(item: BirdMediaItem, hintLower: string): number {
  const haystack = `${item.name ?? ""} ${item.filename ?? ""}`.toLowerCase();
  if (!hintLower) return 0;
  if (haystack.includes(hintLower)) return 2;
  // token overlap
  const tokens = hintLower.split(/\s+/).filter(Boolean);
  return tokens.reduce((acc, t) => (haystack.includes(t) ? acc + 1 : acc), 0);
}

/**
 * Finds the best-matching image in the Bird Media Library for the hint.
 * Returns null on any error or no match (caller falls through the chain).
 */
export async function findBirdMediaUrl(
  query: BirdMediaQuery,
): Promise<string | null> {
  const { apiKey, workspaceId, hint } = query;
  if (!apiKey || !workspaceId) return null;

  const limit = query.limit ?? 50;
  const search = encodeURIComponent(hint ?? "");
  try {
    const resp = await birdJson<BirdMediaResponse>(
      apiKey,
      `/workspaces/${workspaceId}/media?limit=${limit}&search=${search}`,
      { method: "GET" },
    );
    const items = extractItems(resp).filter(isImage);
    if (items.length === 0) return null;

    const hintLower = (hint ?? "").trim().toLowerCase();
    let best: { url: string; score: number } | null = null;
    for (const item of items) {
      const url = itemUrl(item);
      if (!url) continue;
      const score = scoreMatch(item, hintLower);
      if (!best || score > best.score) best = { url, score };
    }
    return best?.url ?? null;
  } catch {
    return null;
  }
}
