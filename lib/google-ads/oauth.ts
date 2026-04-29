import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_ADS_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords";
export const GOOGLE_ADS_LOGIN_CUSTOMER_ID = "333-703-8088";

export interface GoogleAdsOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleAdsOAuthStatePayload {
  nonce: string;
  iat: number;
  customerId?: string | null;
}

export interface GoogleAdsOAuthTokenResponse {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  scope?: string | null;
  token_type?: string | null;
}

export type OAuthFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json" | "text">>;

const STATE_TTL_MS = 10 * 60 * 1000;

export function requireGoogleAdsOAuthConfig(): GoogleAdsOAuthConfig {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_ADS_REDIRECT_URI;
  if (!clientId) throw new Error("GOOGLE_ADS_CLIENT_ID is not configured.");
  if (!clientSecret) throw new Error("GOOGLE_ADS_CLIENT_SECRET is not configured.");
  if (!redirectUri) throw new Error("GOOGLE_ADS_REDIRECT_URI is not configured.");
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleAdsOAuthUrl(input: {
  config: GoogleAdsOAuthConfig;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_ADS_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function createGoogleAdsOAuthState(input: {
  secret: string;
  customerId?: string | null;
}): { state: string; nonce: string } {
  const payload: GoogleAdsOAuthStatePayload = {
    nonce: randomBytes(16).toString("hex"),
    iat: Date.now(),
    customerId: input.customerId ? normaliseCustomerId(input.customerId) : null,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = sign(encoded, input.secret);
  return { state: `${encoded}.${sig}`, nonce: payload.nonce };
}

export function verifyGoogleAdsOAuthState(input: {
  state: string;
  expectedNonce: string;
  secret: string;
  now?: number;
}): GoogleAdsOAuthStatePayload {
  const [encoded, sig] = input.state.split(".");
  if (!encoded || !sig) throw new Error("Google Ads OAuth state is malformed.");
  const expectedSig = sign(encoded, input.secret);
  if (!safeEqual(sig, expectedSig)) {
    throw new Error("Google Ads OAuth state signature mismatch.");
  }
  const parsed = JSON.parse(base64UrlDecode(encoded)) as GoogleAdsOAuthStatePayload;
  if (!parsed.nonce || parsed.nonce !== input.expectedNonce) {
    throw new Error("Google Ads OAuth state nonce mismatch.");
  }
  const now = input.now ?? Date.now();
  if (!Number.isFinite(parsed.iat) || now - parsed.iat > STATE_TTL_MS) {
    throw new Error("Google Ads OAuth state expired.");
  }
  return parsed;
}

export async function exchangeGoogleAdsOAuthCode(
  code: string,
  config: GoogleAdsOAuthConfig,
  fetcher: OAuthFetch = fetch,
): Promise<GoogleAdsOAuthTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(async () => {
    const text = await res.text();
    return { error_description: text };
  })) as Record<string, unknown>;

  if (!res.ok) {
    const message =
      typeof json.error_description === "string"
        ? json.error_description
        : `Google Ads OAuth token exchange failed: HTTP ${res.status}`;
    throw new Error(message);
  }

  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("Google OAuth response did not include access_token.");
  }
  return {
    access_token: accessToken,
    refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expires_in: typeof json.expires_in === "number" ? json.expires_in : null,
    scope: typeof json.scope === "string" ? json.scope : null,
    token_type: typeof json.token_type === "string" ? json.token_type : null,
  };
}

export function normaliseCustomerId(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return value.trim();
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function customerIdForGoogleAdsApi(value: string): string {
  return value.replace(/\D/g, "");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
