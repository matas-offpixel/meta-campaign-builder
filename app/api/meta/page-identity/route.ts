/**
 * GET /api/meta/page-identity?pageId=<id>
 *
 * Per-page resolver that the creative step uses to decide:
 *   1. Whether we have a Page access token (used by /api/meta/page-posts).
 *   2. Whether the Page has a linked Instagram account (and which Graph
 *      field surfaced it).
 *
 * Why a separate endpoint?
 *   /api/meta/instagram-accounts walks /me/accounts with the system token,
 *   which often **cannot see Pages the end-user manages**, leading to false
 *   "No linked Instagram account found" messages. This endpoint runs the
 *   lookup with the user's OAuth provider_token first, with an explicit
 *   three-state result (linked / no_ig / unresolved) so the UI can avoid
 *   misreporting.
 *
 * Auth: Supabase session.
 *
 * Response (Page access token is **never** returned to the browser):
 *   {
 *     pageId: string,
 *     pageName?: string,
 *     hasPageToken: boolean,
 *     pageTokenSource: "page_endpoint" | "me_accounts" | "system_fallback" | "none",
 *     ig: { state: "linked", account: { id, username?, name?, source } }
 *       | { state: "no_ig" }
 *       | { state: "unresolved", reason: string }
 *   }
 */

import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  getUserFacebookToken,
  resolvePageIdentity,
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

  const userToken = await getUserFacebookToken(supabase, user.id);

  console.log(
    `[/api/meta/page-identity] resolve pageId=${pageId}` +
      ` userToken=${userToken ? `present(len=${userToken.length})` : "missing"}`,
  );

  const identity = await resolvePageIdentity(pageId, userToken);

  console.log(
    `[/api/meta/page-identity] result pageId=${pageId}` +
      ` pageTokenSource=${identity.pageTokenSource}` +
      ` ig.state=${identity.ig.state}` +
      (identity.ig.state === "linked" ? ` ig.id=${identity.ig.account.id}` : "") +
      (identity.ig.state === "unresolved" ? ` ig.reason=${identity.ig.reason}` : ""),
  );

  // Strip the actual page access token from the public response. The token
  // stays server-side; subsequent server-side endpoints (e.g. page-posts)
  // re-resolve it through the same helper.
  return Response.json({
    pageId: identity.pageId,
    pageName: identity.pageName,
    hasPageToken: identity.pageAccessToken !== null,
    pageTokenSource: identity.pageTokenSource,
    ig:
      identity.ig.state === "linked"
        ? {
            state: "linked" as const,
            account: {
              id: identity.ig.account.id,
              username: identity.ig.account.username,
              name: identity.ig.account.name,
              profilePictureUrl: identity.ig.account.profilePictureUrl,
              source: identity.ig.account.source,
            },
          }
        : identity.ig.state === "no_ig"
          ? { state: "no_ig" as const }
          : { state: "unresolved" as const, reason: identity.ig.reason },
  });
}
