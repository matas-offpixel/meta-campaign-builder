/**
 * lib/mcp/graph-reads.ts
 *
 * The only requests the MCP sends out of the process: four Graph GETs,
 * the first three the app's own read for that picker. Nothing here POSTs, and nothing
 * else in lib/mcp calls fetch (the guard test checks both).
 *
 *   - searchLocations: GET /search?type=adgeolocation, as
 *     GET /api/meta/location-search (locationSearchQuery, parseLocationSearchHits).
 *   - searchInterests: GET /search?type=adinterest&limit=25, as
 *     GET /api/meta/interest-search (the Audiences step's interest picker).
 *   - listPromotePages: GET /{act}/promote_pages, the source of the page
 *     picker's list that Meta checks an ad's page against at launch
 *     (GET /api/meta/pages, fetchPromotePages), cursors followed to 10 pages.
 *   - readAdSetsById: GET /?ids=… (≤ 50 a call), strict_audit's read of each
 *     launched ad set's status and Advantage+ audience flag (M3d-d).
 *
 * The token is the operator's (resolveServerMetaToken in draft-deps.ts) and
 * is never logged or returned. `fetchImpl` is passed so the network test can
 * spy on every request. Relative imports only (node:test).
 */
import { locationSearchQuery, parseLocationSearchHits, type LocationSearchHit } from "../meta/location-search.ts";

export const GRAPH_ORIGIN = "https://graph.facebook.com";

export type FetchLike = (url: string, init: { method: "GET"; cache: "no-store" }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface InterestHit {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string[];
}

export interface AccountPage {
  id: string;
  name: string;
  /** The page's linked Instagram (instagram_business_account.id), when Meta says. */
  instagramId: string | null;
}

async function graphGet(fetchImpl: FetchLike, version: string, path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const url = new URL(`${GRAPH_ORIGIN}/${version}${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetchImpl(url.toString(), { method: "GET", cache: "no-store" });
  const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  // The status only: Meta's message can echo the request, token included.
  if (!res.ok || json.error) throw new Error(`graph ${path} ${res.status}`);
  return json;
}

export async function searchLocations(fetchImpl: FetchLike, version: string, token: string, query: string, types: readonly string[]): Promise<{ hits: LocationSearchHit[]; metaGets: number }> {
  const search = locationSearchQuery(query, types);
  const json = await graphGet(fetchImpl, version, "/search", { type: search.type, q: search.q, location_types: search.location_types, limit: "15" }, token);
  return { hits: parseLocationSearchHits(json.data), metaGets: 1 };
}

export async function searchInterests(fetchImpl: FetchLike, version: string, token: string, query: string): Promise<{ hits: InterestHit[]; metaGets: number }> {
  const json = await graphGet(fetchImpl, version, "/search", { type: "adinterest", q: query.trim(), limit: "25" }, token);
  const raw = Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : [];
  const hits = raw
    .filter((r) => typeof r.id === "string" && typeof r.name === "string")
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      ...(typeof r.audience_size === "number" ? { audienceSize: r.audience_size } : {}),
      ...(Array.isArray(r.path) ? { path: (r.path as unknown[]).map(String) } : {}),
    }));
  return { hits, metaGets: 1 };
}

const MAX_PAGES = 10;

export async function listPromotePages(fetchImpl: FetchLike, version: string, token: string, adAccountId: string): Promise<{ pages: AccountPage[]; metaGets: number; truncated: boolean }> {
  const digits = adAccountId.replace(/^act_/, "");
  if (!/^\d+$/.test(digits)) throw new Error("not an ad account");
  const pages: AccountPage[] = [];
  let after: string | null = null;
  let metaGets = 0;
  for (;;) {
    const params: Record<string, string> = { fields: "id,name,instagram_business_account", limit: "100" };
    if (after) params.after = after;
    const json = await graphGet(fetchImpl, version, `/act_${digits}/promote_pages`, params, token);
    metaGets += 1;
    for (const r of Array.isArray(json.data) ? (json.data as Array<Record<string, unknown>>) : []) {
      if (typeof r.id !== "string") continue;
      const ig = r.instagram_business_account as { id?: unknown } | undefined;
      pages.push({ id: r.id, name: typeof r.name === "string" ? r.name : r.id, instagramId: typeof ig?.id === "string" ? ig.id : null });
    }
    const paging = json.paging as { next?: unknown; cursors?: { after?: unknown } } | undefined;
    after = typeof paging?.cursors?.after === "string" && paging?.next ? paging.cursors.after : null;
    if (!after) return { pages, metaGets, truncated: false };
    if (metaGets >= MAX_PAGES) return { pages, metaGets, truncated: true };
  }
}

/** strict_audit's batch: at most 50 ad set ids a GET (Graph's `ids` limit the app keeps everywhere). */
export const AD_SET_BATCH = 50;

export interface AdSetTargetingRead {
  id: string;
  name: string | null;
  campaignId: string | null;
  campaignName: string | null;
  effectiveStatus: string | null;
  /** targeting.targeting_automation.advantage_audience as Meta stores it; null when Meta gave no targeting. */
  advantageAudience: number | null;
}

/**
 * strict_audit (M3d-d): each ad set's status and Advantage+ audience flag,
 * `GET /?ids=…&fields=effective_status,targeting,name,campaign_id,campaign{name}`,
 * at most 50 ids a GET. A batch Meta refuses is reported in `notRead`, never
 * guessed; the reason stays out (Meta's message can echo the request).
 */
export async function readAdSetsById(fetchImpl: FetchLike, version: string, token: string, ids: readonly string[]): Promise<{ adSets: AdSetTargetingRead[]; notRead: string[]; metaGets: number }> {
  const unique = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
  const adSets: AdSetTargetingRead[] = [];
  const notRead: string[] = [];
  let metaGets = 0;
  for (let i = 0; i < unique.length; i += AD_SET_BATCH) {
    const batch = unique.slice(i, i + AD_SET_BATCH);
    metaGets += 1;
    let json: Record<string, unknown>;
    try {
      json = await graphGet(fetchImpl, version, "/", { ids: batch.join(","), fields: "effective_status,targeting,name,campaign_id,campaign{name}" }, token);
    } catch {
      notRead.push(...batch);
      continue;
    }
    for (const id of batch) {
      const r = json[id] as Record<string, unknown> | undefined;
      if (!r || typeof r !== "object") {
        notRead.push(id);
        continue;
      }
      const targeting = r.targeting as { targeting_automation?: { advantage_audience?: unknown } } | undefined;
      const flag = targeting && typeof targeting === "object" ? Number(targeting.targeting_automation?.advantage_audience ?? 0) : null;
      const campaign = r.campaign as { name?: unknown } | undefined;
      adSets.push({
        id,
        name: typeof r.name === "string" ? r.name : null,
        campaignId: typeof r.campaign_id === "string" ? r.campaign_id : null,
        campaignName: typeof campaign?.name === "string" ? campaign.name : null,
        effectiveStatus: typeof r.effective_status === "string" ? r.effective_status : null,
        advantageAudience: flag != null && Number.isFinite(flag) ? flag : null,
      });
    }
  }
  return { adSets, notRead, metaGets };
}
