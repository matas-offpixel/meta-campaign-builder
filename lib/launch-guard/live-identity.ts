import type { CampaignDraft } from "../types.ts";

import { draftRunsFrom } from "./check.ts";
import type { IdentityOwnership, LiveField, LiveIdentity } from "./types.ts";

/**
 * RC8 (#1362): the live ads' Facebook page and Instagram for a published
 * draft, read once when launch review opens and never while editing.
 * Graph GETs only. No `@/` imports, so the read and its cache are testable
 * with node --test; the route passes the Graph getter in.
 */

/** A Graph GET: path and params in, the parsed body out. Throws on a Graph error. */
export type GraphGet = <T>(path: string, params: Record<string, string>) => Promise<T>;

export interface GraphAd {
  creative?: {
    actor_id?: string;
    instagram_user_id?: string;
    object_story_spec?: { page_id?: string; instagram_user_id?: string; instagram_actor_id?: string };
  };
}

/** Every status but DELETED, which this edge refuses: archived live ads still say what ran. */
export const LIVE_AD_STATUSES = JSON.stringify([
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
]);

/** The campaign a published draft launched, or null (never launched: no read, RC8). */
export function publishedCampaignId(draft: CampaignDraft): string | null {
  if (draft.status !== "published") return null;
  return draft.metaCampaignId?.trim() || null;
}

/** The page and Instagram most live ads use, with how many use each (RC8's majority rule). */
export function majorityIdentity(ads: readonly GraphAd[]): {
  page: { id: string; count: number } | null;
  instagram: { id: string; count: number } | null;
} {
  const pages = new Map<string, number>();
  const igs = new Map<string, number>();
  for (const ad of ads) {
    const spec = ad.creative?.object_story_spec;
    const page = (spec?.page_id ?? ad.creative?.actor_id ?? "").trim();
    const ig = (spec?.instagram_user_id ?? spec?.instagram_actor_id ?? ad.creative?.instagram_user_id ?? "").trim();
    if (page) pages.set(page, (pages.get(page) ?? 0) + 1);
    if (ig) igs.set(ig, (igs.get(ig) ?? 0) + 1);
  }
  const top = (map: Map<string, number>) => {
    let best: { id: string; count: number } | null = null;
    for (const [id, count] of map) if (!best || count > best.count) best = { id, count };
    return best;
  };
  return { page: top(pages), instagram: top(igs) };
}

/**
 * The read: the campaign's ads (one call, up to 200), then the names of the
 * live and the draft's ids (one `?ids=` call), then whether the live ones
 * are another client's (`ownerOf`, page_other_client's sources). Null when
 * the draft isn't published, has no campaign, or has no live ads.
 */
export async function readLiveIdentity(
  get: GraphGet,
  draft: CampaignDraft,
  ownerOf: (pageIds: string[], igIds: string[]) => Promise<IdentityOwnership | null>,
  now: () => Date = () => new Date(),
): Promise<LiveIdentity | null> {
  const campaignId = publishedCampaignId(draft);
  if (!campaignId) return null;
  const ads = await get<{ data?: GraphAd[] }>(`/${campaignId}/ads`, {
    fields: "creative{object_story_spec,actor_id,instagram_user_id}",
    effective_status: LIVE_AD_STATUSES,
    limit: "200",
  });
  const readAt = now().toISOString();
  const top = majorityIdentity(ads.data ?? []);
  if (!top.page && !top.instagram) return null;
  const own = draftRunsFrom(draft);
  const igIds = new Set([own.instagram, top.instagram?.id].filter(Boolean) as string[]);
  const ids = [...new Set([own.page, own.instagram, top.page?.id, top.instagram?.id].filter(Boolean) as string[])];
  const names: Record<string, string> = {};
  try {
    const rows = await get<Record<string, { name?: string; username?: string }>>("/", { ids: ids.join(","), fields: "name,username" });
    for (const id of ids) {
      const row = rows[id];
      const value = (igIds.has(id) ? row?.username ?? row?.name : row?.name)?.trim();
      if (value) names[id] = value;
    }
  } catch (err) {
    console.warn("[launch-guard/live-identity] names read failed:", err instanceof Error ? err.message : err);
  }
  const owners = await ownerOf(top.page ? [top.page.id] : [], top.instagram ? [top.instagram.id] : []);
  const field = (kind: "page" | "instagram", hit: { id: string; count: number } | null): LiveField | null => {
    if (!hit) return null;
    const owner = owners?.owners.find((row) => row.kind === kind && row.id === hit.id);
    const otherClient = Boolean(owner && !owner.ownClient && !owner.artist && owner.otherClients.length > 0);
    return { id: hit.id, name: names[hit.id] ?? owner?.name ?? null, count: hit.count, otherClient };
  };
  const draftNames: Record<string, string> = {};
  for (const id of [own.page, own.instagram]) if (id && names[id]) draftNames[id] = names[id]!;
  return { campaignId, readAt, page: field("page", top.page), instagram: field("instagram", top.instagram), draftNames };
}

/**
 * One read per launch review (RC8): `read(review, draft)` fetches once per
 * review open and campaign, and hands the same answer back on every later
 * call; a new review open reads again. A failed read is logged and gives
 * null, so nothing shows.
 */
export function createLiveIdentityReader(fetchLive: (draft: CampaignDraft) => Promise<LiveIdentity | null>) {
  const cache = new Map<string, Promise<LiveIdentity | null>>();
  return {
    read(review: number, draft: CampaignDraft): Promise<LiveIdentity | null> {
      const campaignId = publishedCampaignId(draft);
      if (!campaignId) return Promise.resolve(null);
      const key = `${review}:${campaignId}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = fetchLive(draft).catch((err: unknown) => {
          console.warn("[launch-guard/live-identity] read failed:", err instanceof Error ? err.message : err);
          return null;
        });
        cache.set(key, hit);
      }
      return hit;
    },
  };
}
