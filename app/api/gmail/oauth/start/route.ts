/**
 * GET /api/gmail/oauth/start — "Connect Gmail" for the Internal Counts
 * pull (HD1). Operator session only. Redirects to Google with scope
 * gmail.readonly, offline access and a signed, nonce-bound state.
 */

import { NextResponse, type NextRequest } from "next/server";

import { buildGmailOAuthUrl, createGmailOAuthState, gmailOAuthConfigFromEnv } from "@/lib/gmail/oauth";
import { createClient } from "@/lib/supabase/server";

const GMAIL_STATE_COOKIE = "gmail_oauth_nonce";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${req.nextUrl.origin}/login`);

  const { config, missing } = gmailOAuthConfigFromEnv();
  if (!config) {
    return NextResponse.json({ ok: false, error: `Gmail connect isn't configured: ${missing.join(", ")} unset.` }, { status: 503 });
  }
  const { state, nonce } = createGmailOAuthState(config.stateSecret);
  const res = NextResponse.redirect(buildGmailOAuthUrl(config, state, user.email ?? undefined));
  res.cookies.set(GMAIL_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
