/**
 * lib/meta/page-token.ts
 *
 * Server-only helpers for resolving Facebook **Page access tokens** and
 * **linked Instagram accounts** for a single Page.
 *
 * Background:
 *   - Several Graph endpoints (notably `/{page_id}/published_posts`) require a
 *     Page-scoped access token rather than a user/system token. Calling them
 *     with the wrong token surfaces:
 *       (#210) A page access token is required to request this resource.
 *   - The user's OAuth `provider_token` (stored in `user_facebook_tokens`)
 *     can be exchanged for a Page token via `GET /{page_id}?fields=access_token`,
 *     because Meta returns Page tokens scoped to whichever user owns/manages
 *     that Page.
 *   - The system token (`META_ACCESS_TOKEN`) often **cannot** see Pages the
 *     end-user manages, which is also why "No linked Instagram account found"
 *     can be a false negative — the system token simply can't see the IG link.
 *
 * Strategy used here:
 *   1. Try `GET /{page_id}?fields=access_token,…` with the user OAuth token.
 *   2. Fall back to scanning `GET /me/accounts?fields=id,name,access_token,…`
 *      with the user OAuth token (covers personal pages where the direct
 *      lookup may behave differently).
 *   3. As a last resort, return the system token. The caller decides whether
 *      to use it (it's NOT a Page token, but some endpoints accept it for
 *      BM-owned pages).
 *
 * Token order is intentionally user-first because Page operations should run
 * in the same permission context as Ads Manager.
 */

import { graphGetWithToken, MetaApiError, fetchAdAccountIgActors } from "./client";
import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PageTokenSource =
  | "page_endpoint"
  | "me_accounts"
  | "system_fallback"
  | "none";

export type IgLinkSource =
  | "instagram_business_account"
  | "connected_instagram_account";

export interface ResolvedIgAccount {
  id: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  source: IgLinkSource;
}

export type IgResolution =
  /** Page exists and we positively confirmed there is **no** linked IG. */
  | { state: "no_ig"; account: null }
  /** Page exists and we resolved a linked IG account. */
  | { state: "linked"; account: ResolvedIgAccount }
  /** Lookup failed (permissions, bad token, etc.) — UI should NOT claim "no IG". */
  | { state: "unresolved"; account: null; reason: string };

export interface ResolvedPageIdentity {
  pageId: string;
  pageName?: string;
  /** Page access token, if we successfully resolved one. NEVER expose to browser. */
  pageAccessToken: string | null;
  /** Where the page token came from. */
  pageTokenSource: PageTokenSource;
  /** IG linkage outcome — three-state (linked / no_ig / unresolved). */
  ig: IgResolution;
}

// ─── Supabase token loader ─────────────────────────────────────────────────────

/**
 * Read the user's Facebook OAuth `provider_token` from `user_facebook_tokens`.
 * Returns null when the row is missing or the table call errors — callers
 * must treat null as "fall back to system token".
 */
export async function getUserFacebookToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("user_facebook_tokens")
      .select("provider_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn(
        `[getUserFacebookToken] read failed user=${userId} msg=${error.message}`,
      );
      return null;
    }
    return data?.provider_token ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[getUserFacebookToken] exception user=${userId} ${msg}`);
    return null;
  }
}

// ─── Internal Graph response shapes ────────────────────────────────────────────

interface RawIgFields {
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
}

interface RawPageNode {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: RawIgFields;
  connected_instagram_account?: RawIgFields;
}

interface RawAccountsResponse {
  data?: RawPageNode[];
}

const PAGE_FIELDS =
  "id,name,access_token," +
  "instagram_business_account{id,username,name,profile_picture_url}," +
  "connected_instagram_account{id,username,name,profile_picture_url}";

function pickIg(node: RawPageNode): IgResolution {
  const business = node.instagram_business_account?.id
    ? node.instagram_business_account
    : null;
  const connected = node.connected_instagram_account?.id
    ? node.connected_instagram_account
    : null;
  const picked = business ?? connected;
  if (!picked) return { state: "no_ig", account: null };
  const source: IgLinkSource = business
    ? "instagram_business_account"
    : "connected_instagram_account";
  return {
    state: "linked",
    account: {
      id: picked.id!,
      username: picked.username,
      name: picked.name,
      profilePictureUrl: picked.profile_picture_url,
      source,
    },
  };
}

// ─── Ads-compatible Instagram actor resolver ──────────────────────────────────

/**
 * Resolve the ads-compatible Instagram actor id for a Page.
 *
 * `GET /{pageId}/instagram_accounts` (with a Page access token) is the
 * endpoint Meta Ads uses to list Instagram accounts that are valid
 * `instagram_actor_id` values for ad creatives using this Page.
 *
 * This works correctly in **agency workflows** where the IG account is linked
 * to the client Page but is NOT a directly owned Business Manager asset.
 * `GET /{adAccountId}/instagram_accounts` (BM-asset list) should NOT be used
 * as a gating check — it excludes agency-linked IG accounts and causes false
 * "(#100) must be a valid Instagram account id" rejections.
 *
 * Falls back to `igContentId` (the id from `instagram_business_account` or
 * `connected_instagram_account` on the Page) when the endpoint is unavailable.
 * Returns `null` only when both paths are absent.
 *
 * @param pageId       Facebook Page id.
 * @param pageToken    Page access token obtained from `resolvePageIdentity`.
 * @param igContentId  Optional fallback: content API account id from Page fields.
 */
export async function resolvePageIgActor(
  pageId: string,
  pageToken: string,
  igContentId?: string,
): Promise<{ actorId: string; source: "page_instagram_accounts" | "content_id_fallback" } | null> {
  try {
    const res = await graphGetWithToken<{ data?: Array<{ id: string; username?: string }> }>(
      `/${pageId}/instagram_accounts`,
      { fields: "id,username", limit: "5" },
      pageToken,
    );
    const first = res?.data?.[0];
    if (first?.id) {
      console.info(
        `[resolvePageIgActor] /${pageId}/instagram_accounts → actorId=${first.id}` +
          (first.username ? ` @${first.username}` : ""),
      );
      return { actorId: first.id, source: "page_instagram_accounts" };
    }
    console.info(
      `[resolvePageIgActor] /${pageId}/instagram_accounts returned 0 accounts` +
        (igContentId ? `; falling back to content id ${igContentId}` : ""),
    );
  } catch (err) {
    const msg = err instanceof MetaApiError
      ? `${err.message}${err.code ? ` (code=${err.code})` : ""}`
      : err instanceof Error ? err.message : String(err);
    console.warn(
      `[resolvePageIgActor] /${pageId}/instagram_accounts failed: ${msg}` +
        (igContentId ? `; falling back to content id ${igContentId}` : ""),
    );
  }

  if (igContentId) {
    console.info(
      `[resolvePageIgActor] using content id ${igContentId} as actor id fallback for page ${pageId}`,
    );
    return { actorId: igContentId, source: "content_id_fallback" };
  }

  return null;
}

// ─── Ad-account-aware Instagram actor resolver ────────────────────────────────

export type IgActorSource =
  | "ad_account_match"   // content ID was found in /{adAccountId}/instagram_accounts
  | "ad_account_first"   // ad account returned actors but none match the content ID
  | "page_level"         // /{pageId}/instagram_accounts (page-token endpoint)
  | "content_id_fallback"; // nothing better — using content ID as actor (may fail)

export interface ResolvedIgActor {
  /** The IG business account id used for loading posts via `/{igUserId}/media`. */
  contentAccountId: string | undefined;
  /**
   * The ads-valid Instagram actor id for `instagram_actor_id` in creative
   * payloads.  Resolved via `/{adAccountId}/instagram_accounts` when possible
   * — that is the ONLY authoritative source Meta Ads accepts.
   */
  actorId: string | undefined;
  actorSource: IgActorSource;
  /**
   * `true` when the content account and ads actor are the same ID.
   * `false` means posts will be loaded from one account but the ad will be
   * published under a different actor — valid in some agency setups but worth
   * logging explicitly.
   */
  actorMatchesContent: boolean;
}

/**
 * Resolve the ads-valid `instagram_actor_id` for a given ad account + page
 * combination, keeping the content account id separate.
 *
 * Resolution order:
 *   1. Call `GET /{adAccountId}/instagram_accounts` (authoritative for ads).
 *      a. If the content account id is in the list → use it (match).
 *      b. If no match but the list is non-empty → use the first actor.
 *   2. Fall back to `GET /{pageId}/instagram_accounts` (page-level, less reliable).
 *   3. Last resort: use `contentAccountId` as actor (may still fail at Meta).
 *
 * @param contentAccountId  IG account id from `instagram_business_account.id` on
 *                          the Page — used for post loading, not necessarily valid
 *                          as an ad actor.
 * @param adAccountId       Meta ad account id (e.g. "act_123456789").
 * @param userToken         User OAuth provider token.
 * @param pageId            Optional Page id — used for page-level fallback only.
 * @param pageToken         Optional Page access token — used for page-level fallback.
 */
export async function resolveIgActorForAdAccount(
  contentAccountId: string | undefined,
  adAccountId: string,
  userToken: string | null,
  pageId?: string,
  pageToken?: string,
): Promise<ResolvedIgActor> {
  const token = userToken ?? process.env.META_ACCESS_TOKEN ?? undefined;

  // ── Step 1: ad-account actors (authoritative) ──────────────────────────────
  const adAccountActors = await fetchAdAccountIgActors(adAccountId, token);

  if (adAccountActors.length > 0) {
    // Prefer the actor that matches the content account id.
    const matched = contentAccountId
      ? adAccountActors.find((a) => a.id === contentAccountId)
      : undefined;

    if (matched) {
      console.info(
        `[resolveIgActorForAdAccount] ✓ content id matches ad-account actor` +
          ` adAccount=${adAccountId} actorId=${matched.id}` +
          (matched.username ? ` @${matched.username}` : ""),
      );
      return {
        contentAccountId,
        actorId: matched.id,
        actorSource: "ad_account_match",
        actorMatchesContent: true,
      };
    }

    // No match — use first actor; log the discrepancy prominently.
    const first = adAccountActors[0];
    console.warn(
      `[resolveIgActorForAdAccount] ⚠ content id ${contentAccountId ?? "(none)"} NOT found` +
        ` in /${adAccountId}/instagram_accounts` +
        ` — using first actor ${first.id}` +
        (first.username ? ` @${first.username}` : "") +
        `; creative payloads will use actor id ${first.id}` +
        ` while posts are loaded from content account ${contentAccountId ?? "(none)"}`,
    );
    return {
      contentAccountId,
      actorId: first.id,
      actorSource: "ad_account_first",
      actorMatchesContent: false,
    };
  }

  console.warn(
    `[resolveIgActorForAdAccount] /${adAccountId}/instagram_accounts returned 0 actors` +
      ` — falling back to page-level resolution`,
  );

  // ── Step 2: page-level fallback ─────────────────────────────────────────────
  if (pageId && pageToken) {
    const pageResult = await resolvePageIgActor(pageId, pageToken, contentAccountId);
    if (pageResult) {
      return {
        contentAccountId,
        actorId: pageResult.actorId,
        actorSource: "page_level",
        actorMatchesContent: pageResult.actorId === contentAccountId,
      };
    }
  }

  // ── Step 3: content id as last resort ──────────────────────────────────────
  console.warn(
    `[resolveIgActorForAdAccount] all resolution paths failed for adAccount=${adAccountId}` +
      ` — using content id ${contentAccountId ?? "(none)"} as actor fallback (may fail at Meta)`,
  );
  return {
    contentAccountId,
    actorId: contentAccountId,
    actorSource: "content_id_fallback",
    actorMatchesContent: true,
  };
}

// ─── Page identity resolver ────────────────────────────────────────────────────

/**
 * Resolve a Page access token + linked Instagram account for a single Page.
 *
 * The function never throws — failures are surfaced via:
 *   - `pageAccessToken: null` + `pageTokenSource: "system_fallback" | "none"`
 *   - `ig.state: "unresolved"` with a `reason`
 *
 * @param pageId      The Facebook Page ID.
 * @param userToken   The user's OAuth provider token (from `user_facebook_tokens`).
 *                    Pass `null` if it isn't available; resolution will likely fail.
 */
export async function resolvePageIdentity(
  pageId: string,
  userToken: string | null,
): Promise<ResolvedPageIdentity> {
  const systemToken = process.env.META_ACCESS_TOKEN ?? null;
  let lastError: string | undefined;

  // ── Attempt 1: GET /{pageId} with user token (preferred) ────────────────────
  if (userToken) {
    try {
      const node = await graphGetWithToken<RawPageNode>(
        `/${pageId}`,
        { fields: PAGE_FIELDS },
        userToken,
      );
      if (node?.id) {
        const ig = pickIg(node);
        return {
          pageId: node.id,
          pageName: node.name,
          pageAccessToken: node.access_token ?? null,
          pageTokenSource: node.access_token ? "page_endpoint" : "none",
          ig,
        };
      }
    } catch (err) {
      lastError =
        err instanceof MetaApiError
          ? `${err.message}${err.code ? ` (code=${err.code})` : ""}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.warn(
        `[resolvePageIdentity] /${pageId} user-token lookup failed: ${lastError}`,
      );
    }
  }

  // ── Attempt 2: scan /me/accounts with user token ────────────────────────────
  if (userToken) {
    try {
      const res = await graphGetWithToken<RawAccountsResponse>(
        "/me/accounts",
        { fields: PAGE_FIELDS, limit: "200" },
        userToken,
      );
      const node = (res.data ?? []).find((p) => p.id === pageId);
      if (node) {
        const ig = pickIg(node);
        return {
          pageId: node.id,
          pageName: node.name,
          pageAccessToken: node.access_token ?? null,
          pageTokenSource: node.access_token ? "me_accounts" : "none",
          ig,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = lastError ?? msg;
      console.warn(
        `[resolvePageIdentity] /me/accounts user-token scan failed: ${msg}`,
      );
    }
  }

  // ── Attempt 3: system-token lookup (BM-owned pages only) ────────────────────
  // System token is NOT a Page token, but if it can read the page's IG fields
  // we should still surface them rather than declaring the linkage unresolved.
  if (systemToken) {
    try {
      const node = await graphGetWithToken<RawPageNode>(
        `/${pageId}`,
        { fields: PAGE_FIELDS },
        systemToken,
      );
      if (node?.id) {
        const ig = pickIg(node);
        return {
          pageId: node.id,
          pageName: node.name,
          pageAccessToken: null,
          pageTokenSource: "system_fallback",
          ig,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = lastError ?? msg;
      console.warn(
        `[resolvePageIdentity] /${pageId} system-token lookup failed: ${msg}`,
      );
    }
  }

  // ── All attempts failed ─────────────────────────────────────────────────────
  return {
    pageId,
    pageAccessToken: null,
    pageTokenSource: "none",
    ig: {
      state: "unresolved",
      account: null,
      reason:
        lastError ??
        (userToken
          ? "Page is not visible to your Facebook account"
          : "No Facebook OAuth token available"),
    },
  };
}
