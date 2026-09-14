import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
import { getTikTokCredentials } from "../credentials.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

export async function readTikTokAccountForImport(
  supabase: TypedSupabaseClient,
  args: { userId: string; advertiserId: string },
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("tiktok_accounts")
    .select("id")
    .eq("user_id", args.userId)
    .eq("tiktok_advertiser_id", args.advertiserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string } | null;
}

export async function credentialsForImportAdvertiser(
  supabase: TypedSupabaseClient,
  args: { userId: string; advertiserId: string },
): Promise<{ accountId: string; token: string } | { error: string; status: number }> {
  const account = await readTikTokAccountForImport(supabase, args);
  if (!account) {
    return { error: "TikTok advertiser not found", status: 404 };
  }
  const credentials = await getTikTokCredentials(supabase, account.id);
  if (!credentials?.access_token) {
    return { error: "TikTok credentials missing", status: 400 };
  }
  return { accountId: account.id, token: credentials.access_token };
}

export async function clientIdForTikTokAccount(
  supabase: TypedSupabaseClient,
  args: { userId: string; tiktokAccountId: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", args.userId)
    .eq("tiktok_account_id", args.tiktokAccountId);
  if (error) return null;
  const rows = (data ?? []) as { id: string }[];
  return rows.length === 1 ? rows[0]!.id : null;
}
