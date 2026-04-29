import { NextResponse, type NextRequest } from "next/server";

import {
  buildGoogleAdsOAuthUrl,
  createGoogleAdsOAuthState,
  requireGoogleAdsOAuthConfig,
} from "@/lib/google-ads/oauth";

const STATE_COOKIE = "google_ads_oauth_nonce";

export async function GET(req: NextRequest) {
  let config;
  try {
    config = requireGoogleAdsOAuthConfig();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Google Ads OAuth is not configured.",
      },
      { status: 500 },
    );
  }

  const { state, nonce } = createGoogleAdsOAuthState({
    secret: config.clientSecret,
    customerId: req.nextUrl.searchParams.get("customerId"),
  });
  const res = NextResponse.redirect(buildGoogleAdsOAuthUrl({ config, state }));
  res.cookies.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
