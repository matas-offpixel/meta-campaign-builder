/**
 * lib/meta/ig-actor-validator.ts
 *
 * Validates whether an Instagram actor id is authorised on a given Meta ad
 * account, and returns a per-launch cached validator.
 *
 * Background (from b57a98e regression audit, 2026-06-05):
 *   - b57a98e removed instagram_actor_id from new-ad payloads to avoid Meta
 *     code=100 "unauthorised actor" errors when an unverified id was sent.
 *   - That caused code=100 subcode=1772103 "Select an Instagram account or
 *     Facebook Page" for any creative with Instagram placements.
 *   - The fix is to re-add the id ONLY when it is confirmed authorised on the
 *     ad account, defaulting to page-only for unverified accounts (graceful
 *     degradation).
 *
 * Usage:
 *   const validator = createIgActorValidator(adAccountId, accessToken);
 *   const validated = await validator.validate(creative.identity.instagramActorId ?? "");
 *   buildCreativePayload(creative, { validatedIgActorId: validated ?? undefined });
 */

const META_API_VERSION = "v23.0";

export interface IgActorValidator {
  /**
   * Returns `igActorId` if it is confirmed authorised on this ad account's
   * linked Instagram accounts, or `null` if unverified / not found / API error.
   *
   * Calls `GET /act_{adAccountId}/instagram_accounts` at most once per
   * validator instance — subsequent calls for any id use the cached list.
   */
  validate(igActorId: string): Promise<string | null>;
}

/**
 * Create a validator that is scoped to a single launch (one ad account +
 * access token). The authorised-accounts list is fetched at most once and
 * cached for the lifetime of the returned instance.
 *
 * If the Meta API call fails for any reason (network, rate-limit, auth) the
 * validator defaults to returning `null` for all ids — every creative falls
 * back to page-only rather than blocking the entire launch.
 */
export function createIgActorValidator(
  adAccountId: string,
  accessToken: string,
): IgActorValidator {
  // Per-id cache: igActorId → validated id (or null)
  const idCache = new Map<string, string | null>();

  // Lazily-fetched list of authorised IG account ids for this ad account.
  // null = not yet fetched; string[] = fetched (may be empty).
  let authorisedIds: string[] | null = null;

  async function fetchAuthorisedIds(): Promise<string[]> {
    if (authorisedIds !== null) return authorisedIds;

    const url =
      `https://graph.facebook.com/${META_API_VERSION}/act_${adAccountId}/instagram_accounts` +
      `?fields=id&limit=100&access_token=${accessToken}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(
          `[ig-actor-validator] instagram_accounts API returned HTTP ${res.status} ` +
            `for adAccount=${adAccountId} — defaulting to page-only for all creatives`,
        );
        authorisedIds = [];
        return [];
      }
      const data = (await res.json()) as { data?: { id: string }[] };
      authorisedIds = (data.data ?? []).map((a) => a.id);
      console.error(
        `[ig-actor-validator] adAccount=${adAccountId} has ${authorisedIds.length} ` +
          `authorised IG account(s)`,
      );
      return authorisedIds;
    } catch (err) {
      console.error(
        `[ig-actor-validator] instagram_accounts fetch failed for adAccount=${adAccountId}: ` +
          `${err instanceof Error ? err.message : String(err)} — defaulting to page-only`,
      );
      authorisedIds = [];
      return [];
    }
  }

  return {
    async validate(igActorId: string): Promise<string | null> {
      if (!igActorId) return null;
      if (idCache.has(igActorId)) return idCache.get(igActorId) ?? null;

      const authorised = await fetchAuthorisedIds();
      const result = authorised.includes(igActorId) ? igActorId : null;
      idCache.set(igActorId, result);

      if (result === null) {
        console.error(
          `[ig-actor-validator] igActorId=${igActorId} NOT found in adAccount=${adAccountId} ` +
            `instagram_accounts — creative will fall back to page-only identity`,
        );
      }

      return result;
    },
  };
}
