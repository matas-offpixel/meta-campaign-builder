/**
 * lib/gmail/oauth.ts
 *
 * "Connect Gmail" for the Internal Counts pull (HD1). Scope gmail.readonly
 * only. Same shape as the Google Ads connect (lib/google-ads/oauth.ts): a
 * signed, nonce-bound state, offline access, and the refresh token stored
 * encrypted with GMAIL_TOKEN_KEY, a dedicated key that's never reused.
 *
 * The OAuth app must be Internal to the offpixel.co.uk Workspace: an
 * External app in Testing mode gets refresh tokens that expire after 7
 * days, and nothing here is built around an expiring token.
 *
 * Never log a token, a code or a client secret.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  stateSecret: string;
}

export type OAuthFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

const STATE_TTL_MS = 10 * 60 * 1000;

/** Null with the missing variable's name, so callers can say what's missing. */
export function gmailOAuthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { config: GmailOAuthConfig | null; missing: string[] } {
  const names = ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REDIRECT_URI", "GMAIL_OAUTH_STATE_SECRET"] as const;
  const missing = names.filter((n) => !env[n]);
  if (missing.length) return { config: null, missing };
  return {
    config: {
      clientId: env.GMAIL_OAUTH_CLIENT_ID!,
      clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET!,
      redirectUri: env.GMAIL_OAUTH_REDIRECT_URI!,
      stateSecret: env.GMAIL_OAUTH_STATE_SECRET!,
    },
    missing: [],
  };
}

export function buildGmailOAuthUrl(config: GmailOAuthConfig, state: string, loginHint?: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const sign = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("base64url");

export function createGmailOAuthState(secret: string, now = Date.now()): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const encoded = b64url(JSON.stringify({ nonce, iat: now }));
  return { state: `${encoded}.${sign(encoded, secret)}`, nonce };
}

export function verifyGmailOAuthState(input: { state: string; expectedNonce: string; secret: string; now?: number }): void {
  const [encoded, sig] = input.state.split(".");
  if (!encoded || !sig) throw new Error("Gmail OAuth state is malformed.");
  const expected = Buffer.from(sign(encoded, input.secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error("Gmail OAuth state signature mismatch.");
  }
  const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { nonce?: string; iat?: number };
  if (!parsed.nonce || parsed.nonce !== input.expectedNonce) throw new Error("Gmail OAuth state nonce mismatch.");
  const now = input.now ?? Date.now();
  if (typeof parsed.iat !== "number" || now - parsed.iat > STATE_TTL_MS) throw new Error("Gmail OAuth state expired.");
}

export interface GmailTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function tokenCall(body: URLSearchParams, fetcher: OAuthFetch): Promise<GmailTokenResponse> {
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Partial<GmailTokenResponse> & { error?: string };
  if (!res.ok || !json.access_token) {
    // Google's error code only (e.g. invalid_grant); never the body, which can echo a token.
    throw new Error(`Google token endpoint returned ${res.status}${json.error ? ` (${json.error})` : ""}.`);
  }
  return json as GmailTokenResponse;
}

export function exchangeGmailCode(code: string, config: GmailOAuthConfig, fetcher: OAuthFetch = fetch) {
  return tokenCall(
    new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
    fetcher,
  );
}

export function refreshGmailAccessToken(refreshToken: string, config: GmailOAuthConfig, fetcher: OAuthFetch = fetch) {
  return tokenCall(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
    fetcher,
  );
}

/** The scope Google granted must be exactly gmail.readonly: nothing wider is ever stored. */
export function grantedScopeIsReadonly(scope: string | undefined): boolean {
  const scopes = (scope ?? "").split(/\s+/).filter(Boolean);
  return scopes.length === 1 && scopes[0] === GMAIL_READONLY_SCOPE;
}
