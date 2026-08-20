/** TikTok documents preview_url / video_cover_url as valid for six hours. */
export const TIKTOK_PREVIEW_TTL_MS = 6 * 60 * 60 * 1000;

export function parseTikTokPreviewExpiry(
  value: unknown,
  now = Date.now(),
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (Number.isFinite(asNum) && asNum > 0) {
      const ms = asNum < 1e12 ? asNum * 1000 : asNum;
      return new Date(ms).toISOString();
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  void now;
  return null;
}

export function defaultTikTokPreviewExpiry(now = Date.now()): string {
  return new Date(now + TIKTOK_PREVIEW_TTL_MS).toISOString();
}

export function resolveTikTokPreviewExpiry(
  value: unknown,
  now = Date.now(),
): string {
  return parseTikTokPreviewExpiry(value, now) ?? defaultTikTokPreviewExpiry(now);
}

export function isTikTokPreviewExpired(
  expiresAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!expiresAt) return true;
  const parsed = Date.parse(expiresAt);
  return Number.isNaN(parsed) || parsed <= now;
}

export function pickTikTokCoverUrl(input: {
  coverUrl?: string | null;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
}): string | null {
  return input.coverUrl || input.thumbnailUrl || input.previewUrl || null;
}
