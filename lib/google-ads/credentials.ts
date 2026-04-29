import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/database.types";

export interface GoogleAdsCredentials {
  access_token: string;
  refresh_token: string;
  token_type?: string | null;
  scope?: string | null;
  expires_in?: number | null;
  expiry_date?: number | null;
  customer_id: string;
  login_customer_id: string;
}

export function requireGoogleAdsTokenKey(): string | undefined {
  const key = process.env.GOOGLE_ADS_TOKEN_KEY;
  if (!key) return undefined;
  if (key.length < 8) {
    throw new Error("GOOGLE_ADS_TOKEN_KEY must be at least 8 characters.");
  }
  return key;
}

export function parseGoogleAdsCredentials(raw: string): GoogleAdsCredentials {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Google Ads credentials payload must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const accessToken = record.access_token;
  const refreshToken = record.refresh_token;
  const customerId = record.customer_id;
  const loginCustomerId = record.login_customer_id;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("Google Ads credentials payload is missing access_token.");
  }
  if (typeof refreshToken !== "string" || !refreshToken.trim()) {
    throw new Error("Google Ads credentials payload is missing refresh_token.");
  }
  if (typeof customerId !== "string" || !customerId.trim()) {
    throw new Error("Google Ads credentials payload is missing customer_id.");
  }
  if (typeof loginCustomerId !== "string" || !loginCustomerId.trim()) {
    throw new Error("Google Ads credentials payload is missing login_customer_id.");
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    customer_id: customerId,
    login_customer_id: loginCustomerId,
    token_type: typeof record.token_type === "string" ? record.token_type : null,
    scope: typeof record.scope === "string" ? record.scope : null,
    expires_in: typeof record.expires_in === "number" ? record.expires_in : null,
    expiry_date: typeof record.expiry_date === "number" ? record.expiry_date : null,
  };
}

export async function setGoogleAdsCredentials(
  supabase: SupabaseClient<Database>,
  accountId: string,
  credentials: GoogleAdsCredentials,
  key = requireGoogleAdsTokenKey(),
): Promise<void> {
  const { error } = await supabase.rpc("set_google_ads_credentials", {
    p_account_id: accountId,
    p_plaintext: JSON.stringify(credentials),
    p_key: key ?? null,
  });
  if (error) {
    throw new Error(`Failed to encrypt Google Ads credentials: ${error.message}`);
  }
}

export async function getGoogleAdsCredentials(
  supabase: SupabaseClient<Database>,
  accountId: string,
  key = requireGoogleAdsTokenKey(),
): Promise<GoogleAdsCredentials | null> {
  const { data, error } = await supabase.rpc("get_google_ads_credentials", {
    p_account_id: accountId,
    p_key: key ?? null,
  });
  if (error) {
    throw new Error(`Failed to decrypt Google Ads credentials: ${error.message}`);
  }
  if (!data) return null;
  return parseGoogleAdsCredentials(data);
}
