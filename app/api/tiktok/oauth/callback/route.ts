import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { setTikTokCredentials } from "@/lib/tiktok/credentials";
import {
  exchangeTikTokOAuthCode,
  requireTikTokOAuthConfig,
} from "@/lib/tiktok/oauth";

const STATE_COOKIE = "tiktok_oauth_state";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const origin = req.nextUrl.origin;
  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const error = req.nextUrl.searchParams.get("error_description") ??
    req.nextUrl.searchParams.get("error");
  if (error) {
    return redirectWithStatus(origin, `TikTok OAuth failed: ${error}`);
  }

  const code = req.nextUrl.searchParams.get("code")?.trim();
  const state = req.nextUrl.searchParams.get("state")?.trim();
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;
  if (!code) return redirectWithStatus(origin, "TikTok OAuth code missing.");
  if (!state || !expectedState || state !== expectedState) {
    return redirectWithStatus(origin, "TikTok OAuth state mismatch.");
  }

  let token;
  try {
    token = await exchangeTikTokOAuthCode(code, requireTikTokOAuthConfig());
  } catch (err) {
    return redirectWithStatus(
      origin,
      err instanceof Error ? err.message : "TikTok OAuth token exchange failed.",
    );
  }

  try {
    for (const advertiserId of token.advertiser_ids) {
      const accountId = await upsertTikTokAccount({
        userId: user.id,
        advertiserId,
        supabase,
      });
      await setTikTokCredentials(supabase, accountId, token);
    }
  } catch (err) {
    return redirectWithStatus(
      origin,
      err instanceof Error ? err.message : "Failed to store TikTok credentials.",
    );
  }

  const res = NextResponse.redirect(`${origin}/settings?connected=tiktok`);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

async function upsertTikTokAccount({
  userId,
  advertiserId,
  supabase,
}: {
  userId: string;
  advertiserId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}): Promise<string> {
  const { data: existing, error: lookupError } = await supabase
    .from("tiktok_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("tiktok_advertiser_id", advertiserId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`Failed to look up TikTok account: ${lookupError.message}`);
  }
  if (existing?.id) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from("tiktok_accounts")
    .insert({
      user_id: userId,
      account_name: `TikTok advertiser ${advertiserId}`,
      tiktok_advertiser_id: advertiserId,
      access_token_encrypted: null,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !created?.id) {
    throw new Error(
      insertError?.message ?? "Failed to create TikTok account row.",
    );
  }
  return created.id;
}

function redirectWithStatus(origin: string, message: string): NextResponse {
  const url = new URL("/settings", origin);
  url.searchParams.set("tiktok_oauth_error", message);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
