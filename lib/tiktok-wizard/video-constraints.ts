export const TIKTOK_VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const TIKTOK_VIDEO_EXTENSIONS = [".mp4", ".mov", ".mpeg", ".avi"] as const;

export function validateTikTokVideoFile(file: {
  name: string;
  size: number;
}): { ok: true } | { ok: false; error: string } {
  const lastDot = file.name.lastIndexOf(".");
  const ext = lastDot >= 0 ? file.name.slice(lastDot).toLowerCase() : "";
  if (!TIKTOK_VIDEO_EXTENSIONS.includes(ext as (typeof TIKTOK_VIDEO_EXTENSIONS)[number])) {
    return {
      ok: false,
      error: `File "${file.name}" is ${ext || "missing an extension"} — TikTok accepts ${TIKTOK_VIDEO_EXTENSIONS.join(", ")} only.`,
    };
  }
  if (file.size > TIKTOK_VIDEO_MAX_BYTES) {
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      error: `File "${file.name}" is ${sizeMb} MB — TikTok's documented limit is 500 MB.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: `File "${file.name}" is 0 bytes.` };
  }
  return { ok: true };
}
