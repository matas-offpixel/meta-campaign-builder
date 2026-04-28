export const TIKTOK_OAUTH_SCOPE =
  "user.info.basic,user.account.stats,advertiser.read";

export interface TikTokOAuthTokenResponse {
  access_token: string;
  advertiser_ids: string[];
  scope?: string | null;
  token_type?: string | null;
  expires_in?: number | null;
  refresh_token?: string | null;
  refresh_token_expires_in?: number | null;
  open_id?: string | null;
}

export interface TikTokOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export type OAuthFetch = (
  input: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

export function buildTikTokOAuthUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://business-api.tiktok.com/portal/auth");
  url.searchParams.set("app_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", TIKTOK_OAUTH_SCOPE);
  return url.toString();
}

export function requireTikTokOAuthConfig(): TikTokOAuthConfig {
  const appId = process.env.TIKTOK_APP_ID;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI;
  if (!appId) throw new Error("TIKTOK_APP_ID is not configured.");
  if (!appSecret) throw new Error("TIKTOK_APP_SECRET is not configured.");
  if (!redirectUri) throw new Error("TIKTOK_REDIRECT_URI is not configured.");
  return { appId, appSecret, redirectUri };
}

export async function exchangeTikTokOAuthCode(
  code: string,
  config: TikTokOAuthConfig,
  fetcher: OAuthFetch = fetch,
): Promise<TikTokOAuthTokenResponse> {
  const res = await fetcher(
    "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: config.appId,
        secret: config.appSecret,
        auth_code: code,
        grant_type: "authorized_code",
      }),
      cache: "no-store",
    },
  );
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    throw new Error(`TikTok OAuth token exchange failed: HTTP ${res.status}`);
  }
  return parseTikTokOAuthResponse(json);
}

export function parseTikTokOAuthResponse(
  raw: unknown,
): TikTokOAuthTokenResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("TikTok OAuth response was not a JSON object.");
  }
  const record = raw as Record<string, unknown>;
  const code = record.code;
  if (typeof code === "number" && code !== 0) {
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.msg === "string"
          ? record.msg
          : `TikTok OAuth error ${code}`;
    throw new Error(message);
  }

  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : record;
  const accessToken = data.access_token;
  const advertiserIds = data.advertiser_ids;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("TikTok OAuth response did not include access_token.");
  }
  if (
    !Array.isArray(advertiserIds) ||
    advertiserIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new Error("TikTok OAuth response did not include advertiser_ids.");
  }
  return {
    access_token: accessToken,
    advertiser_ids: advertiserIds,
    scope: typeof data.scope === "string" ? data.scope : null,
    token_type: typeof data.token_type === "string" ? data.token_type : null,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : null,
    refresh_token:
      typeof data.refresh_token === "string" ? data.refresh_token : null,
    refresh_token_expires_in:
      typeof data.refresh_token_expires_in === "number"
        ? data.refresh_token_expires_in
        : null,
    open_id: typeof data.open_id === "string" ? data.open_id : null,
  };
}
