export function isTikTokWritesEnabled(): boolean {
  return process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED === "true";
}

export function assertTikTokWritesEnabled(): void {
  if (!isTikTokWritesEnabled()) {
    throw new Error("TikTok writes are disabled");
  }
}
