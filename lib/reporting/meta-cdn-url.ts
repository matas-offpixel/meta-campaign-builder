/**
 * Upscales square size tokens inside Meta CDN `stp=` query values so
 * low-res video posters (e.g. `stp=..._s160x160_...`) request a
 * larger variant (default 640) without a new API call. Render-time
 * only — does not write back to snapshots.
 */

function isMetaCdnHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.includes("fbcdn.net") || h.includes("scontent");
}

/**
 * Replace the first square `_sNxN_` or `_pNxN_` token in a `stp`
 * value. Non-square size tokens (e.g. `_p110x80_`) are left alone.
 * If the first match is already at or above `targetSize`, returns
 * `stp` unchanged (no downscaling).
 */
function transformStpValue(stp: string, targetSize: number): string {
  type Hit = { index: number; len: number; size: number; full: string };
  const hits: Hit[] = [];
  // Square only: _s200x200_ not _s200x100_
  const sRe = /_s(\d+)x\1_/g;
  let m: RegExpExecArray | null;
  while ((m = sRe.exec(stp)) !== null) {
    hits.push({
      index: m.index,
      len: m[0].length,
      size: +m[1],
      full: m[0],
    });
  }
  const pRe = /_p(\d+)x\1_/g;
  while ((m = pRe.exec(stp)) !== null) {
    hits.push({
      index: m.index,
      len: m[0].length,
      size: +m[1],
      full: m[0],
    });
  }
  hits.sort((a, b) => a.index - b.index);
  if (hits.length === 0) return stp;
  const first = hits[0];
  if (first.size >= targetSize) return stp;
  return (
    stp.slice(0, first.index) +
    `_s${targetSize}x${targetSize}_` +
    stp.slice(first.index + first.len)
  );
}

/**
 * Rewrites a Meta `fbcdn` / `scontent` image URL to request a larger
 * square crop via the `stp` size token, when present and below
 * `targetSize`. Unrecognised or non-Meta URLs are returned as-is.
 *
 * @param targetSize — default 640. Does not downscale: if the first
 *   square `stp` size is already ≥ this value, the URL is unchanged.
 */
export function upscaleMetaCdnUrl(url: string, targetSize: number = 640): string {
  const trimmed = url?.trim();
  if (!trimmed) return url;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return url;
  }

  if (!isMetaCdnHost(parsed.hostname)) {
    return url;
  }

  const stpKey = Array.from(parsed.searchParams.keys()).find(
    (k) => k.toLowerCase() === "stp",
  );
  if (stpKey == null) {
    return url;
  }

  const stp = parsed.searchParams.get(stpKey);
  if (stp == null || stp.length === 0) {
    return url;
  }

  const next = transformStpValue(stp, targetSize);
  if (next === stp) {
    return url;
  }
  parsed.searchParams.set(stpKey, next);
  return parsed.toString();
}
