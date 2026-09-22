import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";

export async function upsertGoogleAdsAccount({
  userId,
  customerId,
  loginCustomerId,
  accountName,
  supabase,
}: {
  userId: string;
  customerId: string;
  loginCustomerId: string | null;
  accountName: string;
  supabase: SupabaseClient<Database>;
}): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: lookupError } = await supabase
    .from("google_ads_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("google_customer_id", customerId)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`Failed to look up Google Ads account: ${lookupError.message}`);
  }
  if (existing?.id) {
    const { error: updateError } = await supabase
      .from("google_ads_accounts")
      .update({ account_name: accountName, login_customer_id: loginCustomerId })
      .eq("id", existing.id);
    if (updateError) {
      throw new Error(`Failed to update Google Ads account: ${updateError.message}`);
    }
    return { id: existing.id, created: false };
  }

  const { data: created, error: insertError } = await supabase
    .from("google_ads_accounts")
    .insert({
      user_id: userId,
      account_name: accountName,
      google_customer_id: customerId,
      login_customer_id: loginCustomerId,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !created?.id) {
    throw new Error(insertError?.message ?? "Failed to create Google Ads account row.");
  }
  return { id: created.id, created: true };
}
