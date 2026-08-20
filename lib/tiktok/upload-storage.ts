import { TIKTOK_VIDEO_EXTENSIONS } from "../tiktok-wizard/video-constraints.ts";

export const TIKTOK_UPLOAD_BUCKET = "campaign-assets";
export const TIKTOK_UPLOAD_PREFIX = "tiktok-videos/";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXT_RE = /^\.(mp4|mov|mpeg|avi)$/i;

export function validateTikTokUploadStorageTarget(input: {
  storageBucket?: string | null;
  storagePath?: string | null;
}):
  | { ok: true; bucket: typeof TIKTOK_UPLOAD_BUCKET; path: string }
  | { ok: false; error: string } {
  const bucket = (input.storageBucket ?? TIKTOK_UPLOAD_BUCKET).trim() || TIKTOK_UPLOAD_BUCKET;
  const path = input.storagePath?.trim() ?? "";
  if (bucket !== TIKTOK_UPLOAD_BUCKET) {
    return {
      ok: false,
      error: `storageBucket must be "${TIKTOK_UPLOAD_BUCKET}"`,
    };
  }
  if (!path) {
    return { ok: false, error: "Missing storagePath" };
  }
  if (path.includes("..") || path.startsWith("/") || path.includes("//")) {
    return { ok: false, error: "storagePath is not an allowed tiktok-videos object" };
  }
  if (!path.startsWith(TIKTOK_UPLOAD_PREFIX)) {
    return { ok: false, error: "storagePath is not an allowed tiktok-videos object" };
  }
  const rest = path.slice(TIKTOK_UPLOAD_PREFIX.length);
  const lastDot = rest.lastIndexOf(".");
  if (lastDot <= 0) {
    return { ok: false, error: "storagePath is not an allowed tiktok-videos object" };
  }
  const id = rest.slice(0, lastDot);
  const ext = rest.slice(lastDot);
  if (!UUID_RE.test(id) || !EXT_RE.test(ext)) {
    return { ok: false, error: "storagePath is not an allowed tiktok-videos object" };
  }
  if (!TIKTOK_VIDEO_EXTENSIONS.includes(ext.toLowerCase() as (typeof TIKTOK_VIDEO_EXTENSIONS)[number])) {
    return { ok: false, error: "storagePath is not an allowed tiktok-videos object" };
  }
  return { ok: true, bucket: TIKTOK_UPLOAD_BUCKET, path };
}

export function mimeTypeFromExtension(fileName: string): string {
  const ext = fileName.includes(".")
    ? fileName.slice(fileName.lastIndexOf(".")).toLowerCase()
    : "";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mpeg") return "video/mpeg";
  if (ext === ".avi") return "video/x-msvideo";
  return "video/mp4";
}

export function resolveStoredVideoMimeType(
  contentType: string | null,
  fileName: string,
): string {
  const raw = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (raw.startsWith("video/")) return raw;
  return mimeTypeFromExtension(fileName);
}
