export const TIKTOK_WRITES_DISABLED_REASON =
  "TikTok writes are disabled (OFFPIXEL_TIKTOK_WRITES_ENABLED is not true)";

export function isTikTokWritesEnabled(): boolean {
  return process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED === "true";
}

export function assertTikTokWritesEnabled(): void {
  if (!isTikTokWritesEnabled()) {
    throw new Error("TikTok writes are disabled");
  }
}
