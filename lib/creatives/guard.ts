import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CreativeProviderDisabledError,
  isBannerbearEnabled,
} from "@/lib/creatives/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export async function assertBannerbearAllowed(
  supabase: AnySupabaseClient,
  clientId: string,
): Promise<void> {
  if (!isBannerbearEnabled()) {
    throw new CreativeProviderDisabledError(
      "bannerbear",
      "Bannerbear is disabled — set FEATURE_BANNERBEAR=true in the environment.",
    );
  }

  const { data, error } = await supabase
    .from("clients")
    .select("bannerbear_enabled")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    throw new CreativeProviderDisabledError(
      "bannerbear",
      `Failed to read client: ${error.message}`,
    );
  }
  if (!data) {
    throw new CreativeProviderDisabledError(
      "bannerbear",
      "Client not found or you do not have access.",
    );
  }
  if (!data.bannerbear_enabled) {
    throw new CreativeProviderDisabledError(
      "bannerbear",
      "Bannerbear is not enabled for this client.",
    );
  }
}
