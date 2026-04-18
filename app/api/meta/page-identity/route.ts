/**
 * GET /api/meta/page-identity?pageId=<id>&adAccountId=<act_xxx>
 *
 * Per-page resolver that the creative step uses to decide:
 *   1. Whether we have a Page access token (used by /api/meta/page-posts).
 *   2. The Instagram CONTENT account id — used for loading IG posts/media.
 *   3. The Instagram ACTOR id   — used for instagram_actor_id in ad creatives.
 *      These are two distinct concepts:
 *
 *        instagramContentAccountId  = instagram_business_account.id on the Page
 *                                     (loads posts via /{igUserId}/media)
 *
 *        instagramActorId           = resolved via /{adAccountId}/instagram_accounts
 *                                     (the ONLY authoritative source Meta Ads accepts)
 *
 *      When adAccountId is omitted, the route falls back to the page-level
 *      endpoint (/{pageId}/instagram_accounts), which is LESS reliable — the
 *      page-linked content account may differ from the ads-valid actor.
 *
 * Auth: Supabase session.
 *
 * Response (Page access token is **never** returned to the browser):
 *   {
 *     pageId: string,
 *     pageName?: string,
 *     hasPageToken: boolean,
 *     pageTokenSource: "page_endpoint" | "me_accounts" | "system_fallback" | "none",
 *     ig: { state: "linked",
 *            account: {
 *              id: string,           // content account id (for loading posts)
 *              igActorId: string,    // ads-valid actor id (for creative payloads)
 *              actorSource: IgActorSource,
 *              actorMatchesContent: boolean,
 *              username?, name?, profilePictureUrl?, source
 *            }}
 *          | { state: "no_ig" }
 *          | { state: "unresolved", reason: string }
 *   }
 */

import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getUserFacebookToken,
  resolvePageIdentity,
  resolveIgActorForAdAccount,
  resolvePageIgActor,
} from "@/lib/meta/page-token";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const pageId = req.nextUrl.searchParams.get("pageId")?.trim();
  if (!pageId) {
    return Response.json(
      { error: "Query parameter 'pageId' is required" },
      { status: 400 },
    );
  }

  // adAccountId is optional for backward-compat but strongly recommended.
  // Without it we can only do page-level actor resolution which may be wrong.
  const adAccountId = req.nextUrl.searchParams.get("adAccountId")?.trim() || undefined;

  const userToken = await getUserFacebookToken(supabase, user.id);

  console.log(
    `[/api/meta/page-identity] resolve pageId=${pageId}` +
      ` adAccountId=${adAccountId ?? "(none — page-level fallback)"}` +
      ` userToken=${userToken ? `present(len=${userToken.length})` : "missing"}`,
  );

  const identity = await resolvePageIdentity(pageId, userToken);

  console.log(
    `[/api/meta/page-identity] page resolved pageId=${pageId}` +
      ` pageTokenSource=${identity.pageTokenSource}` +
      ` ig.state=${identity.ig.state}` +
      (identity.ig.state === "linked"
        ? ` contentAccountId=${identity.ig.account.id}`
        : "") +
      (identity.ig.state === "unresolved" ? ` ig.reason=${identity.ig.reason}` : ""),
  );

  if (identity.ig.state !== "linked") {
    return Response.json({
      pageId: identity.pageId,
      pageName: identity.pageName,
      hasPageToken: identity.pageAccessToken !== null,
      pageTokenSource: identity.pageTokenSource,
      ig:
        identity.ig.state === "no_ig"
          ? { state: "no_ig" as const }
          : { state: "unresolved" as const, reason: identity.ig.reason },
    });
  }

  const contentAccountId = identity.ig.account.id;

  // ── Resolve the ads-valid Instagram actor id ──────────────────────────────
  // IMPORTANT: the content account id (from Page fields) is NOT necessarily
  // the same as the ads-valid actor id.  Always resolve via the ad account.
  let igActorId: string = contentAccountId;
  let actorSource: string = "content_id_fallback";
  let actorMatchesContent = true;

  if (adAccountId) {
    // Primary path: ad-account-aware resolution (authoritative).
    const resolved = await resolveIgActorForAdAccount(
      contentAccountId,
      adAccountId,
      userToken,
      identity.pageId,
      identity.pageAccessToken ?? undefined,
    );
    igActorId = resolved.actorId ?? contentAccountId;
    actorSource = resolved.actorSource;
    actorMatchesContent = resolved.actorMatchesContent;

    if (!actorMatchesContent) {
      console.warn(
        `[/api/meta/page-identity] ⚠ ACTOR MISMATCH` +
          `\n  contentAccountId = ${contentAccountId}  (used for loading posts)` +
          `\n  igActorId        = ${igActorId}          (will be used in creative payloads)` +
          `\n  actorSource      = ${actorSource}` +
          `\n  adAccountId      = ${adAccountId}` +
          `\n  → Creative payloads will use ${igActorId}, not ${contentAccountId}`,
      );
    } else {
      console.info(
        `[/api/meta/page-identity] ✓ actor resolved` +
          ` contentAccountId=${contentAccountId}` +
          ` igActorId=${igActorId}` +
          ` source=${actorSource}` +
          ` adAccount=${adAccountId}`,
      );
    }
  } else {
    // Fallback path: page-level resolution (less reliable, no ad-account check).
    console.warn(
      `[/api/meta/page-identity] adAccountId not provided — using page-level actor resolution.` +
        ` This may return the content account id, not the ads-valid actor.`,
    );
    if (identity.pageAccessToken) {
      const resolved = await resolvePageIgActor(
        identity.pageId,
        identity.pageAccessToken,
        contentAccountId,
      );
      if (resolved) {
        igActorId = resolved.actorId;
        actorSource = resolved.source;
        actorMatchesContent = igActorId === contentAccountId;
      }
    }

    if (igActorId === contentAccountId) {
      console.warn(
        `[/api/meta/page-identity] actor id = content id (${igActorId}).` +
          ` Pass adAccountId for ad-account-validated resolution.`,
      );
    }
  }

  return Response.json({
    pageId: identity.pageId,
    pageName: identity.pageName,
    hasPageToken: identity.pageAccessToken !== null,
    pageTokenSource: identity.pageTokenSource,
    ig: {
      state: "linked" as const,
      account: {
        /** Content account id — used for loading IG posts via /{igUserId}/media */
        id: contentAccountId,
        /**
         * Ads-valid actor id — use this for instagram_actor_id in creative
         * payloads. Resolved from /{adAccountId}/instagram_accounts when
         * adAccountId was provided; may differ from `id`.
         */
        igActorId,
        actorSource,
        actorMatchesContent,
        username: identity.ig.account.username,
        name: identity.ig.account.name,
        profilePictureUrl: identity.ig.account.profilePictureUrl,
        source: identity.ig.account.source,
      },
    },
  });
}
