/**
 * asset-queue.ts
 *
 * DB helpers for client_asset_queue.
 * Reads use the RLS-scoped cookie client; the prepare route needs to write
 * asset_blob_url via the service-role client (Storage bypass), but all other
 * writes go through the RLS client.
 */

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export type AssetQueueStatus =
  | "pending"
  | "matched"
  | "confirmed"
  | "launched"
  | "skipped"
  | "error";

export interface AssetQueueRow {
  id: string;
  client_id: string;
  source_sheet_row_hash: string;
  nation: string | null;
  location: string | null;
  funnel: string | null;
  media_type: string | null;
  asset_name: string | null;
  dropbox_url: string | null;
  notes: string | null;
  resolved_event_id: string | null;
  resolved_event_code: string | null;
  status: AssetQueueStatus;
  error_message: string | null;
  asset_blob_url: string | null;
  generated_copy: string | null;
  generated_cta: string | null;
  generated_url: string | null;
  confirmed_overrides: Record<string, unknown> | null;
  launched_meta_ad_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listAssetQueue(
  clientId: string,
  opts?: { status?: AssetQueueStatus; page?: number; pageSize?: number },
): Promise<{ rows: AssetQueueRow[]; total: number }> {
  const supabase = await createClient();
  const page = opts?.page ?? 0;
  const pageSize = opts?.pageSize ?? 50;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("client_asset_queue")
    .select("*", { count: "exact" })
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (opts?.status) {
    query = query.eq("status", opts.status);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getAssetQueueRow(id: string): Promise<AssetQueueRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_asset_queue")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Returns existing hashes for deduplication during scrape. */
export async function getExistingHashes(clientId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_asset_queue")
    .select("source_sheet_row_hash")
    .eq("client_id", clientId);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.source_sheet_row_hash));
}

// ─── Write ───────────────────────────────────────────────────────────────────

export interface NewQueueRow {
  client_id: string;
  source_sheet_row_hash: string;
  nation: string;
  location: string;
  funnel: string;
  media_type: string;
  asset_name: string;
  dropbox_url: string;
  notes: string;
  resolved_event_id: string | null;
  resolved_event_code: string | null;
  status: AssetQueueStatus;
  error_message: string | null;
}

export async function insertQueueRows(rows: NewQueueRow[]): Promise<AssetQueueRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_asset_queue")
    .insert(rows)
    .select();
  if (error) throw error;
  return data ?? [];
}

export async function updateQueueRowStatus(
  id: string,
  status: AssetQueueStatus,
  extra?: Partial<Pick<AssetQueueRow, "error_message" | "asset_blob_url" | "generated_copy" | "generated_cta" | "generated_url">>,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_asset_queue")
    .update({ status, ...extra, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** Used by the prepare route — service-role write after Storage upload. */
export async function updateQueueRowPrepared(
  id: string,
  opts: {
    assetBlobUrl: string;
    generatedCopy: string;
    generatedCta: string;
    generatedUrl: string;
  },
): Promise<void> {
  // Service-role so the write isn't blocked by RLS on the Storage-path column
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("client_asset_queue")
    .update({
      asset_blob_url: opts.assetBlobUrl,
      generated_copy: opts.generatedCopy,
      generated_cta: opts.generatedCta,
      generated_url: opts.generatedUrl,
      status: "pending" as AssetQueueStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function markRowLaunched(id: string, metaAdIds: string[]): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_asset_queue")
    .update({
      status: "launched" as AssetQueueStatus,
      launched_meta_ad_ids: metaAdIds,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function markRowSkipped(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_asset_queue")
    .update({ status: "skipped" as AssetQueueStatus, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
