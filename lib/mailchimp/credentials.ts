import type { SupabaseClient } from "@supabase/supabase-js";

export interface MailchimpCredentials {
  apiKey: string;
  dc: string;
  loginId: string | null;
  accountName: string | null;
}

export function requireMailchimpTokenKey(): string {
  const key = process.env.MAILCHIMP_TOKEN_KEY;
  if (!key || key.length < 8) {
    throw new Error(
      "MAILCHIMP_TOKEN_KEY must be set and at least 8 characters.",
    );
  }
  return key;
}

export function parseMailchimpCredentials(raw: string): MailchimpCredentials {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Mailchimp credentials payload must be a JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const apiKey = record.apiKey;
  const dc = record.dc;
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Mailchimp credentials payload is missing apiKey.");
  }
  if (typeof dc !== "string" || !dc.trim()) {
    throw new Error("Mailchimp credentials payload is missing dc.");
  }
  return {
    apiKey,
    dc,
    loginId: typeof record.loginId === "string" ? record.loginId : null,
    accountName:
      typeof record.accountName === "string" ? record.accountName : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any>;

export async function setMailchimpCredentials(
  supabase: AnySupabase,
  accountId: string,
  credentials: MailchimpCredentials,
  key = requireMailchimpTokenKey(),
): Promise<void> {
  const { error } = await supabase.rpc("set_mailchimp_credentials", {
    p_account_id: accountId,
    p_plaintext: JSON.stringify(credentials),
    p_key: key,
  });
  if (error) {
    throw new Error(`Failed to encrypt Mailchimp credentials: ${error.message}`);
  }
}

export async function getMailchimpCredentials(
  supabase: AnySupabase,
  accountId: string,
  key = requireMailchimpTokenKey(),
): Promise<MailchimpCredentials | null> {
  const { data, error } = await supabase.rpc("get_mailchimp_credentials", {
    p_account_id: accountId,
    p_key: key,
  });
  if (error) {
    throw new Error(`Failed to decrypt Mailchimp credentials: ${error.message}`);
  }
  if (!data) return null;
  return parseMailchimpCredentials(data as string);
}
