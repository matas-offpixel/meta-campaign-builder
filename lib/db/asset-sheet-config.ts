/**
 * asset-sheet-config.ts
 *
 * DB helpers for client_asset_sheet_config.
 * The service account email stored here is informational only — credentials
 * come from env vars and are never stored in the DB.
 */

import { createClient } from "@/lib/supabase/server";

export interface AssetSheetConfigRow {
  id: string;
  client_id: string;
  google_sheet_id: string;
  sheet_range: string;
  /** Which cloud backs the asset queue for this client. See migration 128. */
  source: "dropbox" | "drive";
  service_account_email: string | null;
  copy_templates: Record<string, string>;
  cta_defaults: Record<string, string>;
  destination_url_pattern: Record<string, string>;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAssetSheetConfig(clientId: string): Promise<AssetSheetConfigRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_asset_sheet_config")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertAssetSheetConfig(
  clientId: string,
  patch: Partial<Omit<AssetSheetConfigRow, "id" | "client_id" | "created_at" | "updated_at">>,
): Promise<AssetSheetConfigRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_asset_sheet_config")
    .upsert(
      { client_id: clientId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: "client_id" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function touchLastScrapedAt(clientId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_asset_sheet_config")
    .update({ last_scraped_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("client_id", clientId);
  if (error) throw error;
}
