import type { SupabaseClient } from "@supabase/supabase-js";

import { getTikTokCredentials } from "./credentials.ts";

export async function readTikTokAccountCredentials(
  supabase: SupabaseClient,
  args: { userId: string; advertiserId: string },
): Promise<{ accessToken: string } | null> {
  const { data, error } = await asAny(supabase)
    .from("tiktok_accounts")
    .select("id")
    .eq("user_id", args.userId)
    .eq("tiktok_advertiser_id", args.advertiserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const account = data as { id: string } | null;
  if (!account) return null;
  const credentials = await getTikTokCredentials(
    supabase as Parameters<typeof getTikTokCredentials>[0],
    account.id,
  );
  return credentials?.access_token
    ? { accessToken: credentials.access_token }
    : null;
}

function asAny(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}
