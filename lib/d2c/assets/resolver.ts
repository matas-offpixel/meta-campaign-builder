/**
 * lib/d2c/assets/resolver.ts
 *
 * resolveEventArtwork(eventId) — single entry point that makes the source
 * cloud (Drive / Dropbox / direct upload) invisible to consumers. Resolution
 * chain:
 *   1. d2c_event_copy.artwork_url (operator override / prior resolution)
 *   2. Asset queue → Supabase Storage public URL (existing infra)
 *   3. Bird Media Library auto-discovery
 *   4. clients.d2c_fallback_artwork_url (per-client placeholder, migration 133)
 *   5. throw AssetUnresolvedError
 *
 * After a successful resolution from any step BEYOND step 1, the URL is written
 * back to d2c_event_copy.artwork_url so subsequent sends skip the chain (layer
 * 8 of the 2026-07-01 direct-fire incident — see docs/D2C_LIVE_FIRE_RUNBOOK.md).
 *
 * Depends on the Creative thread's Drive integration only indirectly: the
 * asset queue already abstracts the source cloud, so this gracefully no-ops
 * (falls through) when Drive isn't wired.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveArtworkChain } from "./chain.ts";
import {
  getD2CEventCopy,
  getD2CConnectionCredentials,
  updateD2CEventCopyFields,
} from "@/lib/db/d2c";
import { findBirdMediaUrl } from "@/lib/d2c/bird/asset-resolver";
import {
  isDriveUrl,
  isDriveFolderUrl,
  parseFileId,
  parseFolderId,
  publicUrlFor,
  listFolderRecursive,
  mimeToExtension,
} from "@/lib/clients/asset-queue/drive.ts";

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

/**
 * Step 1: explicit artwork on the event copy snapshot.
 *
 * If the stored artwork_url is a Google Drive link (Creative-thread Drive
 * provider), it is not directly fetchable by downstream consumers (Meta, Bird,
 * Mailchimp) — Drive downloads require an auth header. So we materialise it:
 * download via the Drive provider → upload to the public 'event-artwork'
 * Supabase Storage bucket → return the durable Supabase public URL. Non-Drive
 * URLs (already-public artwork, prior storage URLs) are returned verbatim.
 */
async function fromEventCopy(
  supabase: AnySupabaseClient,
  eventId: string,
): Promise<string | null> {
  const copy = await getD2CEventCopy(supabase, eventId);
  const artworkUrl = copy?.artwork_url ?? null;
  if (!artworkUrl) return null;
  if (isDriveUrl(artworkUrl)) return resolveDriveArtwork(artworkUrl);
  return artworkUrl;
}

/**
 * Materialises a Google Drive artwork URL into a durable Supabase Storage
 * public URL. Handles both single-file (/file/d/…) and folder (/drive/folders/…)
 * links — for folders, the first media file found is used.
 */
async function resolveDriveArtwork(driveUrl: string): Promise<string | null> {
  let fileId = parseFileId(driveUrl);

  if (!fileId && isDriveFolderUrl(driveUrl)) {
    const folderId = parseFolderId(driveUrl);
    if (folderId) {
      for await (const entry of listFolderRecursive(folderId)) {
        const ext = mimeToExtension(entry.mimeType, entry.name);
        if (["mp4", "mov", "webm", "jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
          fileId = entry.id;
          break;
        }
      }
    }
  }

  if (!fileId) return null;
  return publicUrlFor(fileId, { uploadToStorage: true });
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
 * Step 4: per-client fallback placeholder (migration 133). Last resort before
 * throwing — degrades a missing per-event poster to a brand-safe image so a
 * required `event_artwork_url` template variable never resolves empty.
 */
async function fromClientFallback(
  supabase: AnySupabaseClient,
  clientId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("d2c_fallback_artwork_url")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  const url = (data as { d2c_fallback_artwork_url: string | null })
    .d2c_fallback_artwork_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/**
 * Resolves a usable artwork URL for an event, or throws AssetUnresolvedError.
 *
 * On resolution from any step beyond the event-copy snapshot, the URL is
 * persisted back to d2c_event_copy.artwork_url (best-effort) so later sends
 * short-circuit at step 1 and don't re-run the chain.
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

  // Snapshot the pre-existing copy artwork so we only write back when the
  // resolved URL actually differs (avoids a redundant UPDATE on the common
  // step-1 hit).
  const existing = await getD2CEventCopy(supabase, eventId);
  const existingArtwork = existing?.artwork_url ?? null;

  const resolved = await resolveArtworkChain(eventId, [
    () => fromEventCopy(supabase, eventId),
    () => fromAssetQueue(supabase, eventId),
    () => fromBirdMedia(supabase, options.clientId, hint),
    () => fromClientFallback(supabase, options.clientId),
  ]);

  if (resolved && resolved !== existingArtwork) {
    try {
      await updateD2CEventCopyFields(supabase, eventId, {
        artworkUrl: resolved,
      });
    } catch (e) {
      // Never let a write-back failure block a successful resolution.
      console.warn(
        "[resolveEventArtwork] write-back failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return resolved;
}
