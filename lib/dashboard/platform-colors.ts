/**
 * lib/dashboard/platform-colors.ts
 *
 * Single source of truth for the per-platform brand colors used on the
 * venue / event reports. Applied identically across:
 *   - Topline stats grid (border accent + tab indicator)
 *   - Daily trend chart series
 *   - Active creative concept platform badges
 *
 * TikTok choice: black (#000) over pink (#FE2C55). Black is TikTok's
 * wordmark color, plays well against light cards and avoids competing
 * with the existing destructive/danger pink (`--destructive`) used for
 * delete affordances.
 *
 * Update both halves (CSS color + label) when you add a platform.
 */

export type PlatformId = "all" | "meta" | "tiktok" | "google_ads";

export const PLATFORM_LABELS: Record<PlatformId, string> = {
  all: "All",
  meta: "Meta",
  tiktok: "TikTok",
  google_ads: "Google Ads",
};

/**
 * Hex colors for chart series + badge fills. Kept as plain hex so SVG
 * `stroke=`/`fill=` and Tailwind inline `style={{ backgroundColor }}`
 * read the same value. The "all" variant doubles as the muted neutral
 * for unaccented surfaces.
 */
export const PLATFORM_COLORS: Record<PlatformId, string> = {
  all: "#71717a",
  meta: "#1877F2",
  tiktok: "#000000",
  google_ads: "#EA4335",
};

/** Tailwind-compatible class for a tinted background pill (10% opacity). */
export const PLATFORM_TINT_CLASS: Record<PlatformId, string> = {
  all: "bg-muted text-foreground",
  meta: "bg-[#1877F2]/10 text-[#1877F2]",
  tiktok: "bg-black/10 text-black dark:bg-white/10 dark:text-white",
  google_ads: "bg-[#EA4335]/10 text-[#EA4335]",
};

export const PLATFORM_ORDER: PlatformId[] = [
  "all",
  "meta",
  "tiktok",
  "google_ads",
];

const PLATFORM_ID_SET: ReadonlySet<string> = new Set<PlatformId>(PLATFORM_ORDER);

/**
 * Parse a `?platform=` URL search-param into the discriminated union.
 * Unknown / missing values fall back to `"all"`.
 */
export function parsePlatformParam(value: unknown): PlatformId {
  if (typeof value !== "string") return "all";
  return PLATFORM_ID_SET.has(value) ? (value as PlatformId) : "all";
}
