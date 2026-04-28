import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../db/database.types";

export interface TikTokCredentials {
  access_token: string;
  advertiser_ids: string[];
  scope?: string | null;
  token_type?: string | null;
  expires_in?: number | null;
  refresh_token?: string | null;
  refresh_token_expires_in?: number | null;
  open_id?: string | null;
}

export function requireTikTokTokenKey(): string {
  const key = process.env.TIKTOK_TOKEN_KEY;
  if (!key || key.length < 8) {
    throw new Error("TIKTOK_TOKEN_KEY must be set and at least 8 characters.");
  }
  return key;
}

export function parseTikTokCredentials(raw: string): TikTokCredentials {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("TikTok credentials payload must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const accessToken = record.access_token;
  const advertiserIds = record.advertiser_ids;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new Error("TikTok credentials payload is missing access_token.");
  }
  if (
    !Array.isArray(advertiserIds) ||
    advertiserIds.some((id) => typeof id !== "string" || !id.trim())
  ) {
    throw new Error("TikTok credentials payload is missing advertiser_ids.");
  }
  return {
    access_token: accessToken,
    advertiser_ids: advertiserIds,
    scope: typeof record.scope === "string" ? record.scope : null,
    token_type: typeof record.token_type === "string" ? record.token_type : null,
    expires_in: typeof record.expires_in === "number" ? record.expires_in : null,
    refresh_token:
      typeof record.refresh_token === "string" ? record.refresh_token : null,
    refresh_token_expires_in:
      typeof record.refresh_token_expires_in === "number"
        ? record.refresh_token_expires_in
        : null,
    open_id: typeof record.open_id === "string" ? record.open_id : null,
  };
}

export async function setTikTokCredentials(
  supabase: SupabaseClient<Database>,
  accountId: string,
  credentials: TikTokCredentials,
  key = requireTikTokTokenKey(),
): Promise<void> {
  const { error } = await supabase.rpc("set_tiktok_credentials", {
    p_account_id: accountId,
    p_plaintext: JSON.stringify(credentials),
    p_key: key,
  });
  if (error) {
    throw new Error(`Failed to encrypt TikTok credentials: ${error.message}`);
  }
}

export async function getTikTokCredentials(
  supabase: SupabaseClient<Database>,
  accountId: string,
  key = requireTikTokTokenKey(),
): Promise<TikTokCredentials | null> {
  const { data, error } = await supabase.rpc("get_tiktok_credentials", {
    p_account_id: accountId,
    p_key: key,
  });
  if (error) {
    throw new Error(`Failed to decrypt TikTok credentials: ${error.message}`);
  }
  if (!data) return null;
  return parseTikTokCredentials(data);
}
