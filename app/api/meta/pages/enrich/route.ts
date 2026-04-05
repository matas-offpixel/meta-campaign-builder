/**
 * POST /api/meta/pages/enrich
 *
 * Phase 2 enrichment: given a list of up to 50 Facebook Page IDs, fetches
 * additional fields (profile picture, follower count, linked Instagram) using
 * the Graph API's multi-ID endpoint:
 *
 *   GET /?ids=id1,id2,...&fields=picture{url},fan_count,instagram_business_account{id,name,followers_count}
 *
 * The provider_token is passed via the Authorization header (same as the
 * listing endpoint).
 *
 * Fallback strategy:
 *   1. Try full fields including instagram_business_account sub-fields.
 *   2. If that fails (e.g. permissions), retry with just picture{url},fan_count.
 *   3. If that also fails, return the ids with all enriched fields as null.
 *
 * Response: { data: Record<pageId, EnrichedPageData>, stats: {...} }
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;
const MAX_IDS_PER_REQUEST = 50;

interface RawIgAccount {
  id?: string;
  name?: string;
  username?: string;
  followers_count?: number;
}

interface RawEnrichedPage {
  id: string;
  picture?: { data?: { url?: string } };
  fan_count?: number;
  /** Standard Instagram Business Account link (via BM or "Switch to professional") */
  instagram_business_account?: RawIgAccount;
  /** Fallback: personal/creator IG connected via Page Settings "Connected account" */
  connected_instagram_account?: RawIgAccount;
}

export interface EnrichedPageData {
  pictureUrl: string | null;
  facebookFollowers: number | null;
  instagramAccountId: string | null;
  instagramUsername: string | null;
  instagramFollowers: number | null;
  hasInstagramLinked: boolean;
  /**
   * Which Graph API field surfaced the IG account.
   * null when no IG account was found.
   */
  igLinkSource: "instagram_business_account" | "connected_instagram_account" | null;
}

export interface EnrichResponse {
  data: Record<string, EnrichedPageData>;
  stats: {
    requested: number;
    enriched: number;
    withPhoto: number;
    withFollowers: number;
    withInstagram: number;
    withInstagramFollowers: number;
  };
  /** Present if the enrichment fell back to basic fields (no Instagram) */
  fallback?: boolean;
  /** Present if enrichment failed entirely */
  error?: string;
}

function parseEnriched(raw: RawEnrichedPage): EnrichedPageData {
  const igBusiness = raw.instagram_business_account?.id ? raw.instagram_business_account : null;
  const igConnected = raw.connected_instagram_account?.id ? raw.connected_instagram_account : null;

  // Prefer instagram_business_account; use connected_instagram_account as fallback.
  const ig = igBusiness ?? igConnected;
  const igLinkSource: EnrichedPageData["igLinkSource"] =
    igBusiness ? "instagram_business_account" :
    igConnected ? "connected_instagram_account" :
    null;

  if (!igBusiness && igConnected) {
    console.info(
      `[pages/enrich] page ${raw.id}: instagram_business_account is null,` +
      ` falling back to connected_instagram_account (id=${igConnected.id})`,
    );
  }
  if (!igBusiness && !igConnected) {
    console.info(`[pages/enrich] page ${raw.id}: no IG account found in either field`);
  }

  // Prefer username field if present (more recognisable than name).
  const igUsername = ig?.username ?? ig?.name ?? null;

  return {
    pictureUrl: raw.picture?.data?.url ?? null,
    facebookFollowers: raw.fan_count ?? null,
    instagramAccountId: ig?.id ?? null,
    instagramUsername: igUsername,
    instagramFollowers: ig?.followers_count ?? null,
    hasInstagramLinked: !!ig?.id,
    igLinkSource,
  };
}

async function fetchEnrichment(
  ids: string[],
  token: string,
  fields: string,
): Promise<{ ok: true; map: Record<string, RawEnrichedPage> } | { ok: false; error: string; rawError?: unknown }> {
  const params = new URLSearchParams({
    ids: ids.join(","),
    fields,
    access_token: token,
  });
  const url = `${BASE}/?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    return { ok: false, error: "Network error reaching Graph API", rawError: e };
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Non-JSON response from Meta", rawError: text.slice(0, 200) };
  }

  if (!res.ok || (json && typeof json === "object" && "error" in json)) {
    const err = (json as Record<string, unknown>).error ?? {};
    return { ok: false, error: String((err as Record<string, unknown>).message ?? `HTTP ${res.status}`), rawError: err };
  }

  return { ok: true, map: json as Record<string, RawEnrichedPage> };
}

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const providerToken = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!providerToken) {
    return Response.json({ error: "No Facebook access token provided.", code: "NO_PROVIDER_TOKEN" }, { status: 401 });
  }

  let body: { ids?: unknown };
  try {
    body = (await req.json()) as { ids?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return Response.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }

  const ids = (body.ids as unknown[]).slice(0, MAX_IDS_PER_REQUEST).map(String);

  console.info(`[pages/enrich] enriching ${ids.length} pages`);

  // ── Attempt 1: full fields including both IG link types ──────────────────
  // connected_instagram_account covers pages where the user connected a personal
  // or creator IG account via Page Settings → "Connected account", rather than
  // going through the Business Manager / "Switch to professional" flow.
  const FULL_FIELDS =
    "picture{url},fan_count," +
    "instagram_business_account{id,username,name,followers_count}," +
    "connected_instagram_account{id,username,name,followers_count}";
  const BASIC_FIELDS = "picture{url},fan_count";

  let result = await fetchEnrichment(ids, providerToken, FULL_FIELDS);
  let usedFallback = false;

  if (!result.ok) {
    console.warn(`[pages/enrich] full enrichment failed (${result.error}), retrying with basic fields`);
    result = await fetchEnrichment(ids, providerToken, BASIC_FIELDS);
    usedFallback = true;
  }

  if (!result.ok) {
    console.error(`[pages/enrich] basic enrichment also failed: ${result.error}`, result.rawError);
    // Return all nulls — enrichment failure must not fail the page list
    const nullData: Record<string, EnrichedPageData> = {};
    for (const id of ids) {
      nullData[id] = {
        pictureUrl: null,
        facebookFollowers: null,
        instagramAccountId: null,
        instagramUsername: null,
        instagramFollowers: null,
        hasInstagramLinked: false,
        igLinkSource: null,
      };
    }
    return Response.json({
      data: nullData,
      stats: { requested: ids.length, enriched: 0, withPhoto: 0, withFollowers: 0, withInstagram: 0, withInstagramFollowers: 0 },
      error: result.error,
    } satisfies EnrichResponse);
  }

  // ── Build output map ──────────────────────────────────────────────────────
  const dataMap: Record<string, EnrichedPageData> = {};
  let withPhoto = 0, withFollowers = 0, withInstagram = 0, withInstagramFollowers = 0;

  for (const id of ids) {
    const raw = result.map[id];
    if (!raw) {
      dataMap[id] = {
        pictureUrl: null, facebookFollowers: null,
        instagramAccountId: null, instagramUsername: null,
        instagramFollowers: null, hasInstagramLinked: false,
        igLinkSource: null,
      };
      continue;
    }
    const enriched = parseEnriched(raw);
    dataMap[id] = enriched;
    if (enriched.pictureUrl)          withPhoto++;
    if (enriched.facebookFollowers !== null) withFollowers++;
    if (enriched.hasInstagramLinked)  withInstagram++;
    if (enriched.instagramFollowers !== null) withInstagramFollowers++;
  }

  const stats = {
    requested: ids.length,
    enriched: Object.keys(dataMap).length,
    withPhoto, withFollowers, withInstagram, withInstagramFollowers,
  };

  console.info(
    `[pages/enrich] done — photo:${withPhoto} fans:${withFollowers} IG:${withInstagram} IGfollowers:${withInstagramFollowers}` +
    (usedFallback ? " [FALLBACK — no Instagram data]" : ""),
  );

  return Response.json({ data: dataMap, stats, fallback: usedFallback || undefined } satisfies EnrichResponse);
}
