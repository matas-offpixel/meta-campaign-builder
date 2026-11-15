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

export function extFromContentType(ct: string): string {
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "image/jpeg";
  return EXT_FOR_TYPE[base] ?? "jpg";
}

export function storagePathForAd(adId: string, contentType: string): string {
  return `${adId}.${extFromContentType(contentType)}`;
}

/**
 * Proxy objects written before the full-size read. `{adId}.jpg` at the
 * bucket root. A later read stores `v2/{adId}.jpg` and does not look here
 * again, so a small object is fetched once.
 */
export const CREATIVE_THUMB_PROXY_VERSION = "v2";

/** A 64px JPEG is about 1–2 KB. Anything under this is not a full card. */
export const CREATIVE_THUMB_MIN_BYTES = 8 * 1024;

export function versionedStoragePathForAd(adId: string, contentType: string): string {
  return `${CREATIVE_THUMB_PROXY_VERSION}/${storagePathForAd(adId, contentType)}`;
}

const LEGACY_PROXY_OBJECT = /^([0-9]+)\.(jpg|png|webp|gif)$/;

export function adIdFromLegacyProxyObject(name: string): string | null {
  return LEGACY_PROXY_OBJECT.exec(name)?.[1] ?? null;
}

/** Root `{adId}.{ext}` objects for this client's ads that are under the size floor. */
export function legacyProxyObjectsUnderFloor(
  objects: ReadonlyArray<{ name: string; size: number }>,
  adIds: ReadonlySet<string>,
  minBytes = CREATIVE_THUMB_MIN_BYTES,
): string[] {
  const names: string[] = [];
  for (const object of objects) {
    const adId = adIdFromLegacyProxyObject(object.name);
    if (!adId || !adIds.has(adId)) continue;
    if (!Number.isFinite(object.size) || object.size < 0 || object.size >= minBytes) continue;
    names.push(object.name);
  }
  return names;
}

export async function purgeLegacyProxyObjects(input: {
  names: readonly string[];
  apply: boolean;
  remove: (names: string[]) => Promise<void>;
}): Promise<{ matched: number; deleted: number }> {
  if (!input.apply || input.names.length === 0) {
    return { matched: input.names.length, deleted: 0 };
  }
  await input.remove([...input.names]);
  return { matched: input.names.length, deleted: input.names.length };
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
