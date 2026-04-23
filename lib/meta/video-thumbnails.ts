/**
 * Meta Graph `/{video_id}/thumbnails` helpers (pure — no `server-only`).
 * Used to pick the best poster frame when batching native-resolution
 * video thumbnails in the active-creatives fetch path.
 */

export interface VideoThumbnail {
  uri: string;
  width: number;
  height: number;
  scale: number;
  is_preferred: boolean;
}

function toFinitePositive(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function normaliseEntry(raw: unknown): VideoThumbnail | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const uri = o.uri;
  if (typeof uri !== "string" || !uri.trim()) return null;
  const w = toFinitePositive(o.width as unknown);
  const h = toFinitePositive(o.height as unknown);
  if (w === null || h === null) return null;
  const scaleN =
    typeof o.scale === "number" && Number.isFinite(o.scale) && o.scale > 0
      ? o.scale
      : 1;
  return {
    uri: uri.trim(),
    width: w,
    height: h,
    scale: scaleN,
    is_preferred: Boolean(o.is_preferred),
  };
}

/**
 * Pick the best thumbnail from Meta's /{video_id}/thumbnails response.
 * Preference order:
 *   1. is_preferred = true (Meta's editorial pick)
 *   2. largest area (width × height)
 *   3. insertion order (first wins)
 * Returns null if thumbnails array is empty or malformed.
 */
export function pickBestVideoThumbnail(
  thumbnails: ReadonlyArray<unknown>,
): VideoThumbnail | null {
  if (thumbnails.length === 0) return null;

  const valid: Array<{ t: VideoThumbnail; idx: number }> = [];
  for (let i = 0; i < thumbnails.length; i++) {
    const n = normaliseEntry(thumbnails[i] as unknown);
    if (n) valid.push({ t: n, idx: i });
  }
  if (valid.length === 0) return null;

  const preferred = valid.find((e) => e.t.is_preferred);
  if (preferred) {
    return preferred.t;
  }

  let best = valid[0]!;
  let bestArea = best.t.width * best.t.height;
  for (let j = 1; j < valid.length; j++) {
    const cur = valid[j]!;
    const area = cur.t.width * cur.t.height;
    if (area > bestArea) {
      best = cur;
      bestArea = area;
    }
  }
  return best.t;
}
