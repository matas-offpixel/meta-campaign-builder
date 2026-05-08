/**
 * Pure helpers for creative thumbnail caching — safe to import from Node tests
 * without pulling Supabase / Next.js path aliases.
 */

export const CREATIVE_THUMBNAIL_BUCKET = "creative-thumbnails";

/** Match snapshot refresh cadence — thumbnails rarely change between deploys. */
export const CREATIVE_THUMB_CACHE_SEC = 7 * 24 * 60 * 60; // 7 days

const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function extFromContentType(ct: string): string {
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "image/jpeg";
  return EXT_FOR_TYPE[base] ?? "jpg";
}

export function storagePathForAd(adId: string, contentType: string): string {
  return `${adId}.${extFromContentType(contentType)}`;
}

/** Branded Meta-blue placeholder when Graph/CDN returns nothing (200 + SVG). */
export function metaPlaceholderSvgBytes(label: string): Buffer {
  const stripped = label.replace(/[^a-zA-Z0-9\s.,+'\-]/g, "").trim();
  const safe = stripped
    .slice(0, 44)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#1877F2" rx="10"/>
  <text x="64" y="72" text-anchor="middle" fill="#ffffff" font-size="11" font-family="system-ui,sans-serif">${safe || "Creative"}</text>
</svg>`;
  return Buffer.from(svg, "utf-8");
}
