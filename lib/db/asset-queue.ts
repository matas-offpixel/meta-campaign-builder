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
  | "matched_umbrella"
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
  /** All funnel labels from the sheet cell (may be more than one). */
  funnels: string[] | null;
  media_type: string | null;
  asset_name: string | null;
  dropbox_url: string | null;
  notes: string | null;
  resolved_event_id: string | null;
  resolved_event_code: string | null;
  /** Populated for matched_umbrella rows — all event codes this umbrella covers. */
  resolved_event_codes_multi: string[] | null;
  /** True when asset_name matched multiple events and the first event_code was chosen. */
  event_match_ambiguous: boolean;
  status: AssetQueueStatus;
  error_message: string | null;
  /** First (or only) uploaded file path — kept for backward compat. */
  asset_blob_url: string | null;
  /** All uploaded file paths for folder-based rows (jsonb array of strings). */
  asset_blob_urls: string[] | null;
  /** Number of files successfully uploaded from a folder row. */
  media_file_count: number | null;
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
  opts?: {
    status?: AssetQueueStatus;
    /** 0-based page index. Ignored when `offset` is supplied. */
    page?: number;
    /** Rows per page (default 25, max 100). */
    pageSize?: number;
    /** Byte-offset override — takes precedence over page×pageSize. */
    offset?: number;
    /** Alias for pageSize when using offset-based pagination. */
    limit?: number;
  },
): Promise<{ rows: AssetQueueRow[]; total: number }> {
  const supabase = await createClient();
  const limit = Math.min(100, Math.max(1, opts?.limit ?? opts?.pageSize ?? 25));
  const from =
    opts?.offset !== undefined
      ? opts.offset
      : (opts?.page ?? 0) * limit;
  const to = from + limit - 1;

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
  /** All funnel labels from the sheet cell. */
  funnels: string[];
  media_type: string;
  asset_name: string;
  dropbox_url: string;
  notes: string;
  resolved_event_id: string | null;
  resolved_event_code: string | null;
  /** Populated for matched_umbrella rows — all event codes this umbrella covers. */
  resolved_event_codes_multi?: string[] | null;
  event_match_ambiguous?: boolean;
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
    /** First (or only) file path — kept in asset_blob_url for backward compat. */
    assetBlobUrl: string;
    /** All uploaded file paths (array, even for single files). */
    assetBlobUrls: string[];
    mediaFileCount: number;
    generatedCopy: string;
    generatedCta: string;
    generatedUrl: string;
    resolvedEventId?: string | null;
    resolvedEventCode?: string | null;
    eventMatchAmbiguous?: boolean;
  },
): Promise<void> {
  // Service-role so the write isn't blocked by RLS on the Storage-path column
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("client_asset_queue")
    .update({
      asset_blob_url: opts.assetBlobUrl,
      asset_blob_urls: opts.assetBlobUrls,
      media_file_count: opts.mediaFileCount,
      generated_copy: opts.generatedCopy,
      generated_cta: opts.generatedCta,
      generated_url: opts.generatedUrl,
      ...(opts.resolvedEventId !== undefined
        ? { resolved_event_id: opts.resolvedEventId }
        : {}),
      ...(opts.resolvedEventCode !== undefined
        ? { resolved_event_code: opts.resolvedEventCode }
        : {}),
      ...(opts.eventMatchAmbiguous !== undefined
        ? { event_match_ambiguous: opts.eventMatchAmbiguous }
        : {}),
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
