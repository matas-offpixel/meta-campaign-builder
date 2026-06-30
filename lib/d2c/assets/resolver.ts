/**
 * lib/d2c/assets/resolver.ts
 *
 * resolveEventArtwork(eventId) — single entry point that makes the source
 * cloud (Drive / Dropbox / direct upload) invisible to consumers. Resolution
 * chain:
 *   1. d2c_event_copy.artwork_url (operator override / prior resolution)
 *   2. Asset queue → Supabase Storage public URL (existing infra)
 *   3. Bird Media Library auto-discovery
 *   4. throw AssetUnresolvedError
 *
 * Depends on the Creative thread's Drive integration only indirectly: the
 * asset queue already abstracts the source cloud, so this gracefully no-ops
 * (falls through) when Drive isn't wired.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveArtworkChain } from "./chain.ts";
import { getD2CEventCopy, getD2CConnectionCredentials } from "@/lib/db/d2c";
import { findBirdMediaUrl } from "@/lib/d2c/bird/asset-resolver";

export { AssetUnresolvedError } from "./chain.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

const STORAGE_BUCKET = "campaign-assets";

export interface ResolveArtworkOptions {
  clientId: string;
  /** Brand / event name used as the Bird media search hint. */
  brandHint?: string | null;
  eventCode?: string | null;
}

function toPublicUrl(supabase: AnySupabaseClient, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(pathOrUrl);
  return data.publicUrl;
}

/** Step 1: explicit artwork on the event copy snapshot. */
async function fromEventCopy(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<string | null> {
  const copy = await getD2CEventCopy(supabase, eventId);
  return copy?.artwork_url ?? null;
}

/** Step 2: first uploaded asset-queue file for this event → public URL. */
async function fromAssetQueue(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("client_asset_queue")
    .select("asset_blob_url, asset_blob_urls, media_type, created_at")
    .eq("resolved_event_id", eventId)
    .not("asset_blob_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as {
    asset_blob_url: string | null;
    asset_blob_urls: string[] | null;
  };
  const path =
    row.asset_blob_url ??
    (Array.isArray(row.asset_blob_urls) ? row.asset_blob_urls[0] : null);
  if (!path) return null;
  return toPublicUrl(supabase, path);
}

/** Step 3: Bird Media Library auto-discovery using the client's bird creds. */
async function fromBirdMedia(
  supabase: AnySupabaseClient,
  clientId: string,
  hint: string,
): Promise<string | null> {
  if (!hint.trim()) return null;
  const { data, error } = await supabase
    .from("d2c_connections")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", "bird")
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const connectionId = (data[0] as { id: string }).id;

  let creds: Record<string, unknown> | null = null;
  try {
    creds = await getD2CConnectionCredentials(supabase, connectionId);
  } catch {
    return null;
  }
  const apiKey = typeof creds?.api_key === "string" ? creds.api_key : null;
  const workspaceId =
    typeof creds?.workspace_id === "string" ? creds.workspace_id : null;
  if (!apiKey || !workspaceId) return null;

  return findBirdMediaUrl({ apiKey, workspaceId, hint });
}

/**
 * Resolves a usable artwork URL for an event, or throws AssetUnresolvedError.
 */
export async function resolveEventArtwork(
  supabase: AnySupabaseClient,
  eventId: string,
  options: ResolveArtworkOptions,
): Promise<string> {
  const hint = [options.brandHint, options.eventCode]
    .filter(Boolean)
    .join(" ")
    .trim();

  return resolveArtworkChain(eventId, [
    () => fromEventCopy(supabase, eventId),
    () => fromAssetQueue(supabase, eventId),
    () => fromBirdMedia(supabase, options.clientId, hint),
  ]);
}
