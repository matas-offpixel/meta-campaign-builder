import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GoogleAdsClient } from "@/lib/google-ads/client";
import { setGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import {
  customerIdForGoogleAdsApi,
  exchangeGoogleAdsOAuthCode,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  normaliseCustomerId,
  requireGoogleAdsOAuthConfig,
  verifyGoogleAdsOAuthState,
} from "@/lib/google-ads/oauth";

const STATE_COOKIE = "google_ads_oauth_nonce";

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
    return redirectWithStatus(origin, `Google Ads OAuth failed: ${error}`);
  }

  const code = req.nextUrl.searchParams.get("code")?.trim();
  const state = req.nextUrl.searchParams.get("state")?.trim();
  const expectedNonce = req.cookies.get(STATE_COOKIE)?.value;
  if (!code) return redirectWithStatus(origin, "Google Ads OAuth code missing.");
  if (!state || !expectedNonce) {
    return redirectWithStatus(origin, "Google Ads OAuth state missing.");
  }

  let config;
  let parsedState;
  try {
    config = requireGoogleAdsOAuthConfig();
    parsedState = verifyGoogleAdsOAuthState({
      state,
      expectedNonce,
      secret: config.stateSecret,
    });
  } catch (err) {
    return redirectWithStatus(
      origin,
      err instanceof Error ? err.message : "Google Ads OAuth state mismatch.",
    );
  }

  let token;
  try {
    token = await exchangeGoogleAdsOAuthCode(code, config);
  } catch (err) {
    return redirectWithStatus(
      origin,
      err instanceof Error ? err.message : "Google Ads OAuth token exchange failed.",
    );
  }
  if (!token.refresh_token) {
    return redirectWithStatus(
      origin,
      "Google OAuth did not return a refresh token. Reconnect with consent.",
    );
  }

  let customerId = parsedState.customerId ?? null;
  try {
    if (!customerId) {
      customerId = await resolveFirstAccessibleCustomer(token.refresh_token);
    }
    if (!customerId) {
      return redirectWithStatus(origin, "No accessible Google Ads customer found.");
    }

    const loginCustomerId = GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    const accountId = await upsertGoogleAdsAccount({
      userId: user.id,
      customerId,
      loginCustomerId,
      supabase,
    });
    await setGoogleAdsCredentials(supabase, accountId, {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_in: token.expires_in ?? null,
      expiry_date: token.expires_in ? Date.now() + token.expires_in * 1000 : null,
      customer_id: customerId,
      login_customer_id: loginCustomerId,
    });
  } catch (err) {
    return redirectWithStatus(
      origin,
      err instanceof Error ? err.message : "Failed to store Google Ads credentials.",
    );
  }

  const res = NextResponse.redirect(`${origin}/settings?connected=google_ads`);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

async function resolveFirstAccessibleCustomer(
  refreshToken: string,
): Promise<string | null> {
  const client = new GoogleAdsClient();
  const ids = await client.listAccessibleCustomers(refreshToken);
  const loginId = customerIdForGoogleAdsApi(GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const chosen = ids.find((id) => customerIdForGoogleAdsApi(id) !== loginId) ?? ids[0];
  return chosen ? normaliseCustomerId(chosen) : null;
}

async function upsertGoogleAdsAccount({
  userId,
  customerId,
  loginCustomerId,
  supabase,
}: {
  userId: string;
  customerId: string;
  loginCustomerId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}): Promise<string> {
  const { data: existing, error: lookupError } = await supabase
    .from("google_ads_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("google_customer_id", customerId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`Failed to look up Google Ads account: ${lookupError.message}`);
  }
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("google_ads_accounts")
      .update({ login_customer_id: loginCustomerId })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`Failed to update Google Ads account: ${updateError.message}`);
    }
    return existing.id;
  }

  const { data: created, error: insertError } = await supabase
    .from("google_ads_accounts")
    .insert({
      user_id: userId,
      account_name: `Google Ads — ${customerId}`,
      google_customer_id: customerId,
      login_customer_id: loginCustomerId,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !created?.id) {
    throw new Error(
      insertError?.message ?? "Failed to create Google Ads account row.",
    );
  }
  return created.id;
}

function redirectWithStatus(origin: string, message: string): NextResponse {
  const url = new URL("/settings", origin);
  url.searchParams.set("google_ads_oauth_error", message);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
