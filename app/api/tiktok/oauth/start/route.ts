import { NextResponse } from "next/server";

import {
  buildTikTokOAuthUrl,
  requireTikTokOAuthConfig,
} from "@/lib/tiktok/oauth";

const STATE_COOKIE = "tiktok_oauth_state";

export async function GET() {
  let config;
  try {
    config = requireTikTokOAuthConfig();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "TikTok OAuth is not configured.",
      },
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();
  const res = NextResponse.redirect(
    buildTikTokOAuthUrl({
      appId: config.appId,
      redirectUri: config.redirectUri,
      state,
    }),
  );
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
