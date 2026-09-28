/**
 * Storage-path video upload where Meta fetches the file.
 *
 * `POST /act_{id}/advideos` accepts `file_url`. Meta downloads the video.
 * The route must not `fetch` that URL, `blob()` it, or hash the bytes.
 *
 * The id parser reads the same fields the multipart path already reads
 * (`id`, then `video_id`). This environment has no Meta token, so a live
 * `file_url` body was not captured. If Meta wraps the id differently, the
 * thrown error names the keys and nothing else.
 */

import { withActPrefix } from "./ad-account-id.ts";
import { buildVideoUploadFields } from "./video-upload-request.ts";
import { MAX_VIDEO_BYTES, validateAssetFile, type UploadAssetResult } from "./upload.ts";
import type { ContentIdentity } from "../creatives/asset-registry.ts";

/** Long enough for Meta to download a ~150 MB file. Not the 120 s self-fetch window. */
export const META_VIDEO_SIGNED_URL_TTL_SECONDS = 1800;

/** The image / multipart-rollback path still downloads the object itself. */
export const META_STORAGE_FETCH_TTL_SECONDS = 120;

/**
 * Status polls before the existing thumbnail poll. ~117 s, inside the
 * route's maxDuration of 300, and after the thumbnail poll's own 48 s.
 */
export const DEFAULT_VIDEO_STATUS_DELAYS_MS = [0, 2_000, 5_000, 10_000, 10_000, 15_000, 15_000, 20_000, 20_000, 20_000] as const;

export type MetaVideoUploadMode = "file_url" | "multipart";

/**
 * Unset is multipart: the route downloads the object and posts `source`,
 * today's path. `file_url` runs only when the env var is exactly that.
 * The default flips to `file_url` after one live Bournemouth upload.
 */
export function metaVideoUploadMode(
  raw = process.env.META_VIDEO_UPLOAD_MODE,
): MetaVideoUploadMode {
  return raw?.trim() === "file_url" ? "file_url" : "multipart";
}

/** The multipart path. Same request the route used to make inline. */
export async function downloadSignedStorageObject(
  signedUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob> {
  const fileRes = await fetchImpl(signedUrl);
  if (!fileRes.ok) {
    throw new Error(`Storage fetch failed: HTTP ${fileRes.status}`);
  }
  return fileRes.blob();
}

export function videoMimeFromName(fileName: string, contentType?: string | null): string {
  const given = contentType?.split(";")[0]?.trim() ?? "";
  if (given) return given;
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "mov") return "video/quicktime";
  return "video/mp4";
}

/**
 * The browser's SHA-256, trusted for dedupe only. A wrong or missing hash
 * skips the registry lookup; the upload still happens.
 */
export function clientContentIdentity(hash: unknown, byteSize: unknown): ContentIdentity | null {
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0) return null;
  return { contentHash: hash.toLowerCase(), byteSize };
}

export function assertVideoByteSize(byteSize: unknown): number {
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0) {
    throw new StorageVideoInputError("Missing byteSize");
  }
  if (byteSize > MAX_VIDEO_BYTES) {
    throw new StorageVideoInputError(
      `Video is too large (${(byteSize / 1024 / 1024).toFixed(0)} MB). Maximum is 200 MB.`,
    );
  }
  return byteSize;
}

export class StorageVideoInputError extends Error {
  readonly status = 400;
}

/** `name`, `title`, and `thumb_offset` match what `uploadVideoAsset` sends, with `file_url` in place of `source`. */
export function buildVideoFileUrlBody(fileName: string, fileUrl: string): Record<string, unknown> {
  const fields = buildVideoUploadFields(fileName);
  return {
    file_url: fileUrl,
    name: fields.safeFilename,
    title: fields.title,
    ...(fields.thumbOffsetMs !== undefined ? { thumb_offset: fields.thumbOffsetMs } : {}),
  };
}

/** Same extraction as `uploadVideoAsset`: `json.id ?? json.video_id`. */
export function parseAdvideosId(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const id = obj.id ?? obj.video_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export type VideoReadiness = "ready" | "processing" | "error" | "not_queryable";

/**
 * `video_status: "ready"` is the documented processing field. An `error`
 * object, or a body with no status, means the id is not queryable yet —
 * Meta can return the id from `file_url` before the video node exists.
 */
export function classifyVideoStatus(json: unknown): VideoReadiness {
  if (!json || typeof json !== "object") return "not_queryable";
  const obj = json as Record<string, unknown>;
  if (obj.error) return "not_queryable";
  const status = obj.status;
  if (!status || typeof status !== "object") return "processing";
  const videoStatus = (status as { video_status?: unknown }).video_status;
  if (videoStatus === "ready") return "ready";
  if (videoStatus === "error") return "error";
  return "processing";
}

export async function waitForVideoStatus(input: {
  videoId: string;
  getStatus: (videoId: string) => Promise<unknown>;
  delaysMs?: readonly number[];
}): Promise<"ready" | "timeout" | "error"> {
  const delays = input.delaysMs ?? DEFAULT_VIDEO_STATUS_DELAYS_MS;
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    let json: unknown = null;
    try {
      json = await input.getStatus(input.videoId);
    } catch {
      json = null;
    }
    const kind = classifyVideoStatus(json);
    if (kind === "ready") return "ready";
    if (kind === "error") return "error";
  }
  return "timeout";
}

export function validateStoredVideo(input: {
  fileName: string;
  contentType?: string | null;
  byteSize: number;
}): { isValid: boolean; error: string | null } {
  const mimeType = videoMimeFromName(input.fileName, input.contentType);
  return validateAssetFile({ type: mimeType, size: input.byteSize } as File, "video");
}

export function fileUrlResult(videoId: string, previewUrl: string): UploadAssetResult {
  return {
    assetType: "video",
    url: previewUrl,
    videoId,
    previewUrl,
  };
}

export async function postAdvideosFileUrl(input: {
  adAccountId: string;
  token: string;
  body: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const version = process.env.META_API_VERSION ?? "v21.0";
  const account = withActPrefix(input.adAccountId);
  const url = new URL(`https://graph.facebook.com/${version}/${account}/advideos`);
  url.searchParams.set("access_token", input.token);
  const response = await (input.fetchImpl ?? fetch)(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
    cache: "no-store",
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok || json.error) {
    const err = (json.error ?? {}) as { message?: string };
    throw new Error(err.message ?? `Meta /advideos failed: HTTP ${response.status}`);
  }
  return json;
}
