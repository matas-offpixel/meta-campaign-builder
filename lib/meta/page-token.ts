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
import { formatIgResolutionAudit, type IgActorRef } from "./ig-identity-guard";
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
  | "ad_account_auto"    // nothing was picked — auto-chosen from the ad account list
  | "page_level"         // /{pageId}/instagram_accounts (page-token endpoint)
  | "content_id_fallback" // nothing better — using content ID as actor (may fail)
  /**
   * The ad account published a non-empty actor list and the content ID is in
   * neither it nor the page-level list. No actor id is returned — callers must
   * surface this to the operator rather than substituting another account.
   */
  | "unauthorised_mismatch";

export interface ResolvedIgActor {
  /** The IG business account id used for loading posts via `/{igUserId}/media`. */
  contentAccountId: string | undefined;
  /**
   * The ads-valid Instagram actor id for `instagram_actor_id` in creative
   * payloads.  Resolved via `/{adAccountId}/instagram_accounts` when possible
   * — that is the ONLY authoritative source Meta Ads accepts.
   *
   * When `contentAccountId` is set this is either that exact id or `undefined`
   * — see the invariant on {@link resolveIgActorForAdAccount}.
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
  /**
   * Actors the ad account will accept, for rendering an actionable error.
   * `null` when the lookup failed or returned nothing.
   */
  adAccountActors: IgActorRef[] | null;
}

/** IG ids linked to a Page — the full list, with no "pick the first" step. */
async function fetchPageIgIds(pageId: string, pageToken: string): Promise<string[] | null> {
  try {
    const res = await graphGetWithToken<{ data?: Array<{ id: string }> }>(
      `/${pageId}/instagram_accounts`,
      { fields: "id,username", limit: "25" },
      pageToken,
    );
    return (res?.data ?? []).map((a) => a.id);
  } catch (err) {
    const msg = err instanceof MetaApiError
      ? `${err.message}${err.code ? ` (code=${err.code})` : ""}`
      : err instanceof Error ? err.message : String(err);
    console.warn(`[resolveIgActorForAdAccount] /${pageId}/instagram_accounts failed: ${msg}`);
    return null;
  }
}

/**
 * Resolve the ads-valid `instagram_actor_id` for a given ad account + page
 * combination, keeping the content account id separate.
 *
 * **Invariant (task #96):** when `contentAccountId` is supplied this returns
 * either that exact id or no id at all. It never returns a *different* account.
 *
 * Until 2026-07-28 the "no match in the ad-account list" branch substituted the
 * first actor from that list. The swap was logged and otherwise invisible, so a
 * creative built for @electricstudiossheff shipped under @shuffa_uk. Publishing
 * an ad under the wrong client's handle is a trust incident, so the mismatch is
 * now reported (`unauthorised_mismatch`) and the launch preflight blocks on it.
 *
 * Resolution order:
 *   1. `GET /{adAccountId}/instagram_accounts` — authoritative for ads.
 *      Match on the content account id only.
 *   2. `GET /{pageId}/instagram_accounts` — vouches for agency setups where the
 *      IG is linked to the Page but is not a BM asset on the ad account
 *      (PR #567, 4thefans WC26). Again, match on the content account id only.
 *   3. No content id supplied → auto-resolve one from whichever list is
 *      available (nothing was picked, so there is nothing to contradict).
 *   4. Otherwise → `unauthorised_mismatch` (evidence of a wrong pick) or
 *      `content_id_fallback` (no evidence either way — send what was picked).
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

  const adAccountActors = await fetchAdAccountIgActors(adAccountId, token);
  const available = adAccountActors.length > 0 ? adAccountActors : null;

  const audit = (source: IgActorSource, resolvedIgId: string | undefined) =>
    console.log(
      formatIgResolutionAudit({
        stage: "resolveIgActorForAdAccount",
        pageId,
        adAccountId,
        pickedIgId: contentAccountId,
        resolvedIgId,
        source,
        adAccountAvailable: available,
      }),
    );

  // ── Step 1: ad-account actors (authoritative) ──────────────────────────────
  const matched = contentAccountId
    ? adAccountActors.find((a) => a.id === contentAccountId)
    : undefined;

  if (matched) {
    audit("ad_account_match", matched.id);
    return {
      contentAccountId,
      actorId: matched.id,
      actorSource: "ad_account_match",
      actorMatchesContent: true,
      adAccountActors: available,
    };
  }

  // ── Step 2: page-level linkage vouches for the SAME id (never a swap) ──────
  const pageIgIds =
    pageId && pageToken ? await fetchPageIgIds(pageId, pageToken) : null;

  if (contentAccountId && pageIgIds?.includes(contentAccountId)) {
    audit("page_level", contentAccountId);
    return {
      contentAccountId,
      actorId: contentAccountId,
      actorSource: "page_level",
      actorMatchesContent: true,
      adAccountActors: available,
    };
  }

  // ── Step 3: nothing was picked — auto-resolution can't contradict anyone ───
  if (!contentAccountId) {
    const auto = adAccountActors[0]?.id ?? pageIgIds?.[0];
    const source: IgActorSource = adAccountActors[0]
      ? "ad_account_auto"
      : "page_level";
    if (auto) {
      audit(source, auto);
      return {
        contentAccountId,
        actorId: auto,
        actorSource: source,
        actorMatchesContent: false,
        adAccountActors: available,
      };
    }
  }

  // ── Step 4a: positive evidence the pick is unauthorised ────────────────────
  if (contentAccountId && available) {
    console.warn(
      `[resolveIgActorForAdAccount] ⚠ UNAUTHORISED IG — ${contentAccountId} is not in` +
        ` /${adAccountId}/instagram_accounts` +
        ` [${available.map((a) => a.id).join(",")}]` +
        ` nor linked to page ${pageId ?? "(none)"}.` +
        ` Refusing to substitute another account — launch preflight will block.`,
    );
    audit("unauthorised_mismatch", undefined);
    return {
      contentAccountId,
      actorId: undefined,
      actorSource: "unauthorised_mismatch",
      actorMatchesContent: false,
      adAccountActors: available,
    };
  }

  // ── Step 4b: no evidence either way — send exactly what was picked ─────────
  audit("content_id_fallback", contentAccountId);
  return {
    contentAccountId,
    actorId: contentAccountId,
    actorSource: "content_id_fallback",
    actorMatchesContent: true,
    adAccountActors: available,
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
