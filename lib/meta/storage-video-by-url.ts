/**
 * Storage-path video → Meta `file_url`.
 *
 * Creates a 30-minute signed URL and posts it. Does not download the
 * object. Dedupe uses the browser SHA-256 when the client sent one.
 */

import type { ContentIdentity } from "../creatives/asset-registry.ts";
import type { UploadAssetResult } from "./upload.ts";
import { fetchVideoThumbnailWithRetry } from "./video-thumbnail-poll.ts";
import {
  META_VIDEO_SIGNED_URL_TTL_SECONDS,
  StorageVideoInputError,
  assertVideoByteSize,
  buildVideoFileUrlBody,
  clientContentIdentity,
  fileUrlResult,
  parseAdvideosId,
  postAdvideosFileUrl,
  validateStoredVideo,
  waitForVideoStatus,
} from "./video-file-url.ts";

export interface StorageVideoByUrlDeps {
  storagePath: string;
  storageBucket: string;
  fileName: string;
  adAccountId: string;
  token: string;
  contentHash?: unknown;
  byteSize?: unknown;
  contentType?: string | null;
  aspectRatio?: string | null;
  userId: string;
  supabase: unknown;
  createSignedUrl: (
    bucket: string,
    path: string,
    ttlSeconds: number,
  ) => Promise<{ signedUrl?: string; error?: string }>;
  remove: (bucket: string, path: string) => Promise<void>;
  findExisting: (
    supabase: unknown,
    input: { userId: string; identity: ContentIdentity; adAccountId: string },
  ) => Promise<{ videoId: string; previewUrl: string; registryAssetId?: string } | null>;
  register: (input: {
    supabase: unknown;
    userId: string;
    identity: ContentIdentity;
    fileName: string;
    adAccountId: string;
    storageBucket: string;
    storagePath: string;
    result: UploadAssetResult;
    slotHint?: string | null;
  }) => Promise<string | undefined>;
  postAdvideos?: (input: {
    adAccountId: string;
    token: string;
    body: Record<string, unknown>;
  }) => Promise<unknown>;
  /** Used only by the default Graph POST. Tests pass this so a storage URL can never be fetched. */
  fetchImpl?: typeof fetch;
  getStatus?: (videoId: string) => Promise<unknown>;
  fetchThumbnail?: (videoId: string, token: string) => Promise<string>;
  statusDelaysMs?: readonly number[];
}

export async function uploadStoredVideoByUrl(deps: StorageVideoByUrlDeps): Promise<UploadAssetResult> {
  const byteSize = assertVideoByteSize(deps.byteSize);
  const check = validateStoredVideo({
    fileName: deps.fileName,
    contentType: deps.contentType,
    byteSize,
  });
  if (!check.isValid) throw new StorageVideoInputError(check.error ?? "Invalid video");

  const identity = clientContentIdentity(deps.contentHash, byteSize);
  if (identity) {
    const existing = await deps.findExisting(deps.supabase, {
      userId: deps.userId,
      identity,
      adAccountId: deps.adAccountId,
    });
    if (existing) {
      await deps.remove(deps.storageBucket, deps.storagePath);
      return {
        assetType: "video",
        url: existing.previewUrl,
        videoId: existing.videoId,
        previewUrl: existing.previewUrl,
        registryAssetId: existing.registryAssetId,
      };
    }
  }

  const signed = await deps.createSignedUrl(
    deps.storageBucket,
    deps.storagePath,
    META_VIDEO_SIGNED_URL_TTL_SECONDS,
  );
  if (!signed.signedUrl) {
    throw new Error(signed.error ?? "Failed to access stored file");
  }

  const body = buildVideoFileUrlBody(deps.fileName, signed.signedUrl);
  const post = deps.postAdvideos
    ?? ((input: { adAccountId: string; token: string; body: Record<string, unknown> }) =>
      postAdvideosFileUrl({ ...input, fetchImpl: deps.fetchImpl }));
  let json: unknown;
  try {
    json = await post({ adAccountId: deps.adAccountId, token: deps.token, body });
  } catch (err) {
    await deps.remove(deps.storageBucket, deps.storagePath);
    throw err;
  }

  const videoId = parseAdvideosId(json);
  if (!videoId) {
    await deps.remove(deps.storageBucket, deps.storagePath);
    const keys = json && typeof json === "object" ? Object.keys(json as object).join(",") : typeof json;
    throw new Error(`Meta /advideos file_url response had no id (keys: ${keys})`);
  }

  const readiness = await waitForVideoStatus({
    videoId,
    getStatus: deps.getStatus ?? ((id) => fetchVideoStatus(id, deps.token)),
    delaysMs: deps.statusDelaysMs,
  });
  if (readiness === "error") {
    await deps.remove(deps.storageBucket, deps.storagePath);
    throw new Error(`Meta reported video_status=error for ${videoId}`);
  }
  if (readiness === "timeout") {
    console.warn(`[upload-asset] video ${videoId} still processing after the status wait; returning the id`);
  }

  const previewUrl = await (deps.fetchThumbnail ?? fetchVideoThumbnailWithRetry)(videoId, deps.token);
  const result = fileUrlResult(videoId, previewUrl);
  if (identity) {
    result.registryAssetId = await deps.register({
      supabase: deps.supabase,
      userId: deps.userId,
      identity,
      fileName: deps.fileName,
      adAccountId: deps.adAccountId,
      storageBucket: deps.storageBucket,
      storagePath: deps.storagePath,
      result,
      slotHint: deps.aspectRatio,
    });
  }
  return result;
}

export async function fetchVideoStatus(videoId: string, token: string): Promise<unknown> {
  const version = process.env.META_API_VERSION ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${videoId}?fields=status&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { cache: "no-store" });
  return response.json();
}
