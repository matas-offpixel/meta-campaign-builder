/**
 * GET /api/gmail/oauth/callback — finishes "Connect Gmail" (HD1).
 *
 * Checks the state, exchanges the code, insists the grant is exactly
 * gmail.readonly with a refresh token, and stores the refresh token
 * encrypted with GMAIL_TOKEN_KEY. Never logs or returns a token.
 */

import { NextResponse, type NextRequest } from "next/server";

import { GmailClient } from "@/lib/gmail/client";
import { gmailTokenKey, saveGmailConnection } from "@/lib/gmail/connection";
import {
  exchangeGmailCode,
  gmailOAuthConfigFromEnv,
  grantedScopeIsReadonly,
  verifyGmailOAuthState,
} from "@/lib/gmail/oauth";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const STATE_COOKIE = "gmail_oauth_nonce";

function back(origin: string, status: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/internal-counts?gmail=${encodeURIComponent(status)}`);
  res.cookies.delete(STATE_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  if (req.nextUrl.searchParams.get("error")) return back(origin, "declined");
  const code = req.nextUrl.searchParams.get("code")?.trim();
  const state = req.nextUrl.searchParams.get("state")?.trim();
  const nonce = req.cookies.get(STATE_COOKIE)?.value;
  const { config } = gmailOAuthConfigFromEnv();
  const key = gmailTokenKey();
  if (!config || !key) return back(origin, "not_configured");
  if (!code || !state || !nonce) return back(origin, "state_missing");
  try {
    verifyGmailOAuthState({ state, expectedNonce: nonce, secret: config.stateSecret });
  } catch {
    return back(origin, "state_mismatch");
  }

  try {
    const token = await exchangeGmailCode(code, config);
    if (!grantedScopeIsReadonly(token.scope)) return back(origin, "wrong_scope");
    if (!token.refresh_token) return back(origin, "no_refresh_token");
    const email = await new GmailClient(token.access_token).profileEmail();
    await saveGmailConnection(createServiceRoleClient(), {
      userId: user.id,
      email,
      scope: token.scope!,
      refreshToken: token.refresh_token,
      key,
    });
    return back(origin, "connected");
  } catch (err) {
    console.error(`[gmail-oauth] ${err instanceof Error ? err.message : "connect failed"}`);
    return back(origin, "failed");
  }
}
