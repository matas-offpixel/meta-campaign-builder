/**
 * lib/meta/ig-actor-validator.ts
 *
 * Validates whether an Instagram actor id is authorised for use on a given
 * Meta ad creative, and returns a per-launch cached validator.
 *
 * Background (from b57a98e regression audit, 2026-06-05):
 *   - b57a98e removed instagram_actor_id from new-ad payloads to avoid Meta
 *     code=100 "unauthorised actor" errors when an unverified id was sent.
 *   - That caused code=100 subcode=1772103 "Select an Instagram account or
 *     Facebook Page" for any creative with Instagram placements.
 *   - The fix is to re-add the id ONLY when it is confirmed authorised,
 *     defaulting to page-only for genuinely unauthorised accounts.
 *
 * Resolution order (per page-token.ts:158-169 and PR #567 audit):
 *   1. BM-asset list  — GET /act_{adAccountId}/instagram_accounts
 *      Works for accounts where the IG is registered as a BM asset.
 *   2. Page-level list — GET /{pageId}/instagram_accounts  (page access token)
 *      Required for agency setups where IG is linked to the Page but NOT
 *      registered as a BM asset on the ad account. This covers 4thefans WC26.
 *   3. null — genuinely unauthorised; creative falls back to page-only.
 *
 * Usage:
 *   const validator = createIgActorValidator(adAccountId, accessToken);
 *   const validated = await validator.validate(
 *     creative.identity.instagramActorId ?? "",
 *     { pageId: creative.identity.pageId, pageToken: pageTokenMap.get(pageId) },
 *   );
 *   buildCreativePayload(creative, { validatedIgActorId: validated ?? undefined });
 */

import { withActPrefix } from "./ad-account-id.ts";

const META_API_VERSION = "v23.0";

export interface ValidateOpts {
  /** Facebook Page id — enables page-level fallback when BM-asset check misses. */
  pageId?: string;
  /**
   * Page access token (from resolvePageIdentity) — required for the page-level
   * fallback. Pass null/undefined to skip the fallback gracefully.
   */
  pageToken?: string | null;
  /**
   * Operator-selected IG id from `settings.pageInstagramOverrides[pageId]`.
   * When it matches `igActorId`, validate that specific id via page-level
   * (then BM) lists without accepting a different auto-resolved actor.
   */
  operatorOverrideId?: string;
}

export interface IgActorValidator {
  /**
   * Returns `igActorId` if confirmed authorised via the BM-asset list OR via
   * the page-level /{pageId}/instagram_accounts endpoint.
   * Returns `null` if neither path authorises it (b57a98e protection).
   *
   * Each endpoint is fetched at most once per validator instance (cached).
   */
  validate(igActorId: string, opts?: ValidateOpts): Promise<string | null>;
}

/**
 * Create a validator scoped to a single launch (one ad account + access token).
 * The BM-asset list is fetched at most once; page-level lists are fetched at
 * most once per unique pageId — all results cached for the lifetime of the
 * returned instance.
 *
 * If any Meta API call fails (network, rate-limit, auth) the validator
 * continues to the next path rather than blocking the launch.
 */
export function createIgActorValidator(
  adAccountId: string,
  accessToken: string,
): IgActorValidator {
  // Per-igId result cache: igId → validated id (or null).
  const idCache = new Map<string, string | null>();

  // Lazily-fetched BM-asset list. null = not yet fetched; string[] = fetched.
  let authorisedIds: string[] | null = null;

  // Page-level IG account lists: pageId → string[] (fetched at most once per page).
  const pageIgIds = new Map<string, string[]>();

  async function fetchBmIds(): Promise<string[]> {
    if (authorisedIds !== null) return authorisedIds;

    // withActPrefix is idempotent — adAccountId may already carry the "act_" prefix
    // from the launch route. Using raw `act_${adAccountId}` produced act_act_{id}
    // → Graph HTTP 400 → validator returned null → 1772103 (PR #564 / #565).
    const url =
      `https://graph.facebook.com/${META_API_VERSION}/${withActPrefix(adAccountId)}/instagram_accounts` +
      `?fields=id&limit=100&access_token=${accessToken}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(
          `[ig-actor-validator] /instagram_accounts HTTP ${res.status} for ` +
            `adAccount=${adAccountId} — will attempt page-level fallback`,
        );
        authorisedIds = [];
        return [];
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      authorisedIds = (data.data ?? []).map((a) => a.id);
      return authorisedIds;
    } catch (err) {
      console.error(
        `[ig-actor-validator] instagram_accounts fetch failed for adAccount=${adAccountId}: ` +
          `${err instanceof Error ? err.message : String(err)} — will attempt page-level fallback`,
      );
      authorisedIds = [];
      return [];
    }
  }

  async function fetchPageIds(pageId: string, pageToken: string): Promise<string[]> {
    const cached = pageIgIds.get(pageId);
    if (cached !== undefined) return cached;

    const url =
      `https://graph.facebook.com/${META_API_VERSION}/${pageId}/instagram_accounts` +
      `?fields=id&limit=20&access_token=${pageToken}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(
          `[ig-actor-validator] /${pageId}/instagram_accounts HTTP ${res.status} ` +
            `— page-level fallback unavailable`,
        );
        pageIgIds.set(pageId, []);
        return [];
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      const ids = (data.data ?? []).map((a) => a.id);
      pageIgIds.set(pageId, ids);
      console.error(
        `[ig-actor-validator] /${pageId}/instagram_accounts: count=${ids.length} ` +
          `ids=[${ids.join(",")}]`,
      );
      return ids;
    } catch (err) {
      console.error(
        `[ig-actor-validator] /${pageId}/instagram_accounts fetch failed: ` +
          `${err instanceof Error ? err.message : String(err)} — page-level fallback unavailable`,
      );
      pageIgIds.set(pageId, []);
      return [];
    }
  }

  return {
    async validate(igActorId: string, opts?: ValidateOpts): Promise<string | null> {
      if (!igActorId) return null;
      if (idCache.has(igActorId)) return idCache.get(igActorId) ?? null;

      const { pageId, pageToken, operatorOverrideId } = opts ?? {};
      const isOperatorPick =
        Boolean(operatorOverrideId) && operatorOverrideId === igActorId;

      // ── Operator override: validate the chosen id on page-level list first ──
      if (isOperatorPick && pageId && pageToken) {
        const pageList = await fetchPageIds(pageId, pageToken);
        if (pageList.includes(igActorId)) {
          console.error(
            `[ig-actor-validator] resolved via=operator-override page=${pageId} ig=${igActorId}`,
          );
          idCache.set(igActorId, igActorId);
          return igActorId;
        }
      }
      if (isOperatorPick) {
        const bmList = await fetchBmIds();
        if (bmList.includes(igActorId)) {
          console.error(
            `[ig-actor-validator] resolved via=operator-override-bm page=${pageId ?? "(none)"} ig=${igActorId}`,
          );
          idCache.set(igActorId, igActorId);
          return igActorId;
        }
      }

      // ── Path 1: BM-asset list ───────────────────────────────────────────────
      const bmList = await fetchBmIds();
      if (bmList.includes(igActorId)) {
        console.error(
          `[ig-actor-validator] resolved via=bm-asset ` +
            `page=${pageId ?? "(none)"} ig=${igActorId}`,
        );
        idCache.set(igActorId, igActorId);
        return igActorId;
      }

      // ── Path 2: page-level fallback ─────────────────────────────────────────
      if (pageId && pageToken) {
        const pageList = await fetchPageIds(pageId, pageToken);
        if (pageList.includes(igActorId)) {
          console.error(
            `[ig-actor-validator] resolved via=page-level page=${pageId} ig=${igActorId}`,
          );
          idCache.set(igActorId, igActorId);
          return igActorId;
        }
      }

      // ── Path 3: neither authorised — preserve b57a98e protection ───────────
      const reason = pageId && pageToken
        ? "both bm-asset and page-level lists empty"
        : pageId
          ? "bm-asset empty; no page token for page-level fallback"
          : "bm-asset empty; no pageId provided";
      console.error(
        `[ig-actor-validator] resolved via=none ` +
          `page=${pageId ?? "(none)"} ig=${igActorId} (${reason}) ` +
          `— creative will fall back to page-only identity`,
      );
      idCache.set(igActorId, null);
      return null;
    },
  };
}
