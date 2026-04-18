/**
 * GET /api/meta/instagram-accounts
 *
 * Returns Instagram accounts linked to Pages the current user manages.
 *
 * Auth: Supabase session. The user's Facebook OAuth `provider_token` (from
 * `user_facebook_tokens`) is used for the `/me/accounts` source so we see
 * the same Pages the user sees in Ads Manager — using the system token
 * alone causes false "No linked Instagram account found" reports because
 * `/me/accounts` then returns the System User's pages, not the end-user's.
 */

import { createClient } from "@/lib/supabase/server";
import { fetchInstagramAccounts, MetaApiError } from "@/lib/meta/client";
import { getUserFacebookToken } from "@/lib/meta/page-token";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const userToken = await getUserFacebookToken(supabase, user.id);
  console.log(
    `[/api/meta/instagram-accounts] resolve user=${user.id}` +
      ` userToken=${userToken ? "present" : "missing"}`,
  );

  try {
    const accounts = await fetchInstagramAccounts(userToken ?? undefined);
    return Response.json({
      data: accounts,
      count: accounts.length,
      tokenSource: userToken ? "user" : "system",
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/instagram-accounts] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
