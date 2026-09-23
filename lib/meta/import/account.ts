import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Operator Facebook token for the import capture. No env-token
 * fallback here — a missing row is a 400 the operator can fix by
 * reconnecting, not a silent switch onto `META_ACCESS_TOKEN`.
 */
export async function facebookTokenForImport(
  supabase: TypedSupabaseClient,
  userId: string,
): Promise<{ token: string } | { error: string; status: number }> {
  const { data, error } = await supabase
    .from("user_facebook_tokens")
    .select("provider_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return { error: error.message, status: 500 };
  }
  const token = (data as { provider_token?: string } | null)?.provider_token;
  if (typeof token !== "string" || !token) {
    return { error: "Facebook token missing — reconnect Meta", status: 400 };
  }
  return { token };
}
