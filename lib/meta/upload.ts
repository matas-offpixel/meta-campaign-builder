/**
 * lib/meta/upload.ts
 *
 * Validation helpers and slot-layout utilities for asset uploads.
 * No API calls here — see lib/meta/client.ts for uploadImageAsset / uploadVideoAsset.
 */

import type { AssetRatio, AssetMode } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;   // 30 MB (Meta's limit for /adimages)
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;  // 200 MB (Meta's limit for /advideos)

const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png"]);
const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4"]);

// ─── Route request / response types ──────────────────────────────────────────

export type AssetUploadType = "image" | "video";

export interface UploadAssetResult {
  assetType: AssetUploadType;
  /** Public CDN URL — use as preview / display URL */
  url: string;
  /** Meta image hash — preferred over url in ad creative API calls */
  hash?: string;
  /** Meta video ID — required for video_data creative spec */
  videoId?: string;
  /** Thumbnail URL (video preview; same as url for images) */
  previewUrl?: string;
}

// ─── Slot layout ─────────────────────────────────────────────────────────────

/**
 * Returns the ordered aspect-ratio slots required for a given asset mode.
 *
 *   single → ["9:16"]          (Story/Reel; cropped to 4:5 by Meta if needed)
 *   dual   → ["4:5", "9:16"]
 *   full   → ["4:5", "9:16", "1:1"]
 *
 * mediaType is accepted for future divergence (e.g. video-only slots)
 * but currently both image and video follow the same slot layout.
 */
export function getAspectRatioSlots(
  _mediaType: string,
  assetMode: AssetMode,
): AssetRatio[] {
  switch (assetMode) {
    case "single": return ["9:16"];
    case "dual":   return ["4:5", "9:16"];
    case "full":   return ["4:5", "9:16", "1:1"];
    default:       return ["4:5", "9:16"];
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateAssetFile(
  file: File | Blob,
  type: AssetUploadType,
): { isValid: boolean; error: string | null } {
  const mimeType = "type" in file ? file.type : "";
  const size = file.size;

  if (type === "image") {
    if (!ACCEPTED_IMAGE_TYPES.has(mimeType)) {
      return {
        isValid: false,
        error: `Unsupported image type "${mimeType}". Use JPEG or PNG.`,
      };
    }
    if (size > MAX_IMAGE_BYTES) {
      return {
        isValid: false,
        error: `Image is too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is 30 MB.`,
      };
    }
  } else {
    if (!ACCEPTED_VIDEO_TYPES.has(mimeType)) {
      return {
        isValid: false,
        error: `Unsupported video type "${mimeType}". Use MP4.`,
      };
    }
    if (size > MAX_VIDEO_BYTES) {
      return {
        isValid: false,
        error: `Video is too large (${(size / 1024 / 1024).toFixed(0)} MB). Maximum is 200 MB.`,
      };
    }
  }

  return { isValid: true, error: null };
}
